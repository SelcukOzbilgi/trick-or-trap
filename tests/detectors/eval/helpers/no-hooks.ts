import { openTag, textOf } from "@/tests/boo-tique/helpers/markup";

/**
 * The one file under tests/detectors that may write the hook word. Everything
 * else imports what it needs from here: the hook attribute name, the check
 * that a snapshot carries no `data-*` attribute, the source scan for the word
 * and the markup lookup by hook that the structural sync test uses.
 */

/** Name of the attribute the shop uses for tests. Detectors must never read it. */
export const HOOK_ATTRIBUTE = "data-testid";

const HOOK_WORD = "testid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The first sample, the reload sample and the second sample of a snapshot, with a label each. */
function samplesOf(snapshot: unknown): Array<{ label: string; elements: unknown[] }> {
  const found: Array<{ label: string; elements: unknown[] }> = [];
  if (!isRecord(snapshot)) return found;
  const candidates: Array<[string, unknown]> = [
    ["the first sample", snapshot],
    ["afterReload", snapshot.afterReload],
    ["secondSample", snapshot.secondSample],
  ];
  for (const [label, sample] of candidates) {
    if (isRecord(sample) && Array.isArray(sample.elements)) {
      found.push({ label, elements: sample.elements });
    }
  }
  return found;
}

/**
 * Throws when any element of the first sample or of the reload sample has an
 * attribute whose name starts with `data-`. Used on every harness snapshot, so
 * that a verdict hint can never reach a detector through the snapshot.
 */
export function assertNoTestHooks(snapshot: unknown): void {
  for (const sample of samplesOf(snapshot)) {
    sample.elements.forEach((element, index) => {
      if (!isRecord(element)) return;
      const attributes = element.attributes;
      if (!isRecord(attributes)) return;
      for (const name of Object.keys(attributes)) {
        if (name.toLowerCase().startsWith("data-")) {
          const id = typeof element.id === "string" ? element.id : `#${index}`;
          throw new Error(
            `Element ${id} of ${sample.label} has the attribute "${name}"; snapshots must carry no data-* attribute.`,
          );
        }
      }
    });
  }
}

/** True when the text holds the hook word in any letter case. */
export function sourceMentionsHookWord(text: string): boolean {
  return text.toLowerCase().includes(HOOK_WORD);
}

/**
 * Finds the element of the rendered markup that carries the entry id as its
 * hook value. Returns its opening tag and its text. Throws when the id is not
 * in the markup.
 */
export function tagForEntry(
  html: string,
  entryId: string,
): { openTag: string; text: string } {
  return { openTag: openTag(html, entryId), text: textOf(html, entryId) };
}
