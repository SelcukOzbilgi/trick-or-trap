import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import * as activityWords from "@/lib/detectors/data/activity-words";
import * as choiceWords from "@/lib/detectors/data/choice-words";
import * as confirmshamingWords from "@/lib/detectors/data/confirmshaming-words";
import * as forbiddenWords from "@/lib/detectors/data/forbidden-words";
import * as months from "@/lib/detectors/data/months";
import * as preselectionWords from "@/lib/detectors/data/preselection-words";
import * as scarcityWords from "@/lib/detectors/data/scarcity-words";
import * as urgencyWords from "@/lib/detectors/data/urgency-words";
import { runAllDetectors } from "@/lib/detectors/all";
import { MAX_PHRASE_TOKENS } from "@/lib/detectors/shared/constants";
import { TITLES } from "@/lib/detectors/shared/finding";
import { compilePhrases, tokenise } from "@/lib/detectors/shared/text";
import type { WordList } from "@/lib/detectors/shared/text";
import { DEMO_TERMS, plantedTexts } from "@/tests/detectors/helpers/demo-terms";
import type { PageSnapshot } from "@/lib/types";

/**
 * Word lists (requirements 14.1, 14.6, 14.7, 14.8, 14.9): their shape, their
 * length, their generality and the other-language behaviour of the detectors.
 */

type Kind = "wordlist" | "plain" | "months";

type ModuleSpec = {
  readonly exports: Readonly<Record<string, unknown>>;
  /** The lists the design names for the module, with their kind. */
  readonly lists: Readonly<Record<string, Kind>>;
};

const MODULES: Readonly<Record<string, ModuleSpec>> = {
  "forbidden-words": {
    exports: forbiddenWords,
    lists: { FORBIDDEN_WORDS: "plain" },
  },
  months: {
    exports: months,
    lists: { MONTHS: "months", TIME_ZONE_TOKENS: "plain" },
  },
  "urgency-words": {
    exports: urgencyWords,
    lists: {
      URGENCY_WORDS: "wordlist",
      OFFER_WORDS: "wordlist",
      ROLLING_DEADLINE_PHRASES: "wordlist",
      FUTURE_DEADLINE_WORDS: "wordlist",
      SHIPPING_CUTOFF_PHRASES: "wordlist",
      TIME_OF_DAY_WORDS: "wordlist",
    },
  },
  "scarcity-words": {
    exports: scarcityWords,
    lists: {
      QUALIFIED_STOCK_TEMPLATES: "wordlist",
      BARE_STOCK_TEMPLATES: "wordlist",
      UNQUANTIFIED_SCARCITY: "wordlist",
      SCARCITY_LOOKALIKES: "wordlist",
      SCARCITY_SUPPORT_WORDS: "wordlist",
    },
  },
  "activity-words": {
    exports: activityWords,
    lists: {
      COUNT_TEMPLATES: "wordlist",
      PURCHASE_TEMPLATES: "wordlist",
      ACTIVITY_CONTEXT_WORDS: "wordlist",
      ACTIVITY_LOOKALIKES: "wordlist",
    },
  },
  "choice-words": {
    exports: choiceWords,
    lists: {
      ACCEPT_WORDS: "wordlist",
      REJECT_WORDS: "wordlist",
      LESSER_WORDS: "wordlist",
      CLOSE_WORDS: "wordlist",
      CLOSE_GLYPHS: "plain",
      PLAIN_DECLINES: "wordlist",
      CONSENT_CONTEXT_WORDS: "wordlist",
    },
  },
  "confirmshaming-words": {
    exports: confirmshamingWords,
    lists: {
      SHAMING_PHRASES: "wordlist",
      FIRST_PERSON_TOKENS: "wordlist",
      FIRST_PERSON_SUFFIXES: "wordlist",
      NEGATION_EMOTION_TOKENS: "wordlist",
      BENEFIT_LOSS_TERMS: "wordlist",
    },
  },
  "preselection-words": {
    exports: preselectionWords,
    lists: {
      PAID_ADDON_WORDS: "wordlist",
      CONSENT_WORDS: "wordlist",
      NEUTRAL_WORDS: "wordlist",
      NONE_WORDS: "wordlist",
      REQUIRED_GROUP_WORDS: "wordlist",
      FREE_WORDS: "wordlist",
      CURRENCY_WORDS: "plain",
    },
  },
};

