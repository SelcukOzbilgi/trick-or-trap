import { describe, it, expect } from "vitest";
import {
  compilePhrases,
  findPhrases,
  hasAny,
  maskDigits,
  normaliseText,
  quote,
  tokenise,
} from "@/lib/detectors/shared/text";
import type { Token } from "@/lib/detectors/shared/text";
import {
  MAX_PHRASE_TOKENS,
  MAX_QUOTE_CHARS,
  MAX_TEXT_READ,
  MAX_TOKENS_PER_TEXT,
} from "@/lib/detectors/shared/constants";
import { FORBIDDEN_WORDS } from "@/lib/detectors/data/forbidden-words";

const norms = (tokens: readonly Token[]): string[] => tokens.map((t) => t.norm);
const surfaces = (tokens: readonly Token[]): string[] =>
  tokens.map((t) => t.surface);
const kinds = (tokens: readonly Token[]): string[] => tokens.map((t) => t.kind);

describe("normaliseText", () => {
  it.each(["İ", "I", "ı", "i"])("gives 'i' for %s", (input) => {
    expect(normaliseText(input)).toBe("i");
  });

  it("makes İSTANBUL, ISTANBUL and istanbul equal", () => {
    expect(normaliseText("İSTANBUL")).toBe("istanbul");
    expect(normaliseText("ISTANBUL")).toBe("istanbul");
    expect(normaliseText("istanbul")).toBe("istanbul");
  });

  it("folds Turkish capitals and the dotless i to the same letters as English", () => {
    expect(normaliseText("ŞİMDİ DEĞİL")).toBe("şimdi değil");
    expect(normaliseText("KALDI")).toBe(normaliseText("kaldı"));
    expect(normaliseText("İ").length).toBe(1);
  });

  it("applies NFKC", () => {
    expect(normaliseText("１２３")).toBe("123");
    expect(normaliseText("ﬁsh")).toBe("fish");
    expect(normaliseText("Ｓａｌｅ")).toBe("sale");
  });

  it("removes zero-width characters, the soft hyphen and a lone dot above", () => {
    expect(normaliseText("a\u200bb\u200cc\u200dd\u2060e\ufefff\u00adg")).toBe(
      "abcdefg"
    );
    expect(normaliseText("i\u0307")).toBe("i");
  });

  it("unifies apostrophes and dashes", () => {
    expect(normaliseText("I\u2019ll")).toBe("i'll");
    expect(normaliseText("\u2018x\u2019 \u02bcy\u02bc \u00b4z\u00b4")).toBe(
      "'x' 'y' 'z'"
    );
    expect(normaliseText("a\u2013b\u2014c\u2010d\u2011e")).toBe("a-b-c-d-e");
  });

  it("collapses and trims whitespace", () => {
    expect(normaliseText("  a \t\n b\u00a0\u3000c  ")).toBe("a b c");
    expect(normaliseText("a\u0000b")).toBe("a b");
    expect(normaliseText("   ")).toBe("");
    expect(normaliseText("a \u200b b")).toBe("a b");
  });

  it("gives an empty string for anything that is not a string", () => {
    for (const value of [null, undefined, 5, true, {}, ["a"], Symbol("x")]) {
      expect(normaliseText(value)).toBe("");
    }
  });

  it("cuts at MAX_TEXT_READ by default", () => {
    expect(normaliseText("a".repeat(1_000_000)).length).toBe(MAX_TEXT_READ);
  });

  it("uses an explicit cap", () => {
    expect(normaliseText("abc def", 5)).toBe("abc d");
    expect(normaliseText("abc", 0)).toBe("");
    expect(normaliseText("abc", Number.NaN)).toBe("abc");
  });

  it("applies the cap before any other work", () => {
    // If the cap came after the whitespace collapse this would be "a b".
    const input = `a${" ".repeat(400)}b`;
    expect(normaliseText(input)).toBe("a");
  });

  it("does not leave half of a surrogate pair at the cut", () => {
    const input = `${"a".repeat(MAX_TEXT_READ - 1)}\u{1F600}`;
    expect(normaliseText(input)).toBe("a".repeat(MAX_TEXT_READ - 1));
  });
});

