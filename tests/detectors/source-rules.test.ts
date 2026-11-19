import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import {
  HOOK_ATTRIBUTE,
  assertNoTestHooks,
  sourceMentionsHookWord,
  tagForEntry,
} from "@/tests/detectors/eval/helpers/no-hooks";
import { DEMO_TERMS } from "@/tests/detectors/helpers/demo-terms";

/**
 * Source rules of the static detectors (requirements 2.2, 2.4, 2.15, 6.3, 6.4,
 * 14.4, 15.6): the files under lib/detectors are read as text and scanned.
 */

const ROOT = join(process.cwd(), "lib", "detectors");

const DETECTOR_MODULES = [
  "fake-urgency",
  "fake-scarcity",
  "fake-activity",
  "confirmshaming",
  "preselection",
  "visual-interference",
] as const;

type SourceFile = { rel: string; source: string };

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else found.push(full);
  }
  return found.sort();
}

const FILES: SourceFile[] = listFiles(ROOT).map((path) => ({
  rel: relative(ROOT, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));

// ---------------------------------------------------------------------------
// A small scanner: comments, strings and template text are blanked, regular
// expression literals are collected. Division is told from a regular
// expression by the character before the slash.
// ---------------------------------------------------------------------------

type Scan = { code: string; regexLiterals: string[] };

const REGEX_MAY_FOLLOW: ReadonlySet<string> = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", "+", "-", "*", "%", "<", ">", "~", "^",
]);
const KEYWORDS_BEFORE_REGEX: ReadonlySet<string> = new Set([
  "return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do",
]);

function trailingWord(code: string): string {
  let end = code.length;
  while (end > 0 && /\s/.test(code[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/.test(code[start - 1])) start -= 1;
  return code.slice(start, end);
}

function scanSource(source: string): Scan {
  type Mode = { kind: "code"; depth: number } | { kind: "template" };
  const stack: Mode[] = [{ kind: "code", depth: 0 }];
  const regexLiterals: string[] = [];
  let code = "";
  let lastSignificant = "";
  const n = source.length;
  let i = 0;

  const emit = (text: string): void => {
    code += text;
    for (let k = text.length - 1; k >= 0; k -= 1) {
      if (!/\s/.test(text[k])) {
        lastSignificant = text[k];
        break;
      }
    }
  };

  while (i < n) {
    const top = stack[stack.length - 1];
    const ch = source[i];

    if (top.kind === "template") {
      if (ch === "\\") {
        i += 2;
      } else if (ch === "`") {
        stack.pop();
        emit("`");
        i += 1;
      } else if (ch === "$" && source[i + 1] === "{") {
        stack.push({ kind: "code", depth: 0 });
        emit(" ( ");
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      emit(" ");
      continue;
    }
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < n && source[i] !== ch && source[i] !== "\n") {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      emit(`${ch}${ch}`);
      continue;
    }
    if (ch === "`") {
      stack.push({ kind: "template" });
      emit("`");
      i += 1;
      continue;
    }
    if (ch === "{") {
      top.depth += 1;
      emit(ch);
      i += 1;
      continue;
    }
    if (ch === "}") {
      if (top.depth === 0 && stack.length > 1) {
        stack.pop();
        emit(" ) ");
      } else {
        top.depth -= 1;
        emit(ch);
      }
      i += 1;
      continue;
    }
    if (ch === "/") {
      const regexAllowed =
        lastSignificant === "" ||
        REGEX_MAY_FOLLOW.has(lastSignificant) ||
        KEYWORDS_BEFORE_REGEX.has(trailingWord(code));
      let end = -1;
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const c = source[j];
          if (c === "\\") {
            j += 2;
          } else if (c === "\n") {
            break;
          } else if (inClass) {
            if (c === "]") inClass = false;
            j += 1;
          } else if (c === "[") {
            inClass = true;
            j += 1;
          } else if (c === "/") {
            end = j;
            break;
          } else {
            j += 1;
          }
        }
      }
      if (end > i) {
        let flagsEnd = end + 1;
        while (flagsEnd < n && /[a-z]/.test(source[flagsEnd])) flagsEnd += 1;
        regexLiterals.push(source.slice(i, flagsEnd));
        emit(" R ");
        i = flagsEnd;
      } else {
        emit("/");
        i += 1;
      }
      continue;
    }
    emit(ch);
    i += 1;
  }
  return { code, regexLiterals };
}

