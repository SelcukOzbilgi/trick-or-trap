/**
 * String helpers for static markup from `renderToStaticMarkup`.
 * React escapes `<`, `>`, `&` and quotes inside attribute values, so a `>` always ends a tag.
 */

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type ElementRange = {
  /** Index of the `<` of the opening tag. */
  start: number;
  /** Index just after the `>` of the opening tag. */
  openEnd: number;
  /** Index just after the closing tag (equals `openEnd` for void elements). */
  end: number;
};

function findElement(markup: string, id: string): ElementRange | null {
  const idx = markup.indexOf(`data-testid="${id}"`);
  if (idx === -1) return null;
  const start = markup.lastIndexOf("<", idx);
  const close = markup.indexOf(">", idx);
  if (start === -1 || close === -1) return null;
  const openEnd = close + 1;
  const openTag = markup.slice(start, openEnd);
  const nameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(openTag);
  if (!nameMatch) return null;
  const tagName = nameMatch[1];
  if (VOID_TAGS.has(tagName.toLowerCase()) || openTag.endsWith("/>")) {
    return { start, openEnd, end: openEnd };
  }
  const re = new RegExp(`<(/?)${tagName}(?=[\\s>/])[^>]*>`, "g");
  re.lastIndex = openEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    if (m[1] === "/") depth -= 1;
    else if (!m[0].endsWith("/>")) depth += 1;
    if (depth === 0) return { start, openEnd, end: re.lastIndex };
  }
  throw new Error(`Unbalanced <${tagName}> element for test id "${id}"`);
}

function stripTags(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Every `data-testid` value, in document order. */
export function testIds(markup: string): string[] {
  return [...markup.matchAll(/data-testid="([^"]*)"/g)].map((m) => m[1]);
}

/** Number of exact `data-testid="id"` occurrences. */
export function countTestId(markup: string, id: string): number {
  return markup.split(`data-testid="${id}"`).length - 1;
}

/** Opening tag of the element that carries the test id. Throws if absent. */
export function openTag(markup: string, id: string): string {
  const range = findElement(markup, id);
  if (!range) throw new Error(`No element with data-testid="${id}"`);
  return markup.slice(range.start, range.openEnd);
}

/**
 * Text of the element that carries the test id: tags removed (each tag counts as a space),
 * entities decoded, whitespace collapsed. Throws if the id is absent.
 */
export function textOf(markup: string, id: string): string {
  const range = findElement(markup, id);
  if (!range) throw new Error(`No element with data-testid="${id}"`);
  return stripTags(markup.slice(range.openEnd, range.end));
}

/**
 * Text of the whole markup with tags and attributes removed and entities decoded.
 * `exclude` lists test ids whose elements are cut out first (every occurrence, balanced by
 * tag name). An id that is not in the markup is ignored.
 */
export function visibleText(
  markup: string,
  options: { exclude?: readonly string[] } = {},
): string {
  let out = markup;
  for (const id of options.exclude ?? []) {
    for (;;) {
      const range = findElement(out, id);
      if (!range) break;
      out = `${out.slice(0, range.start)} ${out.slice(range.end)}`;
    }
  }
  return stripTags(out);
}

function parseAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const nameEnd = /^<[a-zA-Z][a-zA-Z0-9-]*/.exec(tag);
  const re = /\s([^\s=/>"']+)(?:="([^"]*)")?/g;
  re.lastIndex = nameEnd ? nameEnd[0].length : 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs.set(m[1], decodeEntities(m[2] ?? ""));
  }
  return attrs;
}

/** True when the opening tag has the attribute, with or without a value. */
export function hasAttr(tag: string, name: string): boolean {
  return parseAttrs(tag).has(name);
}

/** Decoded attribute value, or `undefined` when the attribute is absent. */
export function attr(tag: string, name: string): string | undefined {
  return parseAttrs(tag).get(name);
}
