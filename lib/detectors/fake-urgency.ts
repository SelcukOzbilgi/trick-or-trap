import {
  FUTURE_DEADLINE_WORDS,
  OFFER_WORDS,
  ROLLING_DEADLINE_PHRASES,
  SHIPPING_CUTOFF_PHRASES,
  URGENCY_WORDS,
} from "@/lib/detectors/data/urgency-words";
import { parseCalendarDates } from "@/lib/detectors/shared/calendar-date";
import {
  DATE_ZONE_SLACK_HOURS,
  RELOAD_TEXT_CAP,
  TOLERANCE_BASE_SECONDS,
} from "@/lib/detectors/shared/constants";
import { parseCountdowns } from "@/lib/detectors/shared/countdown";
import type { Countdown } from "@/lib/detectors/shared/countdown";
import type { IndexedElement } from "@/lib/detectors/shared/elements";
import {
  detectedAtFrom,
  finaliseFindings,
  TITLES,
} from "@/lib/detectors/shared/finding";
import type { FindingDraft } from "@/lib/detectors/shared/finding";
import { buildSamplePair, findCounterpart } from "@/lib/detectors/shared/samples";
import type { SamplePair } from "@/lib/detectors/shared/samples";
import {
  compilePhrases,
  findPhrases,
  hasAny,
  quote,
  tokenise,
} from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";
import type { Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * fake-urgency (requirement 8, design section 9.1).
 *
 * Reads only text, ids, visibility, boxes and the capture times of the two
 * samples. Ignores attributes, roles, colours, font sizes, positions and
 * `secondSample`. Per element the first matching row of the table in
 * requirement 8.18 applies: U1 to U5 for countdowns, U6 for a rolling
 * deadline, U7 for a deadline date that has already passed.
 */

const URGENCY = compilePhrases(URGENCY_WORDS);
const OFFER = compilePhrases(OFFER_WORDS);
const ROLLING = compilePhrases(ROLLING_DEADLINE_PHRASES);
const FUTURE_DEADLINE = compilePhrases(FUTURE_DEADLINE_WORDS);
const SHIPPING_CUTOFF = compilePhrases(SHIPPING_CUTOFF_PHRASES);

const PATTERN = "fake-urgency" as const;

const TITLE_RESTARTED = TITLES[PATTERN][0];
const TITLE_UNCHANGED = TITLES[PATTERN][1];
const TITLE_TIMER = TITLES[PATTERN][2];
const TITLE_ROLLING = TITLES[PATTERN][3];
const TITLE_PASSED = TITLES[PATTERN][4];

const DESCRIPTION_RESTARTED =
  "A countdown showed a higher remaining time after a reload than before it.";
const DESCRIPTION_UNCHANGED =
  "A countdown showed about the same remaining time in two reads taken some seconds apart.";
const DESCRIPTION_TIMER =
  "A countdown is shown next to an offer; no restart was observed.";
const DESCRIPTION_ROLLING =
  "A deadline that rolls over (for example to the next midnight) is shown without a calendar date.";
const DESCRIPTION_PASSED =
  "A deadline date that lies before the capture time is still shown.";
const LOOKALIKE_NOTE = " The text also holds a date or a delivery cut-off.";

const MS_PER_HOUR = 3_600_000;

/** Rows of the table in requirement 8.18, in order. */
const ROW_LOOKALIKE = 1;
const ROW_RESTARTED_WORDED = 2;
const ROW_UNCHANGED_WORDED = 3;
const ROW_RESTARTED_UNWORDED = 4;
const ROW_TIMER = 5;
const ROW_ROLLING = 6;
const ROW_PASSED = 7;

type PairClass =
  | "none"
  | "restarted"
  | "unchanged"
  | "consistent"
  | "faster"
  | "counting-up";

type ReloadValue = { readonly seconds: number; readonly shown: string };

type Comparison = { readonly cls: PairClass; readonly reload: ReloadValue | null };

type Stable = {
  /** Tokens of the claim comparison: the first `RELOAD_TEXT_CAP` characters. */
  readonly tokens: readonly Token[];
  /** Countdowns that lie fully inside those characters. */
  readonly countdowns: readonly Countdown[];
};

type Candidate = {
  readonly el: IndexedElement;
  readonly key: string;
  readonly draft: FindingDraft;
};

type Context = {
  readonly pair: SamplePair;
  readonly detectedMs: number | null;
  readonly detectedIso: string;
  readonly stable: Map<IndexedElement, Stable>;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Words of a countdown as the page shows them: "01:59:58", "2h 30m", "1 day 3 hours". */
function shownOf(tokens: readonly Token[], c: Countdown): string {
  let out = "";
  for (let i = c.start; i < c.end; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    const prev = i > c.start ? tokens[i - 1] : undefined;
    const glued =
      prev !== undefined &&
      prev.kind === "number" &&
      token.kind === "word" &&
      token.surface.length === 1;
    out += (i > c.start && !glued ? " " : "") + token.surface;
  }
  return out;
}

function keyOf(prefix: string, tokens: readonly Token[], start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i < end; i += 1) {
    const token = tokens[i];
    if (token !== undefined) parts.push(token.norm);
  }
  return `${prefix}:${parts.join(" ")}`;
}

/**
 * Tokens and countdowns used to compare the two samples. A text that fills the
 * reload cap may have been cut inside a claim, so claims that touch its last
 * token are left out (requirement 7.11).
 */
function stableOf(ctx: Context, el: IndexedElement): Stable {
  const cached = ctx.stable.get(el);
  if (cached !== undefined) return cached;
  const edge = el.text.length >= RELOAD_TEXT_CAP;
  const tokens = edge ? tokenise(el.text, RELOAD_TEXT_CAP) : el.tokens;
  const countdowns = parseCountdowns(tokens).filter(
    (c) => !edge || c.end < tokens.length
  );
  const made: Stable = { tokens, countdowns };
  ctx.stable.set(el, made);
  return made;
}

function isWordedText(tokens: readonly Token[]): boolean {
  return hasAny(tokens, URGENCY) || hasAny(tokens, OFFER);
}

/** Worded: the element or its parent container holds an urgency or offer word (requirement 8.4). */
function isWorded(ctx: Context, el: IndexedElement): boolean {
  if (isWordedText(el.tokens)) return true;
  const parent = ctx.pair.first.ancestors(el, 1)[0];
  return parent !== undefined && isWordedText(parent.tokens);
}

// ---------------------------------------------------------------------------
// Reload comparison (requirements 8.5 to 8.10)
// ---------------------------------------------------------------------------

function classifyPair(first: Countdown, reload: Countdown, gap: number): PairClass {
  const tolerance = TOLERANCE_BASE_SECONDS + first.unitSeconds;
  if (reload.seconds > first.seconds) {
    return Math.abs(reload.seconds - first.seconds - gap) > tolerance
      ? "restarted"
      : "counting-up";
  }
  const dropped = first.seconds - reload.seconds;
  if (dropped > gap + tolerance) return "faster";
  if (Math.abs(dropped - gap) <= tolerance) return "consistent";
  return "unchanged";
}

function compareWithReload(
  ctx: Context,
  el: IndexedElement,
  countdown: Countdown
): Comparison {
  const none: Comparison = { cls: "none", reload: null };
  const gap = ctx.pair.gapSeconds;
  if (ctx.pair.reload === null || gap === null) return none;

  const own = stableOf(ctx, el);
  const sameForm = own.countdowns.filter((c) => c.form === countdown.form);
  const rank = sameForm.findIndex(
    (c) => c.start === countdown.start && c.end === countdown.end
  );
  if (rank < 0) return none;

  const counterpart = findCounterpart(ctx.pair, el, (candidate) =>
    stableOf(ctx, candidate).countdowns.some((c) => c.form === countdown.form)
  );
  if (counterpart === null) return none;

  const theirs = stableOf(ctx, counterpart);
  const candidates = theirs.countdowns.filter((c) => c.form === countdown.form);
  const match = candidates[rank] ?? candidates[0];
  if (match === undefined) return none;

  return {
    cls: classifyPair(sameForm[rank], match, gap),
    reload: { seconds: match.seconds, shown: shownOf(theirs.tokens, match) },
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type CountdownRow = {
  readonly row: number;
  readonly countdown: Countdown;
  readonly comparison: Comparison;
};

function rowFor(
  countdown: Countdown,
  comparison: Comparison,
  worded: boolean,
  lookalike: boolean
): number | null {
  const { cls } = comparison;
  const moved = cls === "restarted" || cls === "unchanged";
  if (lookalike && moved && (worded || countdown.form !== "clock2")) {
    return ROW_LOOKALIKE;
  }
  if (worded && cls === "restarted") return ROW_RESTARTED_WORDED;
  if (worded && cls === "unchanged") return ROW_UNCHANGED_WORDED;
  if (!worded && countdown.form === "clock3" && cls === "restarted") {
    return ROW_RESTARTED_UNWORDED;
  }
  if (worded && !lookalike && cls !== "counting-up") return ROW_TIMER;
  return null;
}

function countdownDraft(
  ctx: Context,
  el: IndexedElement,
  best: CountdownRow,
  lookalike: boolean
): FindingDraft {
  const { row, countdown, comparison } = best;
  const first = shownOf(el.tokens, countdown);
  const gap = ctx.pair.gapSeconds;
  const q = quote(el.text);
  const moved = comparison.reload !== null && gap !== null;
  const measured: Record<string, number> | undefined =
    moved && comparison.reload !== null && gap !== null
      ? {
          firstValue: countdown.seconds,
          reloadValue: comparison.reload.seconds,
          gapSeconds: Math.round(gap),
        }
      : undefined;
  const reloadSentence =
    moved && comparison.reload !== null && gap !== null
      ? `${comparison.reload.shown} after a reload ${Math.round(gap)} s later`
      : "";

  if (row === ROW_TIMER) {
    const evidence =
      reloadSentence === ""
        ? `Countdown ${q}.`
        : `Countdown ${q}. It showed ${reloadSentence}.`;
    return {
      patternId: PATTERN,
      confidence: "low",
      title: TITLE_TIMER,
      description: DESCRIPTION_TIMER,
      evidenceText: evidence,
      measuredValues: measured,
      elements: [el],
      ruleOrder: row,
    };
  }

  const restarted = comparison.cls === "restarted";
  const confidence: Confidence =
    row === ROW_RESTARTED_WORDED
      ? "high"
      : row === ROW_LOOKALIKE
        ? "low"
        : "medium";
  return {
    patternId: PATTERN,
    confidence,
    title: restarted ? TITLE_RESTARTED : TITLE_UNCHANGED,
    description:
      (restarted ? DESCRIPTION_RESTARTED : DESCRIPTION_UNCHANGED) +
      (lookalike && row === ROW_LOOKALIKE ? LOOKALIKE_NOTE : ""),
    evidenceText: `Countdown ${q} showed ${first}, then ${reloadSentence}.`,
    measuredValues: measured,
    elements: [el],
    ruleOrder: row,
  };
}

function bestCountdownRow(
  ctx: Context,
  el: IndexedElement,
  countdowns: readonly Countdown[],
  lookalike: boolean
): CountdownRow | null {
  const worded = isWorded(ctx, el);
  let best: CountdownRow | null = null;
  for (const countdown of countdowns) {
    const comparison = compareWithReload(ctx, el, countdown);
    const row = rowFor(countdown, comparison, worded, lookalike);
    if (row === null) continue;
    if (best === null || row < best.row) best = { row, countdown, comparison };
  }
  return best;
}

function rollingCandidate(el: IndexedElement, hit: { entry: string }): Candidate {
  return {
    el,
    key: `r:${hit.entry}`,
    draft: {
      patternId: PATTERN,
      confidence: "low",
      title: TITLE_ROLLING,
      description: DESCRIPTION_ROLLING,
      evidenceText: `Text ${quote(el.text)}.`,
      elements: [el],
      ruleOrder: ROW_ROLLING,
    },
  };
}

/** Candidate for the rolling-deadline and passed-deadline rows, or null. */
function textCandidate(ctx: Context, el: IndexedElement): Candidate | null {
  const tokens = el.tokens;
  const dates = parseCalendarDates(tokens);

  if (dates.length === 0) {
    const hit = findPhrases(tokens, ROLLING, 1)[0];
    return hit === undefined ? null : rollingCandidate(el, hit);
  }

  // Requirement 8.14, 8.15, 8.16: only dates that all lie before the capture
  // time by more than the zone slack, with deadline wording, count.
  const capturedMs = ctx.detectedMs;
  if (capturedMs === null) return null;
  const limit = capturedMs - DATE_ZONE_SLACK_HOURS * MS_PER_HOUR;
  for (const date of dates) {
    if (date.kind !== "full" || date.endMs === null || date.endMs >= limit) {
      return null;
    }
  }
  if (!hasAny(tokens, FUTURE_DEADLINE)) return null;
  const first = dates[0];
  return {
    el,
    key: keyOf("d", tokens, first.start, first.end),
    draft: {
      patternId: PATTERN,
      confidence: "low",
      title: TITLE_PASSED,
      description: DESCRIPTION_PASSED,
      evidenceText: `Text ${quote(el.text)}; capture time ${ctx.detectedIso}.`,
      elements: [el],
      ruleOrder: ROW_PASSED,
    },
  };
}

function analyse(ctx: Context, el: IndexedElement): Candidate | null {
  const tokens = el.tokens;
  if (el.hidden || tokens.length === 0) return null;

  const cutoff = hasAny(tokens, SHIPPING_CUTOFF);
  const hasDate = parseCalendarDates(tokens).length > 0;
  const lookalike = cutoff || hasDate;

  const countdowns = parseCountdowns(tokens);
  if (countdowns.length > 0) {
    const best = bestCountdownRow(ctx, el, countdowns, lookalike);
    if (best !== null) {
      return {
        el,
        key: keyOf("c", tokens, best.countdown.start, best.countdown.end),
        draft: countdownDraft(ctx, el, best, lookalike),
      };
    }
  }

  // Delivery cut-offs silence every text-only row (requirement 8.17).
  if (cutoff) return null;
  return textCandidate(ctx, el);
}

/** Drops a candidate when a deeper element holds the same claim (requirement 7.3). */
function keepDeepest(ctx: Context, candidates: readonly Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = byKey.get(candidate.key);
    if (group) group.push(candidate);
    else byKey.set(candidate.key, [candidate]);
  }
  return candidates.filter((candidate) => {
    const group = byKey.get(candidate.key) ?? [];
    return !group.some(
      (other) =>
        other !== candidate && ctx.pair.first.isAncestor(candidate.el, other.el)
    );
  });
}

/**
 * Detect possible fake urgency in one snapshot. Never throws; any value that
 * is not a usable snapshot gives an empty array.
 */
export function detectFakeUrgency(snapshot: PageSnapshot): Finding[] {
  try {
    const pair = buildSamplePair(snapshot);
    const detectedAt = detectedAtFrom(snapshot);
    const ctx: Context = {
      pair,
      detectedMs: detectedAt.ms,
      detectedIso: detectedAt.iso,
      stable: new Map<IndexedElement, Stable>(),
    };

    const candidates: Candidate[] = [];
    for (const el of pair.first.elements) {
      const candidate = analyse(ctx, el);
      if (candidate !== null) candidates.push(candidate);
    }

    const drafts = keepDeepest(ctx, candidates).map((c) => c.draft);
    return finaliseFindings(drafts, {
      detectedAt,
      pageTruncated: pair.first.captureTruncated || pair.first.budgetHit,
    });
  } catch {
    return [];
  }
}