/** Lists the design allows to be empty: Turkish verb endings have no English counterpart. */
const MAY_BE_EMPTY: ReadonlySet<string> = new Set(["FIRST_PERSON_SUFFIXES.en"]);

type ListEntry = {
  readonly where: string;
  readonly entry: string;
  readonly kind: Kind;
  readonly list: string;
  readonly module: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Every entry of every list of every data module, with its place. */
function allEntries(): ListEntry[] {
  const found: ListEntry[] = [];
  for (const [module, spec] of Object.entries(MODULES)) {
    for (const [list, kind] of Object.entries(spec.lists)) {
      const value = spec.exports[list];
      if (kind === "plain") {
        for (const entry of value as readonly string[]) {
          found.push({ where: `${module}.${list}`, entry, kind, list, module });
        }
      } else if (kind === "months") {
        for (const lang of ["en", "tr"]) {
          const pairs = asRecord(value)[lang] as ReadonlyArray<readonly [string, number]>;
          for (const [entry] of pairs) {
            found.push({ where: `${module}.${list}.${lang}`, entry, kind, list, module });
          }
        }
      } else {
        for (const lang of ["en", "tr"]) {
          for (const entry of asRecord(value)[lang] as readonly string[]) {
            found.push({ where: `${module}.${list}.${lang}`, entry, kind, list, module });
          }
        }
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("the data modules", () => {
  it("are exactly the files of design section 5", () => {
    const dir = join(process.cwd(), "lib", "detectors", "data");
    const files = readdirSync(dir).map((name) => name.replace(/\.ts$/, "")).sort();
    expect(files).toEqual(Object.keys(MODULES).sort());
  });

  for (const [name, spec] of Object.entries(MODULES)) {
    it(`${name} exports exactly its named lists`, () => {
      expect(Object.keys(spec.exports).sort()).toEqual(Object.keys(spec.lists).sort());
    });
  }

  it("export frozen en and tr arrays that are non-empty where the design says so", () => {
    for (const [module, spec] of Object.entries(MODULES)) {
      for (const [list, kind] of Object.entries(spec.lists)) {
        const value = spec.exports[list];
        const where = `${module}.${list}`;
        if (kind === "plain") {
          expect(Array.isArray(value), where).toBe(true);
          expect(Object.isFrozen(value), `${where} frozen`).toBe(true);
          expect((value as unknown[]).length, `${where} non-empty`).toBeGreaterThan(0);
          continue;
        }
        const record = asRecord(value);
        expect(Object.isFrozen(record), `${where} record frozen`).toBe(true);
        expect(Object.keys(record).sort(), `${where} keys`).toEqual(["en", "tr"]);
        for (const lang of ["en", "tr"]) {
          const entries = record[lang];
          expect(Array.isArray(entries), `${where}.${lang} is an array`).toBe(true);
          expect(Object.isFrozen(entries), `${where}.${lang} frozen`).toBe(true);
          if (!MAY_BE_EMPTY.has(`${list}.${lang}`)) {
            expect((entries as unknown[]).length, `${where}.${lang} non-empty`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("hold only non-blank strings", () => {
    const bad = allEntries().filter(
      (item) => typeof item.entry !== "string" || item.entry.trim() === "",
    );
    expect(bad).toEqual([]);
  });

  it("start with the review rule comment (requirement 14.9)", () => {
    for (const name of Object.keys(MODULES)) {
      const text = readFileSync(join(process.cwd(), "lib", "detectors", "data", `${name}.ts`), "utf8");
      const lines = text.split("\n");
      let start = 0;
      while (start < lines.length && lines[start].startsWith("import ")) start += 1;
      while (start < lines.length && lines[start].trim() === "") start += 1;
      const rest = lines.slice(start).join("\n");
      expect(rest.startsWith("/**"), `${name} starts with a doc comment`).toBe(true);
      const comment = rest.slice(0, rest.indexOf("*/") + 2);
      expect(comment, `${name} states the review rule`).toContain("Review rule:");
      if (name !== "forbidden-words") {
        expect(comment, `${name} names its sources`).toContain("section B of");
        expect(comment, `${name} names its sources`).toContain("common shop wording");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Length (compilePhrases skips entries over MAX_PHRASE_TOKENS tokens)
// ---------------------------------------------------------------------------

describe("the length of list entries", () => {
  it("is at most MAX_PHRASE_TOKENS tokens, counted with tokenise, in every list of every module", () => {
    const tooLong = allEntries()
      .filter((item) => {
        const count = tokenise(item.entry, 200).length;
        return count === 0 || count > MAX_PHRASE_TOKENS;
      })
      .map((item) => `${item.where}: "${item.entry}" has ${tokenise(item.entry, 200).length} tokens`);
    expect(tooLong).toEqual([]);
  });

  it("leaves nothing out when a list is compiled: every entry of every word list is kept", () => {
    for (const [module, spec] of Object.entries(MODULES)) {
      for (const [list, kind] of Object.entries(spec.lists)) {
        if (kind !== "wordlist") continue;
        const value = spec.exports[list] as WordList;
        const total = value.en.length + value.tr.length;
        expect(compilePhrases(value).size, `${module}.${list}`).toBe(total);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Generality (requirement 14.8)
// ---------------------------------------------------------------------------

/** Words and numbers of a text, with the `#` and `@` placeholders kept; other symbols dropped. */
function keyTokens(text: string): string[] {
  return tokenise(text, 400)
    .filter((t) => t.kind !== "symbol" || t.norm === "#" || t.norm === "@")
    .map((t) => t.norm);
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let same = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (haystack[start + k] !== needle[k]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

/**
 * Planted texts that are ordinary control and consent labels. Requirement 11.3
 * and design sections 9.4 to 9.6 name them in the lists themselves ("no thanks",
 * "not now", "reject", "accept all", "options", "subscribe", "partners",
 * "insurance"), and a shop cannot be checked for them without them. They are
 * exempt only in the two control-label modules below. Every claim list
 * (urgency, scarcity, activity, shaming) stays fully covered, and so does
 * every longer planted text.
 */
const GENERIC_CONTROL_LABELS: ReadonlySet<string> = new Set([
  "accept all",
  "reject",
  "options",
  "subscribe",
  "no thanks",
  "not now",
  "partners",
  "insurance",
]);
const CONTROL_LABEL_MODULES: ReadonlySet<string> = new Set(["choice-words", "preselection-words"]);

describe("the generality of the word lists", () => {
  it("hold no demo term in any entry of any list", () => {
    const terms = DEMO_TERMS.map((term) => keyTokens(term));
    const hits: string[] = [];
    for (const item of allEntries()) {
      const tokens = keyTokens(item.entry);
      DEMO_TERMS.forEach((term, index) => {
        if (containsSequence(tokens, terms[index])) {
          hits.push(`${item.where}: "${item.entry}" holds "${term}"`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("read the planted texts of the Boo-tique from the shop files and the fixture", () => {
    const planted = plantedTexts();
    expect(planted.length).toBeGreaterThan(25);
    expect(planted).toContain("Black Friday of the Dead ends at midnight");
    expect(planted).toContain("I'll pay full price like a mortal");
    expect(planted).toContain("Maybe later, I don't need protection");
    expect(planted).toContain("Selling fast");
    expect(planted).toContain("Almost gone");
    expect(planted).toContain("Morgan from Ohio just bought the Cursed Candle Set");
  });

  it("have no entry that equals or contains a planted text", () => {
    const planted = plantedTexts()
      .map((text) => ({ text, tokens: keyTokens(text) }))
      .filter((p) => p.tokens.length > 0);
    const hits: string[] = [];
    for (const item of allEntries()) {
      // Word and phrase lists only: glyphs, currency codes, time zone names,
      // month names and the forbidden words are facts, not shop wording.
      if (item.kind !== "wordlist") continue;
      const tokens = keyTokens(item.entry);
      for (const p of planted) {
        const exempt =
          CONTROL_LABEL_MODULES.has(item.module) &&
          GENERIC_CONTROL_LABELS.has(p.tokens.join(" "));
        if (!exempt && containsSequence(tokens, p.tokens)) {
          hits.push(`${item.where}: "${item.entry}" equals or contains the planted text "${p.text}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps the control-label exemption small and out of every claim list", () => {
    expect(GENERIC_CONTROL_LABELS.size).toBeLessThanOrEqual(8);
    const claimModules = ["urgency-words", "scarcity-words", "activity-words", "confirmshaming-words"];
    const planted = plantedTexts().map((text) => keyTokens(text).join(" "));
    for (const label of GENERIC_CONTROL_LABELS) expect(planted).toContain(label);
    const hits = allEntries()
      .filter((item) => claimModules.includes(item.module))
      .filter((item) => GENERIC_CONTROL_LABELS.has(keyTokens(item.entry).join(" ")))
      .map((item) => `${item.where}: "${item.entry}"`);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Other languages (requirements 14.6 and 14.7)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const FIRST_TIME = "2026-12-01T12:00:00.000Z";
const RELOAD_TIME = "2026-12-01T12:00:09.000Z";

function raw(id: string, tag: string, text: string, over: Raw = {}): Raw {
  return {
    id,
    tag,
    text,
    boundingBox: { x: 0, y: 0, width: 160, height: 24 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontSize: "16px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    position: "static",
    checked: false,
    selected: false,
    ...over,
  };
}

type Strings = {
  readonly scarcity: string;
  readonly activity: string;
  readonly rolling: string;
  readonly banner: string;
  readonly acceptAll: string;
  readonly settings: string;
  readonly yes: string;
  readonly noShame: string;
  readonly optionLabel: string;
  readonly choiceA: string;
  readonly choiceB: string;
  readonly choiceC: string;
  readonly closeLabel: string;
};

/** Elements that carry only words; no detector may find anything in them. */
function wordElements(s: Strings): Raw[] {
  return [
    raw("el-1-0", "span", s.scarcity),
    raw("el-1-1", "span", s.activity),
    raw("el-1-2", "span", s.rolling),
    raw("el-1-3", "div", s.banner, {
      position: "fixed",
      boundingBox: { x: 0, y: 700, width: 600, height: 80 },
    }),
    raw("el-1-3-0", "button", s.acceptAll, {
      fontSize: "20px",
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(155, 28, 28)",
      boundingBox: { x: 0, y: 700, width: 200, height: 50 },
    }),
    raw("el-1-3-1", "a", s.settings, {
      fontSize: "11px",
      color: "rgb(154, 154, 154)",
      boundingBox: { x: 220, y: 700, width: 50, height: 14 },
    }),
    raw("el-1-4-0", "button", s.yes),
    raw("el-1-4-1", "button", s.noShame),
  ];
}

/** Elements the language-independent rules read: U4, P1, P4 and V4. */
function independentElements(s: Strings, countdown: string): Raw[] {
  const radio = (n: number, label: string, checked: boolean): Raw[] => [
    raw(`el-1-7-${n}`, "label", label),
    raw(`el-1-7-${n}-0`, "input", "", {
      checked,
      attributes: { type: "radio", name: "option" },
    }),
  ];
  return [
    raw("el-1-5", "span", countdown),
    raw("el-1-6", "label", s.optionLabel),
    raw("el-1-6-0", "input", "", { checked: true, attributes: { type: "checkbox" } }),
    ...radio(0, s.choiceA, false),
    ...radio(1, s.choiceB, true),
    ...radio(2, s.choiceC, false),
    raw("el-1-8", "div", "", {
      role: "dialog",
      boundingBox: { x: 100, y: 100, width: 400, height: 300 },
    }),
    raw("el-1-8-0", "button", s.closeLabel, {
      color: "rgb(207, 198, 188)",
      fontSize: "8px",
      boundingBox: { x: 480, y: 104, width: 8, height: 8 },
    }),
  ];
}

function sample(capturedAt: string, elements: Raw[]): Raw {
  return {
    url: "https://shop.example/",
    capturedAt,
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    elements,
  };
}

function foreignSnapshot(s: Strings, withIndependent: boolean): PageSnapshot {
  const first = [...wordElements(s), ...(withIndependent ? independentElements(s, "04:59:58") : [])];
  const reload = [...wordElements(s), ...(withIndependent ? independentElements(s, "04:59:59") : [])];
  return { ...sample(FIRST_TIME, first), afterReload: sample(RELOAD_TIME, reload) } as unknown as PageSnapshot;
}

const SPANISH: Strings = {
  scarcity: "¡Solo quedan 2!",
  activity: "14 personas están viendo esto",
  rolling: "La oferta termina a medianoche",
  banner: "Usamos cookies",
  acceptAll: "Aceptar todo",
  settings: "Ajustes",
  yes: "Sí, quiero un 20% de descuento",
  noShame: "No, prefiero pagar el precio completo",
  optionLabel: "Envío rápido +4,99 €",
  choiceA: "Opción A 0,00 €",
  choiceB: "Opción B +9,00 €",
  choiceC: "Opción C +3,00 €",
  closeLabel: "×",
};

const GERMAN: Strings = {
  scarcity: "Nur noch 2 auf Lager",
  activity: "14 Personen sehen sich das gerade an",
  rolling: "Das Angebot endet um Mitternacht",
  banner: "Wir verwenden Cookies",
  acceptAll: "Alle akzeptieren",
  settings: "Einstellungen",
  yes: "Ja, ich möchte 20 % Rabatt",
  noShame: "Nein, ich zahle lieber den vollen Preis",
  optionLabel: "Geschenkverpackung +4,99 €",
  choiceA: "Option A 0,00 €",
  choiceB: "Option B +9,00 €",
  choiceC: "Option C +3,00 €",
  closeLabel: "×",
};

describe.each([
  ["Spanish", SPANISH],
  ["German", GERMAN],
])("a %s page", (_name, strings) => {
  it("gives no finding from words alone", () => {
    const result = runAllDetectors(foreignSnapshot(strings, false));
    expect(result.errors).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("still gives the four language-independent findings: U4, P1, P4 and V4, and nothing else", () => {
    const result = runAllDetectors(foreignSnapshot(strings, true));
    expect(result.errors).toEqual([]);
    const summary = result.findings.map((f) => [f.patternId, f.confidence, f.title]);
    expect(summary).toEqual([
      ["fake-urgency", "medium", TITLES["fake-urgency"][0]],
      ["preselection", "medium", TITLES.preselection[0]],
      ["preselection", "medium", TITLES.preselection[2]],
      ["visual-interference", "medium", TITLES["visual-interference"][1]],
    ]);
    const patterns = new Set(result.findings.map((f) => f.patternId));
    for (const textPattern of ["fake-scarcity", "fake-activity", "confirmshaming"]) {
      expect(patterns.has(textPattern as never)).toBe(false);
    }
  });
});
