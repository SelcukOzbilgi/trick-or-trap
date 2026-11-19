import {
  BARE_STOCK_TEMPLATES,
  QUALIFIED_STOCK_TEMPLATES,
  SCARCITY_LOOKALIKES,
  SCARCITY_SUPPORT_WORDS,
  UNQUANTIFIED_SCARCITY,
} from "@/lib/detectors/data/scarcity-words";
import { LOW_STOCK_MAX, RELOAD_TEXT_CAP } from "@/lib/detectors/shared/constants";
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
import type { PhraseHit, Token } from "@/lib/detectors/shared/text";
import type { Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * fake-scarcity (requirement 9, design section 9.2).
 *
 * Reads only text, ids, visibility, boxes and the capture times of the two
 * samples. Ignores attributes, colours, font sizes, roles, positions and
 * `secondSample`. Per element the first matching row of the table in
 * requirement 9.8 applies: S1 and S2 need a number that differs across the
 * reload, S3 and S4 are text rows for a qualified claim, S5 is unquantified
 * wording. A bare claim with an equal number, or without a counterpart, gives
 * nothing (S6).
 */

const QUALIFIED = compilePhrases(QUALIFIED_STOCK_TEMPLATES);
const BARE = compilePhrases(BARE_STOCK_TEMPLATES);
const UNQUANTIFIED = compilePhrases(UNQUANTIFIED_SCARCITY);
const LOOKALIKES = compilePhrases(SCARCITY_LOOKALIKES);
const SUPPORT = compilePhrases(SCARCITY_SUPPORT_WORDS);

const PATTERN = "fake-scarcity" as const;

const TITLE_CHANGED = TITLES[PATTERN][0];
const TITLE_LOW_STOCK = TITLES[PATTERN][1];
const TITLE_WORDING = TITLES[PATTERN][2];

const DESCRIPTION_CHANGED = "A stock number changed between two reads of the page.";
const DESCRIPTION_LOW_STOCK = "A low-stock message with a number is shown.";
const DESCRIPTION_WORDING = "Scarcity wording without a number is shown.";

/** Rows of the table in requirement 9.8, in order. */
const ROW_QUALIFIED_CHANGED = 1;
const ROW_BARE_CHANGED = 2;
const ROW_SUPPORTED = 3;
const ROW_UNSUPPORTED = 4;
const ROW_UNQUANTIFIED = 5;

/** Larger numbers are not stock counts. */
const MAX_STOCK_NUMBER = 1_000_000;

type ClaimKind = "qualified" | "bare" | "unquantified";

type Claim = {
  readonly kind: ClaimKind;
  readonly entry: string;
  readonly start: number;
  readonly end: number;
  /** The stock number; null for an unquantified claim. */
  readonly value: number | null;
  /** The number as the page shows it. */
  readonly shown: string | null;
};

type Claims = {
  readonly tokens: readonly Token[];
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
  readonly value: number;
  readonly shown: string;
  readonly changed: boolean;
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

function overlaps(hit: PhraseHit, others: readonly PhraseHit[]): boolean {
  return others.some((other) => hit.start < other.end && other.start < hit.end);
}

function numberToken(tokens: readonly Token[], hit: PhraseHit): string | null {
  for (let i = hit.start; i < hit.end; i += 1) {
    const token = tokens[i];
    if (token !== undefined && token.kind === "number") return token.surface;
  }
  return null;
}

function stockClaim(
  kind: ClaimKind,
  tokens: readonly Token[],
  hit: PhraseHit
): Claim | null {
  const value = hit.numbers[0];
  const shown = numberToken(tokens, hit);
  if (
    value === undefined ||
    shown === null ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_STOCK_NUMBER
  ) {
    return null;
  }
  return { kind, entry: hit.entry, start: hit.start, end: hit.end, value, shown };
}

/** The claims of one token list: qualified, bare (not inside a qualified one) and unquantified. */
function claimsOf(tokens: readonly Token[]): Claim[] {
  const qualifiedHits = nonOverlapping(findPhrases(tokens, QUALIFIED));
  const bareHits = nonOverlapping(findPhrases(tokens, BARE)).filter(
    (hit) => !overlaps(hit, qualifiedHits)
  );
  const claims: Claim[] = [];
  for (const hit of qualifiedHits) {
    const claim = stockClaim("qualified", tokens, hit);
    if (claim !== null) claims.push(claim);
  }
  for (const hit of bareHits) {
    const claim = stockClaim("bare", tokens, hit);
    if (claim !== null) claims.push(claim);
  }
  for (const hit of nonOverlapping(findPhrases(tokens, UNQUANTIFIED))) {
    claims.push({
      kind: "unquantified",
      entry: hit.entry,
      start: hit.start,
      end: hit.end,
      value: null,
      shown: null,
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
  const made: Claims = { tokens, claims };
  ctx.stable.set(el, made);
  return made;
}

function sameTemplate(a: Claim, b: Claim): boolean {
  return a.kind === b.kind && a.entry === b.entry && b.value !== null;
}

// ---------------------------------------------------------------------------
// Reload comparison (requirements 9.6, 9.7, 7.15)
// ---------------------------------------------------------------------------

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
  if (claim.value === null) return null;

  const own = stableOf(ctx, el).claims.filter((c) => sameTemplate(claim, c));
  const rank = own.findIndex((c) => c.start === claim.start && c.end === claim.end);
  if (rank < 0) return null;

  const counterpart = findCounterpart(ctx.pair, el, (candidate) =>
    stableOf(ctx, candidate).claims.some((c) => sameTemplate(claim, c))
  );
  if (counterpart === null) return null;

  const theirs = stableOf(ctx, counterpart).claims.filter((c) =>
    sameTemplate(claim, c)
  );
  const match = theirs[rank] ?? theirs[0];
  if (match === undefined || match.value === null || match.shown === null) {
    return null;
  }
  return {
    value: match.value,
    shown: match.shown,
    changed: match.value !== claim.value,
  };
}

// ---------------------------------------------------------------------------
// Support (requirement 9.4)
// ---------------------------------------------------------------------------

function hasExclamation(tokens: readonly Token[]): boolean {
  return tokens.some((t) => t.kind === "symbol" && t.surface === "!");
}

function hasPressureWord(tokens: readonly Token[]): boolean {
  return hasAny(tokens, SUPPORT);
}

/** True when a qualified claim is "supported": small number, "!", pressure word or another claim. */
function isSupported(
  pair: SamplePair,
  el: IndexedElement,
  claim: Claim,
  otherClaim: boolean
): boolean {
  if (claim.value !== null && claim.value <= LOW_STOCK_MAX) return true;
  if (hasExclamation(el.tokens) || hasPressureWord(el.tokens)) return true;
  const parent = pair.first.ancestors(el, 1)[0];
  if (parent !== undefined && hasPressureWord(parent.tokens)) return true;
  return otherClaim;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type RowChoice = {
  readonly row: number;
  readonly claim: Claim;
  readonly reload: Reload | null;
};

function rowFor(
  claim: Claim,
  reload: Reload | null,
  supported: boolean
): number | null {
  const changed = reload !== null && reload.changed;
  if (claim.kind === "qualified") {
    if (changed) return ROW_QUALIFIED_CHANGED;
    return supported ? ROW_SUPPORTED : ROW_UNSUPPORTED;
  }
  if (claim.kind === "bare") return changed ? ROW_BARE_CHANGED : null;
  return ROW_UNQUANTIFIED;
}

function bestRow(
  ctx: Context,
  el: IndexedElement,
  claims: readonly Claim[],
  otherClaim: boolean
): RowChoice | null {
  let best: RowChoice | null = null;
  for (const claim of claims) {
    const reload = compareWithReload(ctx, el, claim);
    const supported =
      claim.kind === "qualified" && isSupported(ctx.pair, el, claim, otherClaim);
    const row = rowFor(claim, reload, supported);
    if (row === null) continue;
    if (best === null || row < best.row) best = { row, claim, reload };
  }
  return best;
}

function gapOf(ctx: Context): number {
  return Math.round(ctx.pair.gapSeconds ?? 0);
}

function draftFor(ctx: Context, el: IndexedElement, choice: RowChoice): FindingDraft {
  const { row, claim, reload } = choice;
  const q = quote(el.text);

  if (row === ROW_QUALIFIED_CHANGED || row === ROW_BARE_CHANGED) {
    const gap = gapOf(ctx);
    return {
      patternId: PATTERN,
      confidence: row === ROW_QUALIFIED_CHANGED ? "high" : "medium",
      title: TITLE_CHANGED,
      description: DESCRIPTION_CHANGED,
      evidenceText: `Stock message ${q} showed ${claim.shown ?? ""}, then ${reload?.shown ?? ""} after a reload ${gap} s later.`,
      measuredValues: {
        firstValue: claim.value ?? 0,
        reloadValue: reload?.value ?? 0,
        gapSeconds: gap,
      },
      elements: [el],
      ruleOrder: row,
    };
  }

  if (row === ROW_SUPPORTED || row === ROW_UNSUPPORTED) {
    const equal =
      reload !== null && !reload.changed
        ? ` It showed ${reload.shown} again after a reload ${gapOf(ctx)} s later.`
        : "";
    const confidence: Confidence = row === ROW_SUPPORTED ? "medium" : "low";
    return {
      patternId: PATTERN,
      confidence,
      title: TITLE_LOW_STOCK,
      description: DESCRIPTION_LOW_STOCK,
      evidenceText: `Stock message ${q}.${equal}`,
      elements: [el],
      ruleOrder: row,
    };
  }

  return {
    patternId: PATTERN,
    confidence: "low",
    title: TITLE_WORDING,
    description: DESCRIPTION_WORDING,
    evidenceText: `Text ${q}.`,
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
 * Detect possible fake scarcity in one snapshot. A value that is not a usable
 * snapshot gives an empty array. An unexpected exception propagates; the
 * registry reports it (requirement 6.1).
 */
export function detectFakeScarcity(snapshot: PageSnapshot): Finding[] {
  const pair = buildSamplePair(snapshot);
  const detectedAt = detectedAtFrom(snapshot);
  const ctx: Context = { pair, stable: new Map<IndexedElement, Claims>() };

  // First pass: the claims of every visible element that has no look-alike wording.
  const found: { el: IndexedElement; claims: Claim[] }[] = [];
  for (const el of pair.first.elements) {
    if (el.hidden || el.tokens.length === 0) continue;
    if (hasAny(el.tokens, LOOKALIKES)) continue;
    const claims = claimsOf(el.tokens);
    if (claims.length > 0) found.push({ el, claims });
  }

  // Elements that hold a qualified or unquantified claim support each other.
  const supporting = found
    .filter((f) => f.claims.some((c) => c.kind !== "bare"))
    .map((f) => f.el);
  const hasOtherClaim = (el: IndexedElement): boolean =>
    supporting.some(
      (other) =>
        other !== el &&
        !pair.first.isAncestor(other, el) &&
        !pair.first.isAncestor(el, other)
    );

  const candidates: Candidate[] = [];
  for (const { el, claims } of found) {
    const choice = bestRow(ctx, el, claims, hasOtherClaim(el));
    if (choice === null) continue;
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
