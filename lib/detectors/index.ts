import { FindingSchema } from "@/lib/types";
import type { Finding, PageSnapshot } from "@/lib/types";

/**
 * A pure detector function: receives a PageSnapshot and returns zero or more
 * Finding objects. Must have no side effects and make no network calls.
 */
export type Detector = (snapshot: PageSnapshot) => Finding[];

/** Module-level registry. Detectors are added via registerDetector(). */
const registry: Detector[] = [];

/**
 * Register a detector so it is included in every runDetectors() call.
 * Call this once per detector module, at module-load time.
 */
export function registerDetector(detector: Detector): void {
  registry.push(detector);
}

/**
 * Remove all registered detectors. Intended for use in unit tests only.
 * Do not call this in production code.
 */
export function _resetRegistryForTests(): void {
  registry.splice(0, registry.length);
}

/**
 * Run every registered detector against the given snapshot and return all
 * findings. Each finding is validated against FindingSchema; a detector that
 * returns invalid data causes an immediate TypeError identifying the offender.
 */
export function runDetectors(snapshot: PageSnapshot): Finding[] {
  const results: Finding[] = [];

  for (const detector of registry) {
    const raw = detector(snapshot);

    for (const finding of raw) {
      const parsed = FindingSchema.safeParse(finding);
      if (!parsed.success) {
        throw new TypeError(
          `Detector "${detector.name}" returned an invalid finding: ` +
            parsed.error.message
        );
      }
      results.push(parsed.data);
    }
  }

  return results;
}
