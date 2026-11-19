import {
  ACTIVITY_CONTEXT_WORDS,
  ACTIVITY_LOOKALIKES,
  COUNT_TEMPLATES,
  PURCHASE_TEMPLATES,
  PURCHASE_TIME_WORDS,
  TIMED_PURCHASE_TEMPLATES,
} from "@/lib/detectors/data/activity-words";
import { GROUP_MAX_LEVELS, RELOAD_TEXT_CAP } from "@/lib/detectors/shared/constants";
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
  normaliseText,
  quote,
  tokenise,
} from "@/lib/detectors/shared/text";
import type { PhraseHit, Token } from "@/lib/detectors/shared/text";
import type { Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * fake-activity (requirement 10, design section 9.3).
 *
 * Reads only text (including the capital letters of names), ids, the role,
 * position and `aria-live` of the claim and its nearest ancestors, visibility,
 * boxes and the capture times of the two samples. Ignores checked state,
 * colours, font sizes, other attributes and `secondSample`. Per element the
 * first matching row of the table in requirement 10.6 applies: A1 needs a
 * count or a purchase message that differs across the reload, A2 is a claim in
 * a live context, A3 is any other claim.
 */

const COUNT = compilePhrases(COUNT_TEMPLATES);
const PURCHASE = compilePhrases(PURCHASE_TEMPLATES);
const TIMED_PURCHASE = compilePhrases(TIMED_PURCHASE_TEMPLATES);
const PURCHASE_TIME = compilePhrases(PURCHASE_TIME_WORDS);
const CONTEXT_WORDS = compilePhrases(ACTIVITY_CONTEXT_WORDS);
const LOOKALIKES = compilePhrases(ACTIVITY_LOOKALIKES);

const PATTERN = "fake-activity" as const;

const TITLE_NUMBER_CHANGED = TITLES[PATTERN][0];
const TITLE_PURCHASE_CHANGED = TITLES[PATTERN][1];
const TITLE_MESSAGE = TITLES[PATTERN][2];

const DESCRIPTION_NUMBER_CHANGED =
  "A shopper-activity number changed between two reads of the page.";
const DESCRIPTION_PURCHASE_CHANGED =
  "A purchase message changed between two reads of the page.";
const DESCRIPTION_MESSAGE = "A message about other shoppers is shown.";
const SENTENCE_LIVE_AREA = " It sits in a status, alert or fixed area.";

/** Rows of the table in requirement 10.6, in order. */
const ROW_CHANGED = 1;
const ROW_IN_CONTEXT = 2;
const ROW_PLAIN = 3;

/** Larger numbers are not shopper counts. */
const MAX_COUNT_NUMBER = 1_000_000;

/** Roles of areas that announce or rotate messages (requirement 10.3). */
const LIVE_ROLES: ReadonlySet<string> = new Set(["status", "alert", "log", "marquee"]);

type ClaimKind = "count" | "purchase";

type Claim = {
  readonly kind: ClaimKind;
  readonly entry: string;
  readonly start: number;
  readonly end: number;
  /** The numbers of the claim in template order; empty for a purchase claim. */
  readonly values: readonly number[];
  /** The numbers as the page shows them. */
  readonly shown: readonly string[];
};

type Claims = {
  readonly claims: readonly Claim[];
};

type Candidate = {
  readonly el: IndexedElement;
  readonly key: string;
  readonly draft: FindingDraft;
};

type Context = {
  readonly pair: SamplePair;
  /** Claims inside the reload comparison window of an element, cached. */
  readonly stable: Map<IndexedElement, Claims>;
};

type Reload = {
  readonly changed: boolean;
  /** Count claims: the number that differs (or the first number when equal). */
  readonly firstValue: number;
  readonly reloadValue: number;
  readonly firstShown: string;
  readonly reloadShown: string;
  /** Purchase claims: the text of the counterpart. */
  readonly reloadText: string;
};

type Live = {
  readonly area: boolean;
  readonly wording: boolean;
};

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** Hits in token order, longest first for one start, with no overlap between kept hits. */
function nonOverlapping(hits: readonly PhraseHit[]): PhraseHit[] {
  const sorted = [...hits].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end
  );
  const kept: PhraseHit[] = [];
  let edge = 0;
  for (const hit of sorted) {
    if (hit.start < edge) continue;
    kept.push(hit);
    edge = hit.end;
  }
  return kept;
}

/** The number tokens inside a hit, in order; they stand for the `#` of the entry. */
function numberTokens(tokens: readonly Token[], hit: PhraseHit): string[] {
  const shown: string[] = [];
  for (let i = hit.start; i < hit.end; i += 1) {
    const token = tokens[i];
    if (token !== undefined && token.kind === "number") shown.push(token.surface);
  }
  return shown;
}

