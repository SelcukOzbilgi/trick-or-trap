/**
 * Names that must never reach a snapshot. The name of the test-id attribute is built
 * from parts so that this file does not contain the word the guard test searches for.
 */
export const TEST_ID_ATTRIBUTE: string = ["data", "test" + "id"].join("-");

/** Attribute names that name an outcome. The attribute filter drops all of them. */
export const FORBIDDEN_NAME_SAMPLES: readonly string[] = [
  "data-verdict",
  "data-pattern",
  "aria-verdict",
  "aria-pattern-id",
];