function compact(code: string): string {
  let out = "";
  for (const ch of code) {
    if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scanner itself
// ---------------------------------------------------------------------------

describe("the source scanner", () => {
  it("finds regular expression literals, also after return and in arguments", () => {
    expect(scanSource("const a = /x+/g;").regexLiterals).toEqual(["/x+/g"]);
    expect(scanSource("function f(b: string) { return /a[/]b/.test(b); }").regexLiterals).toEqual([
      "/a[/]b/",
    ]);
    expect(scanSource("call(1, /q/i, 2);").regexLiterals).toEqual(["/q/i"]);
  });

  it("does not take division, strings, comments or template text for a regular expression", () => {
    const source = [
      "const r = (a + b) / 2 / c;",
      'const s = "/not/ a regex";',
      "// /nor-this/ and Date.now()",
      "/* /nor-this/ either */",
      "const t = `${(minor / 100).toFixed(2)} / ${x}`;",
      "const u = list[0] / list[1];",
    ].join("\n");
    expect(scanSource(source).regexLiterals).toEqual([]);
  });

  it("keeps calls in code and drops them from comments and strings", () => {
    const scan = scanSource('const a = Date.now(); // Date.parse(x)\nconst b = "Math.random(";');
    const code = compact(scan.code);
    expect(code).toContain("Date.now(");
    expect(code).not.toContain("Date.parse(");
    expect(code).not.toContain("Math.random(");
  });

  it("reads code inside a template expression", () => {
    const code = compact(scanSource("const a = `x ${Date.now()} y`;").code);
    expect(code).toContain("Date.now(");
  });
});

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

const EXPECTED_FILES = [
  "all.ts",
  "index.ts",
  ...DETECTOR_MODULES.map((name) => `${name}.ts`),
  ...[
    "calendar-date", "choice-groups", "colour", "constants", "countdown", "elements",
    "finding", "labels", "patterns", "price", "samples", "text",
  ].map((name) => `shared/${name}.ts`),
  ...[
    "activity-words", "choice-words", "confirmshaming-words", "forbidden-words", "months",
    "preselection-words", "scarcity-words", "urgency-words",
  ].map((name) => `data/${name}.ts`),
];

describe("the files under lib/detectors", () => {
  it("are the files this spec knows, and only TypeScript", () => {
    const rel = FILES.map((file) => file.rel);
    for (const expected of EXPECTED_FILES) expect(rel).toContain(expected);
    for (const file of rel) expect(file.endsWith(".ts")).toBe(true);
  });

  it("never mention the hook word, in code, comments or data", () => {
    const hits = FILES.filter((file) => sourceMentionsHookWord(file.source)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  const BANNED_CALLS = [
    "Date.now(",
    "Date.parse(",
    "newDate()",
    "Math.random(",
    "performance.now(",
    "toLocaleLowerCase",
    "toLocaleUpperCase",
    "newRegExp",
    "RegExp(",
    "console.",
  ];

  it("use no clock, no random, no locale case, no RegExp constructor and no console", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const code = compact(scanSource(file.source).code);
      for (const banned of BANNED_CALLS) {
        if (code.includes(banned)) hits.push(`${file.rel}: ${banned}`);
      }
    }
    expect(hits).toEqual([]);
  });

  // Requirements 6.1 and 6.8: an exception is turned into data in one place,
  // the registry (lib/detectors/index.ts); no detector or helper swallows it.
  it("hold no catch clause except in index.ts", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      if (file.rel === "index.ts") continue;
      if (/\bcatch\b/.test(scanSource(file.source).code)) hits.push(file.rel);
    }
    expect(hits).toEqual([]);
    const index = FILES.find((file) => file.rel === "index.ts");
    expect(/\bcatch\b/.test(scanSource(index?.source ?? "").code)).toBe(true);
  });

  it("hold regular expression literals only in shared/patterns.ts", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      if (file.rel === "shared/patterns.ts") continue;
      for (const literal of scanSource(file.source).regexLiterals) {
        hits.push(`${file.rel}: ${literal}`);
      }
    }
    expect(hits).toEqual([]);
    const patterns = FILES.find((file) => file.rel === "shared/patterns.ts");
    expect(scanSource(patterns?.source ?? "").regexLiterals.length).toBeGreaterThanOrEqual(3);
  });

  it("call regular expression methods only in shared/patterns.ts", () => {
    const METHODS = [".test(", ".exec(", ".match(", ".matchAll(", ".search("];
    const hits: string[] = [];
    for (const file of FILES) {
      if (file.rel === "shared/patterns.ts") continue;
      const code = compact(scanSource(file.source).code);
      for (const method of METHODS) {
        if (code.includes(method)) hits.push(`${file.rel}: ${method}`);
      }
    }
    expect(hits).toEqual([]);
  });

  function importsOf(source: string): string[] {
    const found: string[] = [];
    const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) found.push(match[1]);
    return found;
  }

  it("import no other detector module, except all.ts, which imports the six", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      for (const specifier of importsOf(file.source)) {
        for (const name of DETECTOR_MODULES) {
          if (specifier === name || specifier.endsWith(`/${name}`)) {
            if (file.rel !== "all.ts") hits.push(`${file.rel} imports ${specifier}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);

    const all = FILES.find((file) => file.rel === "all.ts");
    const allImports = importsOf(all?.source ?? "");
    for (const name of DETECTOR_MODULES) {
      expect(allImports.some((s) => s.endsWith(`/${name}`))).toBe(true);
    }
  });

  it("import nothing from lib/capture, lib/boo-tique, the tests or a browser package", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      for (const specifier of importsOf(file.source)) {
        if (
          specifier.includes("lib/capture") ||
          specifier.includes("lib/boo-tique") ||
          specifier.startsWith("@/tests") ||
          specifier.includes("/tests/") ||
          specifier.includes("playwright") ||
          specifier.includes("components/") ||
          specifier.startsWith("@/app")
        ) {
          hits.push(`${file.rel} imports ${specifier}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  function isLetterOrDigit(ch: string | undefined): boolean {
    return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  }

  function containsWholeWord(text: string, term: string): boolean {
    const lower = text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0) return false;
      if (!isLetterOrDigit(lower[at - 1]) && !isLetterOrDigit(lower[at + term.length])) {
        return true;
      }
      from = at + 1;
    }
  }

  it("hold no demo term as a whole word", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      for (const term of DEMO_TERMS) {
        if (containsWholeWord(file.source, term)) hits.push(`${file.rel}: ${term}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The helpers of this task
// ---------------------------------------------------------------------------

describe("hook helpers", () => {
  it("sourceMentionsHookWord ignores letter case", () => {
    expect(sourceMentionsHookWord(`a ${HOOK_ATTRIBUTE.toUpperCase()} b`)).toBe(true);
    expect(sourceMentionsHookWord(HOOK_ATTRIBUTE)).toBe(true);
    expect(sourceMentionsHookWord("data-test and id")).toBe(false);
  });

  it("tagForEntry returns the opening tag and the text of the element with the entry id", () => {
    const html = `<main><p>x</p><button ${HOOK_ATTRIBUTE}="club-plain-no-thanks" type="button">No <b>thanks</b></button></main>`;
    const found = tagForEntry(html, "club-plain-no-thanks");
    expect(found.openTag).toBe(
      `<button ${HOOK_ATTRIBUTE}="club-plain-no-thanks" type="button">`,
    );
    expect(found.text).toBe("No thanks");
    expect(() => tagForEntry(html, "missing-entry")).toThrow();
  });

  it("assertNoTestHooks passes without data-* attributes and throws with one, in either sample", () => {
    const element = (attributes: Record<string, string>) => ({
      id: "el-1-0",
      attributes,
    });
    const clean = {
      elements: [element({ type: "checkbox", "aria-label": "x" })],
      afterReload: { elements: [element({ name: "a" })] },
    };
    expect(() => assertNoTestHooks(clean)).not.toThrow();
    expect(() => assertNoTestHooks({})).not.toThrow();
    expect(() =>
      assertNoTestHooks({ ...clean, elements: [element({ [HOOK_ATTRIBUTE]: "x" })] }),
    ).toThrow();
    expect(() =>
      assertNoTestHooks({ ...clean, afterReload: { elements: [element({ "data-x": "1" })] } }),
    ).toThrow();
  });
});