function countClaim(tokens: readonly Token[], hit: PhraseHit): Claim | null {
  const shown = numberTokens(tokens, hit);
  if (hit.numbers.length === 0 || shown.length !== hit.numbers.length) return null;
  for (const value of hit.numbers) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT_NUMBER) return null;
  }
  return {
    kind: "count",
    entry: hit.entry,
    start: hit.start,
    end: hit.end,
    values: hit.numbers,
    shown,
  };
}

/** The claims of one token list, in token order. */
function claimsOf(tokens: readonly Token[]): Claim[] {
  const claims: Claim[] = [];
  for (const hit of nonOverlapping(findPhrases(tokens, COUNT))) {
    const claim = countClaim(tokens, hit);
    if (claim !== null) claims.push(claim);
  }
  const purchaseHits: PhraseHit[] = [...findPhrases(tokens, PURCHASE)];
  // A bare purchase verb counts only with a time word in the same token list
  // (requirement 10.1); a review sentence without one gives no claim (10.3).
  if (hasAny(tokens, PURCHASE_TIME)) {
    purchaseHits.push(...findPhrases(tokens, TIMED_PURCHASE));
  }
  for (const hit of nonOverlapping(purchaseHits)) {
    claims.push({
      kind: "purchase",
      entry: hit.entry,
      start: hit.start,
      end: hit.end,
      values: [],
      shown: [],
    });
  }
  return claims.sort((a, b) => a.start - b.start);
}

/**
 * Claims used to compare the two samples. A text that fills the reload cap may
 * have been cut inside a claim, so claims that touch its last token are left
 * out (requirement 7.11).
 */
function stableOf(ctx: Context, el: IndexedElement): Claims {
  const cached = ctx.stable.get(el);
  if (cached !== undefined) return cached;
  const edge = el.text.length >= RELOAD_TEXT_CAP;
  const tokens = edge ? tokenise(el.text, RELOAD_TEXT_CAP) : el.tokens;
  const claims = claimsOf(tokens).filter((c) => !edge || c.end < tokens.length);
  const made: Claims = { claims };
  ctx.stable.set(el, made);
  return made;
}

/** A count claim needs the same entry; any purchase message stands for a purchase claim. */
function sameTemplate(a: Claim, b: Claim): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "purchase" || a.entry === b.entry;
}

// ---------------------------------------------------------------------------
// Reload comparison (requirements 10.4, 7.15)
// ---------------------------------------------------------------------------

