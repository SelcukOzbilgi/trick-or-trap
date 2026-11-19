import {
  BENEFIT_LOSS_TERMS,
  FIRST_PERSON_SUFFIXES,
  FIRST_PERSON_TOKENS,
  NEGATION_EMOTION_TOKENS,
  SHAMING_PHRASES,
} from "@/lib/detectors/data/confirmshaming-words";
import {
  classifyControl,
  findChoiceGroups,
  isChoiceControl,
} from "@/lib/detectors/shared/choice-groups";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { IndexedElement } from "@/lib/detectors/shared/elements";
import {
  detectedAtFrom,
  finaliseFindings,
  TITLES,
} from "@/lib/detectors/shared/finding";
import type { FindingDraft } from "@/lib/detectors/shared/finding";
import {
  compilePhrases,
  hasAny,
  normaliseText,
  quote,
} from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * confirmshaming (requirement 11, design section 9.4).
 *
 * Reads the first sample only: text, tag, role, `type` and `aria-label`, ids,
 * visibility and boxes. Ignores the reload sample, colours, font sizes,
 * opacity (except for hidden), position, checked state and `secondSample`.
 *
 * Row C1: a decline control in a choice group that also holds an accept-like
 * control, whose text matches the list of shaming phrases (medium). Row C2: a
 * candidate for the later judge (low), either a decline control in such a group
 * with first-person wording, a negation or emotion word and a benefit or loss
 * word, or a listed phrase on a control that is not in such a group. Plain
 * declines such as "No thanks" are never candidates, and neither is the accept
 * control itself.
 */

const PATTERN = "confirmshaming" as const;
const TITLE = TITLES[PATTERN][0];

const DESCRIPTION_LISTED =
  "A decline option uses wording from a list of shaming phrases.";
const DESCRIPTION_CANDIDATE =
  "A decline option uses first-person negative wording about a benefit; it is a candidate for review.";

/** Rows of the table in requirement 11.9, in order. */
const ROW_LISTED = 1;
const ROW_CANDIDATE = 2;

const SHAMING = compilePhrases(SHAMING_PHRASES);
const FIRST_PERSON = compilePhrases(FIRST_PERSON_TOKENS);
const NEGATION_EMOTION = compilePhrases(NEGATION_EMOTION_TOKENS);
const BENEFIT_LOSS = compilePhrases(BENEFIT_LOSS_TERMS);

/** Verb endings of the first person, normalised like page text. */
const FIRST_PERSON_ENDINGS: readonly string[] = Object.freeze(
  [...new Set([...FIRST_PERSON_SUFFIXES.en, ...FIRST_PERSON_SUFFIXES.tr].map((s) => normaliseText(s)))].filter(
    (ending) => ending !== ""
  )
);

function isFirstPerson(tokens: readonly Token[]): boolean {
  if (hasAny(tokens, FIRST_PERSON)) return true;
  for (const token of tokens) {
    if (token.kind !== "word") continue;
    for (const ending of FIRST_PERSON_ENDINGS) {
      if (token.norm.length > ending.length && token.norm.endsWith(ending)) {
        return true;
      }
    }
  }
  return false;
}

/** The words of a control: its text, or its `aria-label` when it has no text. */
function labelOf(control: IndexedElement): string {
  return control.text !== "" ? control.text : (control.attr("aria-label") ?? "");
}

function evidenceFor(decline: IndexedElement, accept: IndexedElement | null): string {
  const next = accept === null ? "" : ` next to ${quote(labelOf(accept))}`;
  return `Decline option ${quote(labelOf(decline))}${next}.`;
}

function listedDraft(decline: IndexedElement, accept: IndexedElement): FindingDraft {
  return {
    patternId: PATTERN,
    confidence: "medium",
    title: TITLE,
    description: DESCRIPTION_LISTED,
    evidenceText: evidenceFor(decline, accept),
    measuredValues: { judgeCandidate: 1, phraseListMatch: 1 },
    elements: [decline, accept],
    ruleOrder: ROW_LISTED,
  };
}

function candidateDraft(
  decline: IndexedElement,
  accept: IndexedElement | null
): FindingDraft {
  return {
    patternId: PATTERN,
    confidence: "low",
    title: TITLE,
    description: DESCRIPTION_CANDIDATE,
    evidenceText: evidenceFor(decline, accept),
    measuredValues: { judgeCandidate: 1, phraseListMatch: 0 },
    elements: accept === null ? [decline] : [decline, accept],
    ruleOrder: ROW_CANDIDATE,
  };
}

/** A decline control next to an accept control: rows C1 and C2 (requirements 11.4, 11.5). */
function declineDraft(
  decline: IndexedElement,
  accept: IndexedElement
): FindingDraft | null {
  if (hasAny(decline.tokens, SHAMING)) return listedDraft(decline, accept);
  if (
    isFirstPerson(decline.tokens) &&
    hasAny(decline.tokens, NEGATION_EMOTION) &&
    hasAny(decline.tokens, BENEFIT_LOSS)
  ) {
    return candidateDraft(decline, accept);
  }
  return null;
}

/** Controls that can be a decline option: not accept-like, not a close glyph, not a plain decline. */
function canBeShaming(control: IndexedElement): boolean {
  const kind = classifyControl(control);
  return kind !== "accept" && kind !== "close" && kind !== "plain-decline";
}

/**
 * Detect possible confirmshaming in one snapshot. A value that is not a usable
 * snapshot gives an empty array. An unexpected exception propagates; the
 * registry reports it (requirement 6.1).
 */
export function detectConfirmshaming(snapshot: PageSnapshot): Finding[] {
  const index = buildIndex(snapshot, false);
  const detectedAt = detectedAtFrom(snapshot);
  const drafts: FindingDraft[] = [];
  // Controls of a group that holds an accept control; they are judged as decline controls only.
  const judged = new Set<IndexedElement>();

  for (const group of findChoiceGroups(index)) {
    const accept = group.controls.find((c) => classifyControl(c) === "accept");
    if (accept === undefined) continue;
    for (const control of group.controls) {
      judged.add(control);
      if (control === accept || !canBeShaming(control)) continue;
      const draft = declineDraft(control, accept);
      if (draft !== null) drafts.push(draft);
    }
  }

  for (const control of index.elements) {
    if (judged.has(control) || !isChoiceControl(control)) continue;
    if (!hasAny(control.tokens, SHAMING) || !canBeShaming(control)) continue;
    drafts.push(candidateDraft(control, null));
  }

  return finaliseFindings(drafts, {
    detectedAt,
    pageTruncated: index.captureTruncated || index.budgetHit,
  });
}
