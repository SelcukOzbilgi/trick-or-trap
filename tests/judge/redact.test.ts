import { describe, it, expect } from "vitest";
import { isMostlyRedacted, redactText } from "@/lib/judge/redact";
import { REDACTED_SHARE_MAX } from "@/lib/judge/constants";

describe("4.1 email addresses", () => {
  it("replaces an email with [email]", () => {
    expect(redactText("Write to jane.doe+shop@mail.example.com now")).toBe(
      "Write to [email] now",
    );
  });

  it("replaces an email with non-ASCII letters", () => {
    expect(redactText("Yaz: şule@örnek.com.tr lütfen")).toBe(
      "Yaz: [email] lütfen",
    );
  });

  it("replaces every email in a text", () => {
    expect(redactText("a@b.co, c@d.org")).toBe("[email], [email]");
  });
});

describe("4.2 URLs", () => {
  it("replaces a scheme URL", () => {
    expect(redactText("See https://shop.example/sale?x=1 today")).toBe(
      "See [link] today",
    );
  });

  it("replaces a www host", () => {
    expect(redactText("Visit www.example.com now")).toBe("Visit [link] now");
  });

  it("replaces a dotted host followed by a slash, a question mark or a hash", () => {
    expect(redactText("go shop.example.com/cart now")).toBe("go [link] now");
    expect(redactText("go shop.example.com?a=1 now")).toBe("go [link] now");
    expect(redactText("go example.com#top now")).toBe("go [link] now");
  });

  it("keeps a bare host name and ordinary punctuation", () => {
    expect(redactText("Powered by example.com")).toBe("Powered by example.com");
    expect(redactText("Mon.-Fri./Sat. 9:00")).toBe("Mon.-Fri./Sat. 9:00");
    expect(redactText("and/or 50.00/month")).toBe("and/or 50.00/month");
  });
});

describe("4.3 long digit runs", () => {
  it("replaces a Turkish phone number", () => {
    expect(redactText("Call 0532 123 45 67 now")).toBe("Call [number] now");
  });

  it("replaces a card number with spaces, dashes or dots", () => {
    expect(redactText("Card 4111 1111 1111 1111 ok")).toBe("Card [number] ok");
    expect(redactText("Card 4111-1111-1111-1111 ok")).toBe("Card [number] ok");
    expect(redactText("Card 4111.1111.1111.1111 ok")).toBe("Card [number] ok");
  });

  it("replaces an 11-digit number such as a TC Kimlik", () => {
    expect(redactText("TC 12345678901 girin")).toBe("TC [number] girin");
  });

  it("replaces exactly 9 digits and keeps 8", () => {
    expect(redactText("123456789")).toBe("[number]");
    expect(redactText("12345678")).toBe("12345678");
    expect(redactText("1234 5678")).toBe("1234 5678");
  });

  it("does not join digits across two spaces or other separators", () => {
    expect(redactText("1234  5678  9012")).toBe("1234  5678  9012");
    expect(redactText("1234,5678,9012")).toBe("1234,5678,9012");
  });
});

describe("4.4 IBAN-shaped strings", () => {
  it("replaces an IBAN with spaces", () => {
    expect(redactText("IBAN: GB29 NWBK 6016 1331 9268 19 thanks")).toBe(
      "IBAN: [number] thanks",
    );
  });

  it("replaces a Turkish IBAN", () => {
    expect(redactText("TR33 0006 1005 1978 6457 8413 26")).toBe("[number]");
  });

  it("replaces an IBAN without spaces", () => {
    expect(redactText("DE89370400440532013000")).toBe("[number]");
    expect(redactText("GB29NWBK60161331926819")).toBe("[number]");
  });

  it("keeps ordinary capitalised words next to a short code", () => {
    expect(redactText("AB12 is a code word here")).toBe(
      "AB12 is a code word here",
    );
    expect(redactText("USD 24 TOTAL")).toBe("USD 24 TOTAL");
  });
});

describe("4.5 handles", () => {
  it("replaces an @handle", () => {
    expect(redactText("Follow @shop_name today")).toBe("Follow [handle] today");
  });

  it("replaces a handle with non-ASCII letters", () => {
    expect(redactText("Takip et @mağaza şimdi")).toBe("Takip et [handle] şimdi");
  });

  it("keeps a lone at sign", () => {
    expect(redactText("5 @ 3 each")).toBe("5 @ 3 each");
  });
});

