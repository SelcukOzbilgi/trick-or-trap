import { quote } from "@/lib/detectors/shared/text";
import type { JudgePatternId, ReasonCode } from "@/lib/judge/types";

/**
 * Every sentence of a judge finding (design section 14, requirement 10). The
 * code writes all of them; the only model text in a finding is the verified
 * quote, which passes through `quote()` before it enters a template. Pure: no
 * clock, no randomness, no state.
 *
 * Each sentence describes what is on the screen. None asserts intent, and
 * none holds a word of the forbidden list; `tests/judge/wording.test.ts`
 * checks both.
 */

/** The fixed title of a judge finding, one per pattern. Each starts with "Possible". */
export const JUDGE_TITLES: Readonly<Record<JudgePatternId, string>> = Object.freeze({
  "fake-urgency": "Possible fake urgency: deadline wording",
  "fake-scarcity": "Possible fake scarcity: stock wording",
  "fake-activity": "Possible fake activity: shopper activity wording",
  confirmshaming: "Possible confirmshaming: decline wording",
  preselection: "Possible preselection: option selected in advance",
  "visual-interference": "Possible visual interference: uneven choice",
});

/** One sentence per reason code, written for what the page shows. */
export const REASON_SENTENCES: Readonly<Record<ReasonCode, string>> = Object.freeze({
  // Flag codes: urgency
  "undated-deadline": "The page shows a time limit with no calendar date.",
  "rolling-deadline": "The deadline rolls over: it has no calendar date.",
  "personal-timer": "The page shows a timer that appears to be set for this visitor.",
  "pressure-wording": "The wording presses for a quick decision about a time limit.",
  // Flag codes: scarcity
  "vague-low-stock": "The page says that stock is low without giving a clear number.",
  "stock-with-pressure":
    "The page pairs a stock claim with wording that presses for a quick purchase.",
  "selling-fast-claim": "The page claims that the item is selling fast.",
  // Flag codes: activity
  "live-viewers": "The page says that other people are looking at the item right now.",
  "live-baskets": "The page says that the item is in the baskets of other people now.",
  "recent-purchase-notice": "The page shows a notice that someone recently bought the item.",
  "recent-count": "The page gives a count of recent purchases or visits.",
  // Flag codes: confirmshaming
  "shaming-decline":
    "The decline option is phrased as a put-down of the shopper who declines.",
  "guilt-decline":
    "The decline option is phrased so that declining sounds like a loss or a wrong.",
  // Flag codes: preselection
  "prechecked-paid-addon": "A paid add-on is ticked before the shopper has chosen it.",
  "prechecked-marketing":
    "A box for marketing messages is ticked before the shopper has chosen it.",
  "prechecked-data-sharing":
    "A box for sharing data is ticked before the shopper has chosen it.",
  "preselected-recurring":
    "A recurring payment option is selected before the shopper has chosen it.",
  "preselected-pricier": "The pricier option is selected before the shopper has chosen it.",
  // Flag codes: visual interference
  "faint-decline": "The decline option is shown in faint text that is hard to read.",
  "tiny-decline": "The decline option is much smaller than the other choice.",
  "tiny-close": "The close control is very small.",
  // Look-alike codes
  "dated-deadline": "The deadline has a calendar date.",
  "true-by-nature-deadline":
    "The time limit belongs to a real process, such as a shipping cut-off or opening hours.",
  "duration-not-deadline": "The time shown is a length of time, not a deadline.",
  "holiday-countdown": "The countdown runs to a holiday, not to an offer deadline.",
  "neutral-stock-fact": "The stock count is stated as a plain fact, with no pressure wording.",
  "edition-or-purchase-limit":
    "The number is an edition size or a purchase limit, not a claim of low stock.",
  "cumulative-count": "The number is a running total, such as ratings or reviews.",
  "own-order-status": "The text is about the shopper's own order or history.",
  "review-or-quote": "The text is a review or a quote from a person.",
  "neutral-decline": "The decline option is worded in plain, neutral terms.",
  "not-a-decline": "The text is not a decline option.",
  "required-terms":
    "This box looks like a required agreement, which is normally ticked by the shopper.",
  "free-or-cheapest-default":
    "The option that is selected in advance is free or the cheapest one.",
  "neutral-default": "The option that is selected in advance is a neutral convenience.",
  "comparable-prominence": "The choices are about equally easy to see.",
  "not-a-choice": "The element is not part of a choice.",
  "disabled-control": "The control is disabled.",
  // Other
  "insufficient-context": "The reviewer could not tell from the text on the page.",
});

/** The heading above the rule findings the judge set aside. */
export const SET_ASIDE_HEADING = "Set aside as a likely honest look-alike";

/** The words before the quote in the evidence text. */
export const JUDGE_EVIDENCE_PREFIX = "Text checked by the reviewer: ";

const DESCRIPTION_TAIL = "A language-model reviewer flagged this; nothing was measured.";

/**
 * "The page shows {quote}. {reason sentence} A language-model reviewer flagged
 * this; nothing was measured." The quote goes through `quote()`, which masks
 * forbidden words and cuts long text.
 */
export function judgeDescription(rawQuote: string, reason: ReasonCode): string {
  return `The page shows ${quote(rawQuote)}. ${REASON_SENTENCES[reason]} ${DESCRIPTION_TAIL}`;
}

/** "Text checked by the reviewer: {quote}." */
export function judgeEvidenceText(rawQuote: string): string {
  return `${JUDGE_EVIDENCE_PREFIX}${quote(rawQuote)}.`;
}

/**
 * The template set that `assembleJudgeFinding` of `merge.ts` takes as a
 * parameter, so a test can pass a set that holds a forbidden word and check
 * that the finding is dropped.
 */
export type JudgeTemplates = {
  titles: Readonly<Record<JudgePatternId, string>>;
  reasonSentences: Readonly<Record<ReasonCode, string>>;
  description(rawQuote: string, reason: ReasonCode): string;
  evidenceText(rawQuote: string): string;
};

export const DEFAULT_TEMPLATES: JudgeTemplates = Object.freeze({
  titles: JUDGE_TITLES,
  reasonSentences: REASON_SENTENCES,
  description: judgeDescription,
  evidenceText: judgeEvidenceText,
});
