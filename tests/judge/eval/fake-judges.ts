import type { JudgeRawResponse, JudgeRequest } from "@/lib/judge/interface";
import { readPageData } from "@/lib/judge/mock";
import { FLAG_CODES_BY_PATTERN, JUDGE_PATTERN_IDS } from "@/lib/judge/types";

/**
 * Two fake judges for the evaluation harness (design section 18). Each is a
 * script step for `createMockJudge`: it reads the data block of the request
 * with `readPageData` and answers with a deterministic JSON text. Neither
 * calls a model, and neither holds state.
 *
 * `noisyJudge` is the worst case for the merge: it adds a high finding on each
 * of the first candidates and confirms every rule finding. `downgradeAllJudge`
 * only lowers: it downgrades every rule finding. Both only add findings or
 * lower levels, so the merge must keep the medium-or-high false positives at
 * or below the rules-only count.
 */

const USAGE = Object.freeze({ input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 });

/** How many candidates the noisy judge flags. */
export const NOISY_JUDGE_FLAGGED = 8;

const QUOTE_MAX_CHARS = 20;

function respond(output: object): JudgeRawResponse {
  return {
    text: JSON.stringify(output),
    stopReason: "end_turn",
    usage: { ...USAGE },
  };
}

/** The first characters of the candidate text, by code point, at most 20. */
function quoteOf(text: string): string {
  return Array.from(text).slice(0, QUOTE_MAX_CHARS).join("");
}

/**
 * For the first 8 candidates of the request, one high finding each, the
 * patterns in rotation; the quote is the first characters of the candidate
 * text and the reason is the first flag code of the pattern. For every rule
 * finding, a confirm with the first flag code of its pattern.
 */
export function noisyJudge(request: JudgeRequest): JudgeRawResponse {
  const data = readPageData(request);
  const findings = data.candidates.slice(0, NOISY_JUDGE_FLAGGED).map((candidate, index) => {
    const pattern = JUDGE_PATTERN_IDS[index % JUDGE_PATTERN_IDS.length];
    return {
      candidate: candidate.id,
      pattern,
      quote: quoteOf(candidate.text),
      confidence: "high" as const,
      reason: FLAG_CODES_BY_PATTERN[pattern][0],
    };
  });
  const verdicts = data.ruleFindings.map((rule) => ({
    rule: rule.id,
    decision: "confirm" as const,
    confidence: "high" as const,
    reason: FLAG_CODES_BY_PATTERN[rule.pattern][0],
  }));
  return respond({ findings, verdicts });
}

/**
 * No finding, and a downgrade with `insufficient-context` for every rule finding.
 * The merge ignores or voids this answer (requirement 20.15): with three or more
 * sent rule findings it is `ran-anomalous` and changes nothing.
 */
export function downgradeAllJudge(request: JudgeRequest): JudgeRawResponse {
  const data = readPageData(request);
  const verdicts = data.ruleFindings.map((rule) => ({
    rule: rule.id,
    decision: "downgrade" as const,
    confidence: "high" as const,
    reason: "insufficient-context" as const,
  }));
  return respond({ findings: [], verdicts });
}
