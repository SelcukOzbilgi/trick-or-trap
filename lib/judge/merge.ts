import { buildIndex } from "@/lib/detectors/shared/elements";
import {
  EXPLANATIONS,
  containsForbidden,
  detectedAtFrom,
  lowerConfidence,
} from "@/lib/detectors/shared/finding";
import type { BuiltCandidates } from "@/lib/judge/candidates";
import { MAX_FINDINGS_KEPT, MAX_REJECTS } from "@/lib/judge/constants";
import { DEFAULT_TEMPLATES } from "@/lib/judge/templates";
import type { JudgeTemplates } from "@/lib/judge/templates";
import { LOOK_ALIKE_CODES } from "@/lib/judge/types";
import type {
  AnomalyCode,
  JudgePatternId,
  ReasonCode,
  ReviewedFinding,
  RuleKind,
  SetAsideFinding,
} from "@/lib/judge/types";
import type { ValidatedFinding, ValidatedVerdict, ValidationResult } from "@/lib/judge/validate";
import { FindingSchema } from "@/lib/types";
import type { BoundingBox, Confidence, Finding, PageSnapshot } from "@/lib/types";

/**
 * Merge of the rule findings with the validated judge output (requirement 11,
 * design section 15, note 1.1 to 1.4). The judge may add low findings and
 * lower or set aside rule findings under fixed powers; it never raises a level
 * and never deletes a finding. Pure: no clock, no randomness, no state.
 */

/** The validated output that merge reads. */
export type ValidatedOk = Extract<ValidationResult, { kind: "ok" }>;

export type MergeOutput = {
  findings: ReviewedFinding[];
  setAside: SetAsideFinding[];
  /** The anomalies of validation plus `too-many-rejects` found here. */
  anomalies: AnomalyCode[];
};

const RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

function isLookAlike(code: string): boolean {
  return (LOOK_ALIKE_CODES as readonly string[]).includes(code);
}

// -- Judge finding assembly ---------------------------------------------------

/** What `assembleJudgeFinding` needs; the quote is already verified. */
export type JudgeFindingInput = {
  pattern: JudgePatternId;
  quote: string;
  reason: ReasonCode;
  /** The candidate's element ids, primary first. */
  elementIds: readonly string[];
  /** One box per element id. */
  boundingBoxes: readonly BoundingBox[];
  /** ISO time of the capture. */
  detectedAt: string;
};

/**
 * Build one judge finding from the templates (requirement 10.1, 11.18): the
 * confidence is always low, the detector name is "judge", and the only model
 * text is the quote, which the templates pass through `quote()`. Returns
 * `null` when any string holds a forbidden word or the result does not pass
 * `FindingSchema`. The template parameter lets a test check the drop rule.
 */
export function assembleJudgeFinding(
  input: JudgeFindingInput,
  templates: JudgeTemplates = DEFAULT_TEMPLATES,
): Finding | null {
  const title = templates.titles[input.pattern];
  const description = templates.description(input.quote, input.reason);
  const evidenceText = templates.evidenceText(input.quote);
  const reasonSentence = templates.reasonSentences[input.reason];
  const explanation = EXPLANATIONS[input.pattern];
  for (const text of [title, description, evidenceText, reasonSentence, explanation]) {
    if (typeof text !== "string" || containsForbidden(text)) return null;
  }
  const parsed = FindingSchema.safeParse({
    patternId: input.pattern,
    confidence: "low",
    title,
    description,
    evidence: { text: evidenceText },
    elementIds: [...input.elementIds],
    boundingBoxes: input.boundingBoxes.map((box) => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    })),
    explanation,
    detectorName: "judge",
    detectedAt: input.detectedAt,
  });
  return parsed.success ? parsed.data : null;
}

// -- Element relations --------------------------------------------------------

/**
 * Equal ids, or one id is an ancestor of the other. Ancestry compares whole
 * dash-separated segments, so `el-0-1` is not an ancestor of `el-0-12`.
 */
function related(a: string, b: string): boolean {
  if (a === b) return true;
  const left = a.split("-");
  const right = b.split("-");
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return shorter.every((segment, i) => longer[i] === segment);
}