describe("tokenise", () => {
  it("splits letters from digits", () => {
    const tokens = tokenise("2h 30m");
    expect(norms(tokens)).toEqual(["2", "h", "30", "m"]);
    expect(kinds(tokens)).toEqual(["number", "word", "number", "word"]);
    expect(norms(tokenise("abc123def"))).toEqual(["abc", "123", "def"]);
  });

  it.each(["04:59:59", "4,99", "1.299,90", "9:59", "4.99"])(
    "keeps %s as one number token",
    (text) => {
      const tokens = tokenise(`price ${text} now`);
      expect(norms(tokens)).toEqual(["price", text, "now"]);
      expect(tokens[1].kind).toBe("number");
    }
  );

  it("ends a number at a separator that has no digit after it", () => {
    expect(norms(tokenise("3."))).toEqual(["3", "."]);
    expect(norms(tokenise("1,a"))).toEqual(["1", ",", "a"]);
    expect(norms(tokenise("a,b"))).toEqual(["a", ",", "b"]);
    expect(norms(tokenise("1..5"))).toEqual(["1", ".", ".", "5"]);
  });

  it("keeps the surface casing and gives the folded form as norm", () => {
    const tokens = tokenise("Only 2 LEFT!");
    expect(surfaces(tokens)).toEqual(["Only", "2", "LEFT", "!"]);
    expect(norms(tokens)).toEqual(["only", "2", "left", "!"]);
    expect(tokens.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    const turkish = tokenise("İSTANBUL")[0];
    expect(turkish.surface).toBe("İSTANBUL");
    expect(turkish.norm).toBe("istanbul");
  });

  it("keeps an inner apostrophe inside a word", () => {
    expect(norms(tokenise("I'll don\u2019t"))).toEqual(["i'll", "don't"]);
    expect(norms(tokenise("'quoted' 5'"))).toEqual(["'", "quoted", "'", "5", "'"]);
  });

  it("makes symbols, currency signs and signs separate tokens", () => {
    expect(norms(tokenise("+$4.99"))).toEqual(["+", "$", "4.99"]);
    expect(norms(tokenise("50% off"))).toEqual(["50", "%", "off"]);
    expect(kinds(tokenise("\u00d7 \u2715"))).toEqual(["symbol", "symbol"]);
    expect(norms(tokenise("e-mail"))).toEqual(["e", "-", "mail"]);
  });

  it("drops a variation selector that follows a symbol", () => {
    const tokens = tokenise("\u2716\ufe0f");
    expect(surfaces(tokens)).toEqual(["\u2716"]);
  });

  it("keeps Turkish letters inside words", () => {
    expect(norms(tokenise("Şimdi değil"))).toEqual(["şimdi", "değil"]);
  });

  it("stops at MAX_TOKENS_PER_TEXT", () => {
    expect(tokenise("a ".repeat(500)).length).toBe(MAX_TOKENS_PER_TEXT);
    expect(tokenise("a ".repeat(500), 5000).length).toBe(MAX_TOKENS_PER_TEXT);
  });

  it("cuts a huge text before it works", () => {
    const start = performance.now();
    const tokens = tokenise("only ".repeat(400_000));
    expect(performance.now() - start).toBeLessThan(500);
    expect(tokens.length).toBeLessThanOrEqual(MAX_TOKENS_PER_TEXT);
  });

  it("gives no tokens for non-strings and blank text", () => {
    expect(tokenise(undefined)).toEqual([]);
    expect(tokenise(42)).toEqual([]);
    expect(tokenise("   ")).toEqual([]);
  });

  it("returns frozen tokens", () => {
    const tokens = tokenise("a 1 !");
    expect(Object.isFrozen(tokens)).toBe(true);
    expect(tokens.every((t) => Object.isFrozen(t))).toBe(true);
  });
});

describe("compilePhrases and findPhrases", () => {
  const stock = compilePhrases({
    en: ["only # left", "hurry, only # left", "# left", "selling fast"],
    tr: ["sadece # adet kaldı", "stokta # adet"],
  });

  it("returns a frozen matcher that counts its entries", () => {
    expect(Object.isFrozen(stock)).toBe(true);
    expect(stock.size).toBe(6);
  });

  it("matches a number placeholder and reports positions and numbers", () => {
    const hits = findPhrases(tokenise("Hurry, only 2 left!"), stock);
    expect(hits.map((h) => [h.entry, h.start, h.end, h.numbers])).toEqual([
      ["hurry, only # left", 0, 5, [2]],
      ["only # left", 2, 5, [2]],
      ["# left", 3, 5, [2]],
    ]);
    expect(hits.every((h) => h.language === "en")).toBe(true);
  });

  it("matches Turkish entries regardless of case and dotted or dotless i", () => {
    const hits = findPhrases(tokenise("SADECE 3 ADET KALDI"), stock);
    expect(hits).toHaveLength(1);
    expect(hits[0].entry).toBe("sadece # adet kaldı");
    expect(hits[0].language).toBe("tr");
    expect(hits[0].numbers).toEqual([3]);
    expect(
      findPhrases(tokenise("Stokta 4 adet"), stock).map((h) => h.entry)
    ).toEqual(["stokta # adet"]);
  });

  it("matches a plain phrase without placeholders", () => {
    const hits = findPhrases(tokenise("It is SELLING fast today"), stock);
    expect(hits.map((h) => [h.entry, h.start, h.end, h.numbers])).toEqual([
      ["selling fast", 2, 4, []],
    ]);
  });

  it("reads thousands and decimal separators in a number placeholder", () => {
    expect(findPhrases(tokenise("only 1,204 left"), stock)[0].numbers).toEqual([
      1204,
    ]);
    expect(findPhrases(tokenise("only 1.204 left"), stock)[0].numbers).toEqual([
      1204,
    ]);
    expect(findPhrases(tokenise("only 4,5 left"), stock)[0].numbers).toEqual([
      4.5,
    ]);
    expect(
      findPhrases(tokenise("only 1.299,90 left"), stock)[0].numbers
    ).toEqual([1299.9]);
  });

  it("does not let a number placeholder take a clock or a word", () => {
    expect(findPhrases(tokenise("only 04:59:59 left"), stock)).toEqual([]);
    expect(findPhrases(tokenise("only two left"), stock)).toEqual([]);
  });

  it("gives no match across a missing token", () => {
    expect(findPhrases(tokenise("only left"), stock)).toEqual([]);
    expect(findPhrases(tokenise("only 2 now left"), stock)).toEqual([]);
    expect(findPhrases(tokenise("only 2"), stock)).toEqual([]);
    expect(findPhrases(tokenise("selling very fast"), stock)).toEqual([]);
    expect(findPhrases(tokenise("hurry only 2 left"), stock).map((h) => h.entry))
      .toEqual(["only # left", "# left"]);
  });

  it("gives no match for text of another language", () => {
    expect(findPhrases(tokenise("¡Solo quedan 2!"), stock)).toEqual([]);
    expect(findPhrases(tokenise("Nur noch 2 auf Lager"), stock)).toEqual([]);
  });

  it("honours the limit and hasAny", () => {
    const tokens = tokenise("Hurry, only 2 left!");
    expect(findPhrases(tokens, stock, 1)).toHaveLength(1);
    expect(findPhrases(tokens, stock, 0)).toEqual([]);
    expect(hasAny(tokens, stock)).toBe(true);
    expect(hasAny(tokenise("nothing here"), stock)).toBe(false);
    expect(hasAny([], stock)).toBe(false);
  });

  it("returns frozen hits", () => {
    const hits = findPhrases(tokenise("only 2 left"), stock);
    expect(Object.isFrozen(hits)).toBe(true);
    expect(Object.isFrozen(hits[0])).toBe(true);
  });

  it("skips entries that are empty or longer than MAX_PHRASE_TOKENS", () => {
    const tooLong = Array.from({ length: MAX_PHRASE_TOKENS + 1 }, (_, i) => `w${i}`)
      .join(" ")
      .replace(/\d/g, "x");
    const exact = "a b c d e f";
    expect(tooLong.split(" ")).toHaveLength(MAX_PHRASE_TOKENS + 1);
    const matcher = compilePhrases({ en: [tooLong, "", "   ", exact], tr: [] });
    expect(matcher.size).toBe(1);
    expect(hasAny(tokenise(exact), matcher)).toBe(true);
  });

  it("returns no hits for a matcher it did not build", () => {
    const fake = { size: 1 };
    expect(findPhrases(tokenise("only 2 left"), fake)).toEqual([]);
  });

  describe("name placeholder", () => {
    const purchases = compilePhrases({
      en: ["@ from @ just bought"],
      tr: ["@'dan @ az önce satın aldı", "@ az önce satın aldı"],
    });

    it("matches one to three capitalised words", () => {
      expect(
        hasAny(tokenise("Alex from Leeds just bought a lamp"), purchases)
      ).toBe(true);
      expect(
        hasAny(
          tokenise("Mary Ann from New York City just bought a lamp"),
          purchases
        )
      ).toBe(true);
    });

    it("does not match lower-case or missing names", () => {
      expect(
        hasAny(tokenise("alex from leeds just bought a lamp"), purchases)
      ).toBe(false);
      expect(hasAny(tokenise("from Leeds just bought"), purchases)).toBe(false);
      expect(hasAny(tokenise("Alex from 12 just bought"), purchases)).toBe(false);
    });

    it("matches a name that is up to three words long", () => {
      const hits = findPhrases(
        tokenise("One Two Three Four from Leeds just bought"),
        purchases
      );
      // A fourth word cannot belong to the name, so the first hit starts at the second word.
      expect(hits.some((h) => h.start === 0)).toBe(false);
      expect(hits[0].start).toBe(1);
      expect(hits[0].end).toBe(8);
    });

    it("matches a Turkish name with a suffix after an apostrophe", () => {
      const suffixed = compilePhrases({
        en: [],
        tr: ["@'dan @ az önce satın aldı"],
      });
      expect(suffixed.size).toBe(1);
      const hits = findPhrases(
        tokenise("Ayşe'dan Mehmet az önce satın aldı"),
        suffixed
      );
      expect(hits.map((h) => [h.entry, h.language, h.start, h.end])).toEqual([
        ["@'dan @ az önce satın aldı", "tr", 0, 6],
      ]);
      expect(
        findPhrases(tokenise("Mary Ann'dan Mehmet az önce satın aldı"), suffixed)[0]
          .start
      ).toBe(0);
    });

    it("needs the right suffix and capital letters in the Turkish form", () => {
      const suffixed = compilePhrases({
        en: [],
        tr: ["@'dan @ az önce satın aldı"],
      });
      expect(
        hasAny(tokenise("Ayşe'den Mehmet az önce satın aldı"), suffixed)
      ).toBe(false);
      expect(
        hasAny(tokenise("ayşe'dan mehmet az önce satın aldı"), suffixed)
      ).toBe(false);
      expect(
        hasAny(tokenise("Ayşe Mehmet az önce satın aldı"), suffixed)
      ).toBe(false);
    });

    it("orders hits of one start by entry order", () => {
      const hits = findPhrases(
        tokenise("Ayşe'dan Mehmet az önce satın aldı"),
        purchases
      );
      const atZero = hits.filter((h) => h.start === 0).map((h) => h.entry);
      expect(atZero).toEqual([
        "@'dan @ az önce satın aldı",
        "@ az önce satın aldı",
      ]);
    });
  });

  describe("bounded work", () => {
    const nearMatches = compilePhrases({
      en: [
        "only only only # left",
        ...Array.from({ length: 200 }, (_, i) => `only k${i} left`),
      ],
      tr: [],
    });

    it("stays fast on 5,000 repeated near-matches", () => {
      const text = `${"only ".repeat(5000)}2 left`;
      const start = performance.now();
      const hits = findPhrases(tokenise(text), nearMatches);
      expect(performance.now() - start).toBeLessThan(500);
      expect(hits.length).toBeLessThanOrEqual(MAX_TOKENS_PER_TEXT);
    });

    it("looks only at the first MAX_TOKENS_PER_TEXT tokens of a long array", () => {
      const long: Token[] = Array.from({ length: 5000 }, (_, index) => ({
        norm: "only",
        surface: "only",
        kind: "word",
        index,
      }));
      const start = performance.now();
      const hits = findPhrases(long, nearMatches);
      expect(performance.now() - start).toBeLessThan(500);
      expect(hits).toEqual([]);
      const tail: Token[] = [
        ...long.slice(0, MAX_TOKENS_PER_TEXT),
        { norm: "2", surface: "2", kind: "number", index: MAX_TOKENS_PER_TEXT },
        { norm: "left", surface: "left", kind: "word", index: MAX_TOKENS_PER_TEXT + 1 },
      ];
      expect(findPhrases(tail, nearMatches)).toEqual([]);
    });

    it("returns every hit of a repeated phrase up to the limit", () => {
      const repeated = compilePhrases({ en: ["only # left"], tr: [] });
      const tokens = tokenise("only 2 left ".repeat(40));
      // The 300-character cut leaves 25 full repeats.
      expect(findPhrases(tokens, repeated)).toHaveLength(25);
      expect(findPhrases(tokens, repeated, 5)).toHaveLength(5);
    });
  });
});

describe("quote", () => {
  it("wraps text in double quotes", () => {
    expect(quote("Only 2 left")).toBe('"Only 2 left"');
  });

  it("swaps inner double quotes for single quotes", () => {
    expect(quote('say "hi" now')).toBe(`"say 'hi' now"`);
  });

  it("strips control characters and turns line breaks into spaces", () => {
    expect(quote("a\u0000b\u0007c\u007fd\u0085e")).toBe('"abcde"');
    expect(quote("a\tb\nc\rd")).toBe('"a b c d"');
  });

  it("cuts to MAX_QUOTE_CHARS and adds an ellipsis inside the quotes", () => {
    expect(quote("x".repeat(MAX_QUOTE_CHARS))).toBe(
      `"${"x".repeat(MAX_QUOTE_CHARS)}"`
    );
    expect(quote("x".repeat(MAX_QUOTE_CHARS + 1))).toBe(
      `"${"x".repeat(MAX_QUOTE_CHARS)}…"`
    );
    const huge = quote("x".repeat(1_000_000));
    expect(huge).toBe(`"${"x".repeat(MAX_QUOTE_CHARS)}…"`);
  });

  it("adds the ellipsis when only the input read cap cut the text", () => {
    const input = `${"\u0000".repeat(MAX_TEXT_READ)}abc`;
    expect(quote(input)).toBe('"…"');
  });

  it("does not leave half of a surrogate pair at the cut", () => {
    const input = `${"x".repeat(MAX_QUOTE_CHARS - 1)}\u{1F600}\u{1F600}`;
    expect(quote(input)).toBe(`"${"x".repeat(MAX_QUOTE_CHARS - 1)}…"`);
  });

  it("gives an empty quote for anything that is not a string", () => {
    expect(quote(undefined)).toBe('""');
    expect(quote(null)).toBe('""');
    expect(quote(12)).toBe('""');
    expect(quote({})).toBe('""');
  });

  describe("forbidden words", () => {
    it("masks a forbidden word and keeps the rest", () => {
      expect(quote("This is a scam!")).toBe('"This is a [word omitted]!"');
      expect(quote("SCAM and Fraudulent")).toBe(
        '"[word omitted] and [word omitted]"'
      );
      expect(quote("totally illegal, illegally")).toBe(
        '"totally [word omitted], [word omitted]"'
      );
    });

    it("masks Turkish words, also with a dotless or dotted i", () => {
      expect(quote("Bu yasadışı")).toBe('"Bu [word omitted]"');
      expect(quote("YASADIŞI")).toBe('"[word omitted]"');
      expect(quote("Dolandırıcı ve aldatıcı")).toBe(
        '"[word omitted] ve [word omitted]"'
      );
      expect(quote("DOLANDIRICILIK")).toBe('"[word omitted]"');
    });

    it("masks a possessive and a word with a suffix after an apostrophe", () => {
      expect(quote("the scam's end")).toBe('"the [word omitted] end"');
      expect(quote("dolandırıcı'dan")).toBe('"[word omitted]"');
      expect(quote("the scam\u2019s end")).toBe('"the [word omitted] end"');
    });

    it("masks a word hidden by zero-width characters or full-width letters", () => {
      expect(quote("sc\u200bam")).toBe('"[word omitted]"');
      expect(quote("sc\u00adam")).toBe('"[word omitted]"');
      expect(quote("ｓｃａｍ")).toBe('"[word omitted]"');
    });

    it("masks a word next to digits and punctuation", () => {
      expect(quote("anti-scam")).toBe('"anti-[word omitted]"');
      expect(quote("2fraud")).toBe('"2[word omitted]"');
      expect(quote("(scam)")).toBe('"([word omitted])"');
    });

    it("leaves a different word that only contains a listed one", () => {
      expect(quote("scampi")).toBe('"scampi"');
      expect(quote("cheaters")).toBe('"cheaters"');
      expect(quote("the lies of the sea")).toBe('"the lies of the sea"');
    });

    it("never lets a listed word through, also at the cut", () => {
      const text = `${"x".repeat(MAX_QUOTE_CHARS - 5)} scam fraud illegal`;
      const result = quote(text);
      for (const word of FORBIDDEN_WORDS) {
        expect(result.toLowerCase()).not.toContain(word);
      }
    });
  });
});

describe("FORBIDDEN_WORDS", () => {
  it("is a frozen list of plain lower-case words", () => {
    expect(Object.isFrozen(FORBIDDEN_WORDS)).toBe(true);
    for (const word of FORBIDDEN_WORDS) {
      expect(word).toBe(word.trim());
      expect(word).not.toContain(" ");
      expect(word).toBe(word.toLowerCase());
    }
  });

  it("holds the words of design section 7", () => {
    expect([...FORBIDDEN_WORDS]).toEqual([
      "illegal",
      "illegally",
      "unlawful",
      "scam",
      "scams",
      "scammy",
      "fraud",
      "fraudulent",
      "deceptive",
      "deceive",
      "deceives",
      "deceiving",
      "deceit",
      "dishonest",
      "cheat",
      "cheating",
      "yasadışı",
      "dolandırıcı",
      "dolandırıcılık",
      "aldatıcı",
    ]);
  });

  it("does not list the spatial word 'lies'", () => {
    expect(FORBIDDEN_WORDS).not.toContain("lies");
  });
});

describe("maskDigits", () => {
  it("gives the same shape for different numbers", () => {
    expect(maskDigits("Only 4 left")).toBe(maskDigits("Only 7 left"));
    expect(maskDigits("Only 4 left")).toBe(maskDigits("Only 12 left"));
    expect(maskDigits("only 4 left")).toBe("only # left");
  });

  it("collapses each digit run and keeps separators", () => {
    expect(maskDigits("04:59:59")).toBe("#:#:#");
    expect(maskDigits("9:59")).toBe("#:#");
    expect(maskDigits("1,299.90 tl")).toBe("#,#.# tl");
    expect(maskDigits("no digits")).toBe("no digits");
  });

  it("gives an empty string for a non-string", () => {
    expect(maskDigits(undefined as unknown as string)).toBe("");
  });
});