describe("4.6 order of the rules", () => {
  it("applies the email rule before the URL rule", () => {
    expect(redactText("user@shop.example.com/path")).toBe("[email]/path");
  });

  it("applies the email rule before the handle rule", () => {
    expect(redactText("me@x.com")).toBe("[email]");
  });

  it("applies the URL rule before the digit rule", () => {
    expect(redactText("https://x.example/12345678901")).toBe("[link]");
  });

  it("applies the digit rule before the IBAN rule", () => {
    // The digit run turns into a placeholder first; the IBAN rule then
    // collapses the letters around it.
    expect(redactText("GB29 NWBK 6016 1331 9268 19")).toBe("[number]");
  });

  it("applies the URL rule before the handle rule", () => {
    expect(redactText("see example.com/@user please")).toBe("see [link] please");
  });
});

describe("4.8 text that stays", () => {
  it.each([
    "2.450,00 TL",
    "$24.99",
    "Only 3 left",
    "12:45",
    "Ends in 12:45:30",
    "Save 20%",
    "1,234 people are viewing this",
    "Priya from Cardiff bought this 2 minutes ago",
    "Sipariş 3 saat içinde kargoda",
  ])("keeps %j", (text) => {
    expect(redactText(text)).toBe(text);
  });
});

describe("4.7 isMostlyRedacted", () => {
  it("is true above one half", () => {
    expect(isMostlyRedacted("[number]")).toBe(true);
    expect(isMostlyRedacted("[email] x")).toBe(true);
    expect(isMostlyRedacted("[link]abcde")).toBe(true);
  });

  it("is false at exactly one half and below", () => {
    expect(REDACTED_SHARE_MAX).toBe(0.5);
    // 6 placeholder characters of 12.
    expect(isMostlyRedacted("[link]abcdef")).toBe(false);
    expect(isMostlyRedacted("[link]abcdefg")).toBe(false);
  });

  it("is false for plain text and the empty string", () => {
    expect(isMostlyRedacted("Only 3 left")).toBe(false);
    expect(isMostlyRedacted("")).toBe(false);
  });

  it("counts every kind of placeholder", () => {
    expect(isMostlyRedacted("[handle]")).toBe(true);
    expect(isMostlyRedacted("[handle] [email] ok")).toBe(true);
    expect(isMostlyRedacted("Buy now [handle] today, please")).toBe(false);
  });

  it("gives the same answer for redacted raw text", () => {
    expect(isMostlyRedacted(redactText("0532 123 45 67"))).toBe(true);
    expect(isMostlyRedacted(redactText("Call 0532 123 45 67 for a quote"))).toBe(
      false,
    );
  });
});

describe("4.9 property test", () => {
  // Fixed-seed generator (mulberry32); no Math.random.
  function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const ALPHABET = [
    ..."0123456789",
    ..."0123456789",
    " ",
    " ",
    ".",
    "-",
    ..."abcdefghijklmnopqrstuvwxyz",
    ..."ABCDEFGHIJ",
    "@",
    "/",
    ":",
    "?",
    "#",
  ];

  function randomString(random: () => number): string {
    const length = Math.floor(random() * 90);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    return out;
  }

  it("leaves no URL, handle, email or long digit run in 2,000 random strings", () => {
    const random = createRandom(20260101);
    for (let i = 0; i < 2000; i += 1) {
      const input = randomString(random);
      const output = redactText(input);
      expect(output, input).not.toContain("://");
      expect(output, input).not.toMatch(/@\p{L}/u);
      expect(output, input).not.toMatch(/@[\p{L}\p{N}_]/u);
      expect(output, input).not.toMatch(/\d{9}/);
      expect(output, input).not.toMatch(/\d(?:[ .-]?\d){8}/);
    }
  });

  it("injects digit runs, hosts and handles that the random strings rarely build", () => {
    const random = createRandom(7);
    const pieces = [
      "0532 123 45 67",
      "4111 1111 1111 1111",
      "12345678901",
      "a@b.co",
      "@someone",
      "http://x.example/y",
      "www.x.example",
      "x.example/p",
    ];
    for (let i = 0; i < 500; i += 1) {
      const a = randomString(random);
      const b = randomString(random);
      const piece = pieces[Math.floor(random() * pieces.length)];
      const output = redactText(`${a} ${piece} ${b}`);
      expect(output).not.toContain("://");
      expect(output).not.toMatch(/@[\p{L}\p{N}_]/u);
      expect(output).not.toMatch(/\d(?:[ .-]?\d){8}/);
    }
  });
});

describe("bounded work", () => {
  it("handles adversarial 200-character inputs", () => {
    const inputs = [
      "a".repeat(200),
      `${"a".repeat(199)}@`,
      "a.".repeat(100),
      "1 ".repeat(100),
      "1.".repeat(100),
      `${"a-".repeat(60)}.com${"/".repeat(5)}`,
      `AB12${" ABCD".repeat(40)}`,
      "@".repeat(200),
    ];
    for (const input of inputs) {
      expect(typeof redactText(input)).toBe("string");
    }
  });
});
