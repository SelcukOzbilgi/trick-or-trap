import type { JudgeStatus, ReviewResult } from "@/lib/judge/types";

/**
 * The one line shown above the findings (design section 14, requirement 10).
 * UI code calls `statusLine` and never writes its own sentence. It imports
 * types only. Pure: no clock, no randomness, no state.
 */

/** Always the last sentence of a status line. */
export const DISCLAIMER = "Automated detection — may be wrong.";

/** The statuses under which the reviewer did not run. */
export type NotRunStatus = Exclude<JudgeStatus, "ran" | "ran-anomalous">;

/** The reason shown for each status in which the reviewer did not run. */
export const STATUS_REASONS: Readonly<Record<NotRunStatus, string>> = Object.freeze({
  off: "turned off",
  "skipped-no-time": "not enough time left in this scan",
  "skipped-over-budget": "daily limit reached",
  "skipped-cooldown": "daily limit reached",
  timeout: "it took too long",
  error: "it could not be reached",
  "invalid-output": "its answer could not be used",
});

const RAN_WITH_FINDINGS = "Checked by rules and a language-model reviewer.";
const NONE_FOUND = "No possible patterns found.";
const ANOMALOUS =
  "Checked by rules. The reviewer's answer looked unusual, so only its new findings were kept and none of the rule matches were set aside.";
const NONE_FOUND_NOT_RUN =
  "No possible patterns found by the rules. The reviewer did not run.";
const RULE_ERRORS =
  "Part of the rule check failed, so this result is incomplete.";
/** Added when the reviewer ran but saw a cut-down page (requirement 24.1). */
const PARTIAL = "The reviewer saw only part of this page.";

function notRunLine(status: NotRunStatus): string {
  return `Checked by rules only. The language-model reviewer did not run (${STATUS_REASONS[status]}), so wording outside the rules was not checked.`;
}

/**
 * The status line of a review result. The list is empty when `findings` is
 * empty; the set-aside list does not count. A result whose reviewer did not
 * run never reads as a bare "nothing found".
 */
export function statusLine(
  result: Pick<ReviewResult, "findings" | "judge" | "ruleErrors">,
): string {
  const empty = result.findings.length === 0;
  const status = result.judge.status;
  const sentences: string[] = [];

  if (status === "ran") {
    sentences.push(empty ? NONE_FOUND : RAN_WITH_FINDINGS);
  } else if (status === "ran-anomalous") {
    sentences.push(ANOMALOUS);
    if (empty) sentences.push(NONE_FOUND);
  } else {
    sentences.push(empty ? NONE_FOUND_NOT_RUN : notRunLine(status));
  }

  // The reviewer saw nothing under any other status, so only these two add it.
  if ((status === "ran" || status === "ran-anomalous") && result.judge.truncated) {
    sentences.push(PARTIAL);
  }

  if (result.ruleErrors > 0) sentences.push(RULE_ERRORS);
  sentences.push(DISCLAIMER);
  return sentences.join(" ");
}