function sharesElement(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => related(x, y)));
}

// -- Verdicts -----------------------------------------------------------------

function downgradedLevel(kind: RuleKind, level: Confidence, reason: string): Confidence {
  let next: Confidence;
  if (kind === "reload") {
    // One level, floor medium; the floor wins over a look-alike cap.
    next = level === "high" ? "medium" : level;
  } else if (kind === "measured") {
    next = "low";
  } else {
    next = isLookAlike(reason) ? "low" : lowerConfidence(level);
  }
  // A verdict never raises a level.
  return RANK[next] <= RANK[level] ? next : level;
}

type Applied =
  | { type: "confirm"; reason: ReasonCode }
  | { type: "downgrade"; reason: ReasonCode }
  | { type: "set-aside"; reason: ReasonCode };

function isRejectable(kind: RuleKind): boolean {
  return kind === "structural" || kind === "text";
}

/** Turn one verdict into what happens to its rule finding; `null` ignores it. */
function applyVerdict(kind: RuleKind, verdict: ValidatedVerdict): Applied | null {
  if (verdict.decision === "confirm") return { type: "confirm", reason: verdict.reason };
  if (verdict.decision === "downgrade") return { type: "downgrade", reason: verdict.reason };
  if (!isRejectable(kind)) return null;
  if (verdict.confidence === "high" && isLookAlike(verdict.reason)) {
    return { type: "set-aside", reason: verdict.reason };
  }
  return { type: "downgrade", reason: verdict.reason };
}

// -- Ordering -----------------------------------------------------------------

type Positioned<T> = { item: T; position: number; pattern: string; seq: number };

function sortPositioned<T>(entries: Positioned<T>[]): T[] {
  return entries
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0) ||
        a.seq - b.seq,
    )
    .map((entry) => entry.item);
}

// -- Merge --------------------------------------------------------------------

/**
 * Merge the rule findings with the validated output (design section 15).
 * `ruleFindings` is the array given to `buildCandidates`; `built.map.rules`
 * gives the index of each sent rule finding in it.
 */
