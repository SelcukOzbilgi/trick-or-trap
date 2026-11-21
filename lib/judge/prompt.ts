/**
 * Prompt, data block and request body of the model judge (design section 12).
 * Pure: no clock, no randomness, no state, no network.
 *
 * This file holds `encodePageData` for now: the candidate builder needs it to
 * measure the data block against its byte cap. The system prompt, the user
 * message and the request body are added by the prompt task.
 */

/** The characters that are written as `\u` sequences, with their escapes. */
const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
});

const ESCAPED_CHARACTERS = /[<>&\u2028\u2029]/g;

/**
 * Encode the data of the `<page_data>` block: `JSON.stringify`, then `<`,
 * `>`, `&`, U+2028 and U+2029 as `\u` sequences. Page text can then hold
 * neither a closing tag nor markup, and the result parses back to the same
 * value (requirements 8.6 and 8.7).
 */
export function encodePageData(data: object): string {
  return JSON.stringify(data).replace(
    ESCAPED_CHARACTERS,
    (character) => ESCAPES[character],
  );
}
