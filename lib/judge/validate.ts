import type { CandidateMap, MappedCandidate } from "@/lib/judge/candidates";
import {
  ANOMALY_FLAGGED_MIN,
  ANOMALY_FLAGGED_SHARE,
  ANOMALY_MAX_FINDINGS,
  JUDGE_QUOTE_MAX_CHARS,
  JUDGE_QUOTE_MIN_CHARS,
  MAX_FINDINGS_KEPT,
  MAX_VERDICTS,
} from "@/lib/judge/constants";
import { JudgeOutputSchema } from "@/lib/judge/schema";
import type { JudgeFindingItem, JudgeVerdictItem } from "@/lib/judge/schema";
import {
  FLAG_CODES_BY_PATTERN,
  INSUFFICIENT_CONTEXT,
  JUDGE_PATTERN_IDS,
  LOOK_ALIKE_CODES,
} from "@/lib/judge/types";
import type { AnomalyCode, JudgePatternId } from "@/lib/judge/types";
import type { Finding } from "@/lib/types";

/**
 * Validation of the model's answer in code (requirement 9, design section 13,
 * note 3.2 and 3.3). Pure: no clock, no randomness, no state. The answer is
 * data until every rule below has passed. Nothing the model wrote is returned
 * except ids, enum values and a quote that is a verified substring of text the
 * code itself sent.
 */

/** The part of a raw model response that validation reads. */
export type ValidatorInput = { text: string; stopReason: string };

/** A finding that passed every check. The quote is NFC and whitespace-collapsed. */
export type ValidatedFinding = JudgeFindingItem;

/** A verdict that passed the family check. */
export type ValidatedVerdict = JudgeVerdictItem;

export type ValidationResult =
  | { kind: "invalid" }
  | {
      kind: "ok";
      /** At most `MAX_FINDINGS_KEPT`, in document order, then pattern id. */
      findings: ValidatedFinding[];
      /** At most one per rule id, in the order the model gave them. */
      verdicts: ValidatedVerdict[];
      /** `too-many-findings` and `too-many-flagged`; the reject limit is merge's. */
      anomalies: AnomalyCode[];
      /** Number of findings in the answer, before any drop. */
      returned: number;
    };

const INVALID: ValidationResult = { kind: "invalid" };

