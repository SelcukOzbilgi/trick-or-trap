import { FindingSchema } from "@/lib/types";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * A pure detector function: receives a PageSnapshot and returns zero or more
 * Finding objects. Must have no side effects and make no network calls.
 */
export type Detector = (snapshot: PageSnapshot) => Finding[];

/** What went wrong with a detector during runDetectors(). */
export type DetectorErrorKind = "threw" | "non-array" | "invalid-finding";

/**
 * One detector failure. Plain serialisable data, not an Error instance.
 * `message` always contains the name the detector was registered under.
 */
export type DetectorError = {
  /** The name passed to registerDetector(), never the function's own name. */
  detectorName: string;
  kind: DetectorErrorKind;
  message: string;
  /** Zero-based index in the returned array. Only for "invalid-finding". */
  findingIndex?: number;
  /** JSON text of the offending item. Only for "invalid-finding". */
  finding?: string;
};

/** Result of runDetectors(): valid findings plus every failure. */
export type DetectorRunResult = {
  /** Findings that passed FindingSchema, in registration order. */
  findings: Finding[];
  /** One entry per failure, in the order the failures happened. */
  errors: DetectorError[];
};

/**
 * A detector registry. The methods do not use `this`, so they can be
 * destructured and called without a receiver.
 */
export type Registry = {
  /**
   * Register a detector under a unique, non-empty name. Throws TypeError for
   * an empty or whitespace-only name and Error for a duplicate name; the
   * registry is unchanged in both cases.
   */
  registerDetector(name: string, fn: Detector): void;
  /**
   * Run every registered detector, in registration order, against the
   * snapshot. A detector that throws, returns a non-array, or returns an
   * invalid finding is reported in `errors`; the other detectors still run and
   * this function does not throw because of detector behaviour.
   */
  runDetectors(snapshot: PageSnapshot): DetectorRunResult;
};

function describeThrown(value: unknown): string {
  try {
    return value instanceof Error ? value.message : String(value);
  } catch {
    return "[unprintable value]";
  }
}

function describeReceived(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}

function stringifyFinding(item: unknown): string {
  try {
    // JSON.stringify returns undefined for undefined, functions and symbols.
    const json = JSON.stringify(item) as string | undefined;
    return json ?? String(item);
  } catch {
    return "[unserializable finding]";
  }
}

function summariseIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length
        ? issue.path.map((segment) => String(segment)).join(".")
        : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** Create an independent detector registry. */
export function createRegistry(): Registry {
  // A Map keeps insertion order, which is the registration order.
  const detectors = new Map<string, Detector>();

  function registerDetector(name: string, fn: Detector): void {
    if (typeof name !== "string" || name.trim() === "") {
      throw new TypeError("Detector name must be a non-empty string");
    }
    if (detectors.has(name)) {
      throw new Error(`Detector "${name}" is already registered`);
    }
    detectors.set(name, fn);
  }

  function runDetectors(snapshot: PageSnapshot): DetectorRunResult {
    const findings: Finding[] = [];
    const errors: DetectorError[] = [];

    // Copy the entries so a detector cannot change what this run visits.
    for (const [name, fn] of [...detectors]) {
      let returned: unknown;
      try {
        returned = fn(snapshot);
      } catch (thrown) {
        errors.push({
          detectorName: name,
          kind: "threw",
          message: `Detector "${name}" threw: ${describeThrown(thrown)}`,
        });
        continue;
      }

      if (!Array.isArray(returned)) {
        errors.push({
          detectorName: name,
          kind: "non-array",
          message: `Detector "${name}" did not return an array (received ${describeReceived(returned)})`,
        });
        continue;
      }

      returned.forEach((item: unknown, index: number) => {
        const parsed = FindingSchema.safeParse(item);
        if (parsed.success) {
          findings.push(parsed.data);
          return;
        }
        const finding = stringifyFinding(item);
        errors.push({
          detectorName: name,
          kind: "invalid-finding",
          findingIndex: index,
          finding,
          message:
            `Detector "${name}" returned an invalid finding at index ${index}: ` +
            `${summariseIssues(parsed.error.issues)}. Finding: ${finding}`,
        });
      });
    }

    return { findings, errors };
  }

  return { registerDetector, runDetectors };
}

/** The registry used by detector modules that self-register on import. */
export const defaultRegistry: Registry = createRegistry();

export const { registerDetector, runDetectors } = defaultRegistry;