/** First index at which two equally long number lists differ; -1 when they are equal. */
function firstDifference(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

/**
 * The same template in the reload counterpart. Needs a reload sample and a
 * usable gap: the evidence states the gap, so a pair without one is treated as
 * no reload at all.
 */
function compareWithReload(
  ctx: Context,
  el: IndexedElement,
  claim: Claim
): Reload | null {
  if (ctx.pair.reload === null || ctx.pair.gapSeconds === null) return null;

  const own = stableOf(ctx, el).claims.filter((c) => sameTemplate(claim, c));
  const rank = own.findIndex((c) => c.start === claim.start && c.end === claim.end);
  if (rank < 0) return null;

  const counterpart = findCounterpart(ctx.pair, el, (candidate) =>
    stableOf(ctx, candidate).claims.some((c) => sameTemplate(claim, c))
  );
  if (counterpart === null) return null;

  if (claim.kind === "purchase") {
    const changed =
      normaliseText(el.text, RELOAD_TEXT_CAP) !==
      normaliseText(counterpart.text, RELOAD_TEXT_CAP);
    return {
      changed,
      firstValue: 0,
      reloadValue: 0,
      firstShown: "",
      reloadShown: "",
      reloadText: counterpart.text,
    };
  }

  const theirs = stableOf(ctx, counterpart).claims.filter((c) =>
    sameTemplate(claim, c)
  );
  const match = theirs[rank] ?? theirs[0];
  if (match === undefined || match.values.length !== claim.values.length) return null;

  const diff = firstDifference(claim.values, match.values);
  const at = diff < 0 ? 0 : diff;
  return {
    changed: diff >= 0,
    firstValue: claim.values[at] ?? 0,
    reloadValue: match.values[at] ?? 0,
    firstShown: claim.shown[at] ?? "",
    reloadShown: match.shown[at] ?? "",
    reloadText: counterpart.text,
  };
}

// ---------------------------------------------------------------------------
// Context (requirement 10.3)
// ---------------------------------------------------------------------------

function isLiveArea(el: IndexedElement): boolean {
  if (LIVE_ROLES.has(el.role)) return true;
  if (el.position === "fixed" || el.position === "sticky") return true;
  const live = el.attr("aria-live");
  if (live === undefined) return false;
  const value = live.trim().toLowerCase();
  return value !== "" && value !== "off";
}

/** The element or one of its nearest ancestors is a live area, or the text says "right now". */
function liveContext(pair: SamplePair, el: IndexedElement): Live {
  let area = isLiveArea(el);
  if (!area) {
    for (const ancestor of pair.first.ancestors(el, GROUP_MAX_LEVELS)) {
      if (isLiveArea(ancestor)) {
        area = true;
        break;
      }
    }
  }
  return { area, wording: hasAny(el.tokens, CONTEXT_WORDS) };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type RowChoice = {
  readonly row: number;
  readonly claim: Claim;
  readonly reload: Reload | null;
  readonly live: Live;
};

function bestRow(
  ctx: Context,
  el: IndexedElement,
  claims: readonly Claim[]
): RowChoice {
  const live = liveContext(ctx.pair, el);
  const inContext = live.area || live.wording;
  let best: RowChoice | null = null;
  for (const claim of claims) {
    const reload = compareWithReload(ctx, el, claim);
    const row =
      reload !== null && reload.changed
        ? ROW_CHANGED
        : inContext
          ? ROW_IN_CONTEXT
          : ROW_PLAIN;
    if (best === null || row < best.row) best = { row, claim, reload, live };
  }
  // `claims` is never empty here; the fallback only satisfies the type checker.
  return best ?? { row: ROW_PLAIN, claim: claims[0], reload: null, live };
}

function gapOf(ctx: Context): number {
  return Math.round(ctx.pair.gapSeconds ?? 0);
}

function equalSentence(ctx: Context, choice: RowChoice): string {
  const { claim, reload } = choice;
  if (reload === null || reload.changed) return "";
  const gap = gapOf(ctx);
  return claim.kind === "purchase"
    ? ` The same message showed again after a reload ${gap} s later.`
    : ` It showed ${reload.firstShown} again after a reload ${gap} s later.`;
}

function draftFor(ctx: Context, el: IndexedElement, choice: RowChoice): FindingDraft {
  const { row, claim, reload, live } = choice;
  const q = quote(el.text);

  if (row === ROW_CHANGED && reload !== null) {
    const gap = gapOf(ctx);
    if (claim.kind === "purchase") {
      return {
        patternId: PATTERN,
        confidence: "high",
        title: TITLE_PURCHASE_CHANGED,
        description: DESCRIPTION_PURCHASE_CHANGED,
        evidenceText: `Message ${q}, then ${quote(reload.reloadText)} after a reload ${gap} s later.`,
        measuredValues: { gapSeconds: gap },
        elements: [el],
        ruleOrder: row,
      };
    }
    return {
      patternId: PATTERN,
      confidence: "high",
      title: TITLE_NUMBER_CHANGED,
      description: DESCRIPTION_NUMBER_CHANGED,
      evidenceText: `Activity message ${q} showed ${reload.firstShown}, then ${reload.reloadShown} after a reload ${gap} s later.`,
      measuredValues: {
        firstValue: reload.firstValue,
        reloadValue: reload.reloadValue,
        gapSeconds: gap,
      },
      elements: [el],
      ruleOrder: row,
    };
  }

  const confidence: Confidence = row === ROW_IN_CONTEXT ? "medium" : "low";
  return {
    patternId: PATTERN,
    confidence,
    title: TITLE_MESSAGE,
    // The sentence about the area is only true for a role, `aria-live` or position;
    // wording such as "right now" alone does not put the message in such an area.
    description: live.area
      ? `${DESCRIPTION_MESSAGE}${SENTENCE_LIVE_AREA}`
      : DESCRIPTION_MESSAGE,
    evidenceText: `Message ${q}.${equalSentence(ctx, choice)}`,
    elements: [el],
    ruleOrder: row,
  };
}

function keyOf(tokens: readonly Token[], claim: Claim): string {
  const parts: string[] = [];
  for (let i = claim.start; i < claim.end; i += 1) {
    const token = tokens[i];
    if (token !== undefined) parts.push(token.norm);
  }
  return `${claim.kind}:${parts.join(" ")}`;
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
 * Detect possible fake activity in one snapshot. A value that is not a usable
 * snapshot gives an empty array. An unexpected exception propagates; the
 * registry reports it (requirement 6.1).
 */
export function detectFakeActivity(snapshot: PageSnapshot): Finding[] {
  const pair = buildSamplePair(snapshot);
  const detectedAt = detectedAtFrom(snapshot);
  const ctx: Context = { pair, stable: new Map<IndexedElement, Claims>() };

  const candidates: Candidate[] = [];
  for (const el of pair.first.elements) {
    if (el.hidden || el.tokens.length === 0) continue;
    if (hasAny(el.tokens, LOOKALIKES)) continue;
    const claims = claimsOf(el.tokens);
    if (claims.length === 0) continue;
    const choice = bestRow(ctx, el, claims);
    candidates.push({
      el,
      key: keyOf(el.tokens, choice.claim),
      draft: draftFor(ctx, el, choice),
    });
  }

  const drafts = keepDeepest(ctx, candidates).map((c) => c.draft);
  return finaliseFindings(drafts, {
    detectedAt,
    pageTruncated: pair.first.captureTruncated || pair.first.budgetHit,
  });
}