/** NFC and whitespace collapse, applied to the quote and to the sent text. */
function normaliseForQuote(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** A URL or a markup tag is never a quote, whatever the page text holds. */
const URL_SCHEME = /:\/\//u;
const MARKUP = /<\/?[a-z!][^>]*>/iu;

function includes<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

function isFlagCodeOf(pattern: JudgePatternId, code: string): boolean {
  return includes(FLAG_CODES_BY_PATTERN[pattern], code);
}

function isLookAlike(code: string): boolean {
  return includes(LOOK_ALIKE_CODES, code);
}

/** The structural conditions of requirements 9.6 and 9.7. */
function fitsStructure(pattern: JudgePatternId, candidate: MappedCandidate): boolean {
  if (pattern === "preselection") {
    return candidate.control !== undefined && candidate.checked === true;
  }
  if (pattern === "visual-interference") return candidate.inButtonGroup;
  return true;
}

/** The checked quote of a finding, or `null` when the finding must be dropped. */
function checkedQuote(item: JudgeFindingItem, candidate: MappedCandidate): string | null {
  const raw = item.quote;
  if (raw.length < JUDGE_QUOTE_MIN_CHARS || raw.length > JUDGE_QUOTE_MAX_CHARS) return null;
  const quote = normaliseForQuote(raw);
  if (quote.length < JUDGE_QUOTE_MIN_CHARS) return null;
  if (URL_SCHEME.test(quote) || MARKUP.test(quote)) return null;
  const sources = [candidate.text, ...candidate.parts];
  if (!sources.some((source) => normaliseForQuote(source).includes(quote))) return null;
  return quote;
}

function validateFindings(
  items: readonly JudgeFindingItem[],
  map: CandidateMap,
): ValidatedFinding[] {
  const valid: ValidatedFinding[] = [];
  for (const item of items) {
    const candidate = map.candidates.get(item.candidate);
    if (candidate === undefined) continue;
    if (!isFlagCodeOf(item.pattern, item.reason)) continue;
    if (!fitsStructure(item.pattern, candidate)) continue;
    const quote = checkedQuote(item, candidate);
    if (quote === null) continue;
    valid.push({ ...item, quote });
  }
  return valid;
}

/** The family rules of requirement 9.9; `pattern` is the rule finding's own. */
function familyAllows(
  decision: JudgeVerdictItem["decision"],
  reason: string,
  pattern: JudgePatternId,
): boolean {
  if (decision === "reject") return isLookAlike(reason);
  if (decision === "confirm") return isFlagCodeOf(pattern, reason);
  return isLookAlike(reason) || isFlagCodeOf(pattern, reason) || reason === INSUFFICIENT_CONTEXT;
}

function validateVerdicts(
  items: readonly JudgeVerdictItem[],
  map: CandidateMap,
  ruleFindings: readonly Pick<Finding, "patternId">[],
): ValidatedVerdict[] {
  const seen = new Set<string>();
  const valid: ValidatedVerdict[] = [];
  for (const item of items.slice(0, MAX_VERDICTS)) {
    const rule = map.rules.get(item.rule);
    if (rule === undefined) continue;
    if (seen.has(item.rule)) continue;
    seen.add(item.rule);
    const patternId = ruleFindings[rule.index]?.patternId;
    if (patternId === undefined || !includes(JUDGE_PATTERN_IDS, patternId)) continue;
    if (!familyAllows(item.decision, item.reason, patternId)) continue;
    valid.push(item);
  }
  return valid;
}

/** The kept findings: first by document position of the candidate, then by pattern id. */
function keepFindings(valid: readonly ValidatedFinding[], map: CandidateMap): ValidatedFinding[] {
  const order = (item: ValidatedFinding): number =>
    map.candidates.get(item.candidate)?.order ?? Number.MAX_SAFE_INTEGER;
  return valid
    .map((item, position) => ({ item, position }))
    .sort(
      (a, b) =>
        order(a.item) - order(b.item) ||
        (a.item.pattern < b.item.pattern ? -1 : a.item.pattern > b.item.pattern ? 1 : 0) ||
        a.position - b.position,
    )
    .slice(0, MAX_FINDINGS_KEPT)
    .map(({ item }) => item);
}

/**
 * Validate one raw response against the map of what was sent.
 *
 * `ruleFindings` is the array that was given to `buildCandidates`: the map
 * gives each sent rule finding's index into it, and the pattern of that
 * finding decides which reason codes a verdict may use.
 */
export function validateOutput(
  raw: ValidatorInput,
  map: CandidateMap,
  ruleFindings: readonly Pick<Finding, "patternId">[],
): ValidationResult {
  if (raw.stopReason === "max_tokens") return INVALID;
  if (raw.text.trim() === "") return INVALID;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    return INVALID;
  }
  const output = JudgeOutputSchema.safeParse(parsed);
  if (!output.success) return INVALID;

  const anomalies: AnomalyCode[] = [];
  if (output.data.findings.length > ANOMALY_MAX_FINDINGS) anomalies.push("too-many-findings");

  const valid = validateFindings(output.data.findings, map);
  const flagged = new Set(valid.map((item) => item.candidate)).size;
  if (flagged >= ANOMALY_FLAGGED_MIN && flagged > ANOMALY_FLAGGED_SHARE * map.candidates.size) {
    anomalies.push("too-many-flagged");
  }

  return {
    kind: "ok",
    findings: keepFindings(valid, map),
    verdicts: validateVerdicts(output.data.verdicts, map, ruleFindings),
    anomalies,
    returned: output.data.findings.length,
  };
}