export function mergeReview(
  ruleFindings: readonly Finding[],
  built: BuiltCandidates,
  validated: ValidatedOk,
  snapshot: PageSnapshot,
): MergeOutput {
  const anomalies: AnomalyCode[] = [...validated.anomalies];

  // Kind and verdict of each sent rule finding, by index in `ruleFindings`.
  const kindByIndex = new Map<number, RuleKind>();
  const ruleIdByIndex = new Map<number, string>();
  for (const [id, mapped] of built.map.rules) {
    kindByIndex.set(mapped.index, mapped.kind);
    ruleIdByIndex.set(mapped.index, id);
  }
  const verdictByIndex = new Map<number, ValidatedVerdict>();
  for (const verdict of validated.verdicts) {
    const mapped = built.map.rules.get(verdict.rule);
    if (mapped === undefined || verdictByIndex.has(mapped.index)) continue;
    verdictByIndex.set(mapped.index, verdict);
  }

  // A reject on a reload or measured finding is ignored and counts for nothing.
  for (const [index, verdict] of [...verdictByIndex]) {
    const kind = kindByIndex.get(index) as RuleKind;
    if (verdict.decision === "reject" && !isRejectable(kind)) verdictByIndex.delete(index);
  }

  // Steps 1 and 2: an anomalous run, or too many rejects, ignores every verdict.
  let ignoreVerdicts = anomalies.length > 0;
  if (!ignoreVerdicts) {
    let rejectable = 0;
    for (const kind of kindByIndex.values()) if (isRejectable(kind)) rejectable += 1;
    let rejects = 0;
    for (const verdict of verdictByIndex.values()) {
      if (verdict.decision === "reject") rejects += 1;
    }
    if (rejects > Math.min(MAX_REJECTS, Math.floor(rejectable / 2))) {
      anomalies.push("too-many-rejects");
      ignoreVerdicts = true;
    }
  }
  if (ignoreVerdicts) verdictByIndex.clear();

  // Step 3: a judge finding on a rule finding's element is a confirm, never a marker.
  const duplicates = new Set<ValidatedFinding>();
  for (const found of validated.findings) {
    const mapped = built.map.candidates.get(found.candidate);
    if (mapped === undefined) continue;
    ruleFindings.forEach((rule, index) => {
      if (rule.patternId !== found.pattern) return;
      if (!sharesElement(mapped.elementIds, rule.elementIds)) return;
      duplicates.add(found);
      if (ignoreVerdicts || verdictByIndex.has(index)) return;
      if (!kindByIndex.has(index)) return;
      verdictByIndex.set(index, {
        rule: ruleIdByIndex.get(index) as ValidatedVerdict["rule"],
        decision: "confirm",
        confidence: found.confidence,
        reason: found.reason,
      });
    });
  }

  // Step 4: apply the verdicts.
  const index = buildIndex(snapshot, false);
  const positionOf = (ids: readonly string[]): number => {
    const first = ids.length > 0 ? index.byId(ids[0]) : undefined;
    return first === undefined ? Number.POSITIVE_INFINITY : first.order;
  };

  const kept: Positioned<ReviewedFinding>[] = [];
  const aside: Positioned<SetAsideFinding>[] = [];
  let seq = 0;
  ruleFindings.forEach((rule, i) => {
    const entryBase = {
      position: positionOf(rule.elementIds),
      pattern: rule.patternId,
      seq: (seq += 1),
    };
    const verdict = verdictByIndex.get(i);
    const kind = kindByIndex.get(i);
    const applied = verdict && kind ? applyVerdict(kind, verdict) : null;
    if (!applied || !kind) {
      kept.push({ ...entryBase, item: { finding: rule, source: "rules" } });
      return;
    }
    if (applied.type === "set-aside") {
      aside.push({
        ...entryBase,
        item: { finding: rule, judgeReason: applied.reason },
      });
      return;
    }
    if (applied.type === "confirm") {
      kept.push({
        ...entryBase,
        item: { finding: rule, source: "rules+judge", judgeReason: applied.reason },
      });
      return;
    }
    const level = downgradedLevel(kind, rule.confidence, applied.reason);
    const changed = level !== rule.confidence;
    kept.push({
      ...entryBase,
      item: {
        finding: changed ? { ...rule, confidence: level } : rule,
        source: "rules+judge",
        judgeReason: applied.reason,
        ...(changed ? { ruleConfidence: rule.confidence } : {}),
      },
    });
  });

  // Step 5: judge-only findings, always low.
  const detectedAt = detectedAtFrom(snapshot).iso;
  const boxById = new Map<string, BoundingBox>();
  for (const element of snapshot.elements) {
    if (!boxById.has(element.id)) boxById.set(element.id, element.boundingBox);
  }
  const seen = new Set<string>();
  const added: Positioned<ReviewedFinding>[] = [];
  for (const found of validated.findings) {
    if (duplicates.has(found) || found.confidence === "low") continue;
    const mapped = built.map.candidates.get(found.candidate);
    if (mapped === undefined) continue;
    const key = `${found.pattern}|${found.candidate}`;
    if (seen.has(key)) continue;
    const ids = mapped.elementIds.filter((id) => boxById.has(id));
    const finding = assembleJudgeFinding({
      pattern: found.pattern,
      quote: found.quote,
      reason: found.reason,
      elementIds: ids,
      boundingBoxes: ids.map((id) => boxById.get(id) as BoundingBox),
      detectedAt,
    });
    if (finding === null) continue;
    seen.add(key);
    added.push({
      position: mapped.order,
      pattern: found.pattern,
      seq: (seq += 1),
      item: { finding, source: "judge", judgeReason: found.reason },
    });
  }
  const newFindings = sortPositioned(added).slice(0, MAX_FINDINGS_KEPT);
  newFindings.forEach((item) => {
    kept.push({
      position: positionOf(item.finding.elementIds),
      pattern: item.finding.patternId,
      seq: (seq += 1),
      item,
    });
  });

  // Step 6: order both lists.
  return {
    findings: sortPositioned(kept),
    setAside: sortPositioned(aside),
    anomalies,
  };
}
