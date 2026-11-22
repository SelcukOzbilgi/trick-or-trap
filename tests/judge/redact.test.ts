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

// Requirement 23 and design 24.4 (task 18.1): separators, parentheses, and
// protected dates and times in a digit run.

describe("23.5 dates and times stay readable", () => {
  it.each([
    "31.12.2025 23:59",
    "2025-12-31 23:59",
    "01.11.2026 - 30.11.2026",
    "12/31/2025",
  ])("keeps %j unchanged", (text) => {
    expect(redactText(text)).toBe(text);
  });

  it("keeps a date and a time inside a sentence", () => {
    expect(redactText("Offer ends 31.12.2025 at 23:59:30 sharp")).toBe(
      "Offer ends 31.12.2025 at 23:59:30 sharp",
    );
    expect(redactText("Valid 1/2/1999 and 2199.01.31")).toBe(
      "Valid 1/2/1999 and 2199.01.31",
    );
  });
});

describe("23.7 phone numbers with parentheses", () => {
  it("replaces a phone number with a parenthesised group", () => {
    expect(redactText("Call 0 (532) 123 45 67")).toBe("Call [number]");
  });

  it("puts the opening and closing parenthesis inside the replacement", () => {
    expect(redactText("(0532) 123-45-67")).toBe("[number]");
    expect(redactText("Call (0532 123 45 67) now")).toBe("Call [number] now");
    expect(redactText("see (123456789) ok")).toBe("see [number] ok");
  });

  it("keeps parentheses around a number that is too short", () => {
    expect(redactText("Size (12345678) fits")).toBe("Size (12345678) fits");
    expect(redactText("(532) 123")).toBe("(532) 123");
  });

  it("keeps a parenthesis that is not directly next to a digit", () => {
    expect(redactText("Call ( 0532 123 45 67 ) now")).toBe("Call ( [number] ) now");
  });
});

describe("23.8 card-like numbers with longer separators", () => {
  it("replaces a number split by a spaced dash", () => {
    expect(redactText("4111 - 1111 - 1111 - 1111")).toBe("[number]");
  });

  it("replaces a number split by slashes", () => {
    expect(redactText("4111/1111/1111/1111")).toBe("[number]");
    expect(redactText("Card 4111 / 1111 / 1111 / 1111 ok")).toBe("Card [number] ok");
  });

  it("does not join digits across a gap of four characters", () => {
    expect(redactText("1234 -.- 5678 -.- 9012")).toBe("1234 -.- 5678 -.- 9012");
  });
});

describe("23.6 and 23.11 digits next to dates and times", () => {
  it("replaces a phone number and keeps the date after it", () => {
    expect(redactText("0532 123 45 67 until 31.12.2025")).toBe(
      "[number] until 31.12.2025",
    );
  });

  it("replaces digits that come before a time", () => {
    expect(redactText("1234567890 12:30")).toBe("[number] 12:30");
  });

  it("replaces digits that come after a time", () => {
    expect(redactText("12:30 1234567890")).toBe("12:30 [number]");
  });

  it("replaces digits on both sides of a date and keeps the date", () => {
    expect(redactText("1234567890 31.12.2025 0987654321")).toBe(
      "[number] 31.12.2025 [number]",
    );
    expect(redactText("12345678901 31.12.2025")).toBe("[number] 31.12.2025");
  });

  it("counts each part left after a date is cut out", () => {
    // 6 digits on each side of the date: neither part reaches 9.
    expect(redactText("123456 31.12.2025 654321")).toBe("123456 31.12.2025 654321");
    expect(redactText("123456 2025-12-31")).toBe("123456 2025-12-31");
  });

  it("redacts a digit run in which a time stands without the digits of its hour", () => {
    expect(redactText("123456789012:30")).toBe("[number]:30");
  });

  it("still redacts an IBAN and an 11-digit number next to a date", () => {
    expect(redactText("GB29 NWBK 6016 1331 9268 19 on 31.12.2025")).toBe(
      "[number] on 31.12.2025",
    );
    expect(redactText("TC 12345678901 girin")).toBe("TC [number] girin");
  });
});

describe("23.9 text that stays, with the new separators", () => {
  it.each([
    "Order 12345678 sent",
    "2.450,00 TL",
    "$24.99",
    "Only 3 left",
    "12:45",
    "Priya from Cardiff",
    "Sizes 36 - 37 - 38 - 39",
    "Open 9:00-17:30 (Mon-Fri)",
  ])("keeps %j", (text) => {
    expect(redactText(text)).toBe(text);
  });
});

describe("a value that only looks like a date is not protected", () => {
  it("does not protect a date with an impossible day or month", () => {
    expect(redactText("123456 45.13.2025")).toBe("[number]");
    expect(redactText("123456 13.45.2025")).toBe("[number]");
    expect(redactText("123456 2025-13-45")).toBe("[number]");
    expect(redactText("123456 00.12.2025")).toBe("[number]");
  });

  it("protects the same shape with plausible values", () => {
    expect(redactText("123456 31.12.2025")).toBe("123456 31.12.2025");
    expect(redactText("123456 12.31.2025")).toBe("123456 12.31.2025");
  });

  it("does not protect a date with a year outside 1900 to 2199", () => {
    expect(redactText("123456 31.12.1850")).toBe("[number]");
    expect(redactText("123456 31.12.2200")).toBe("[number]");
  });

  it("does not protect a date with two different separators", () => {
    expect(redactText("123456 31.12-2025")).toBe("[number]");
  });

  it("does not protect a date next to another digit", () => {
    expect(redactText("31.12.20251")).toBe("[number]");
    expect(redactText("131.12.2025")).toBe("[number]");
  });

  it("does not protect a time with an impossible hour or minute", () => {
    expect(redactText("1234567 25:30")).toBe("[number]:30");
    expect(redactText("1234567 12:60")).toBe("[number]:60");
    expect(redactText("1234567 12:5")).toBe("[number]:5");
  });

  it("protects a time with a plausible hour and minute", () => {
    expect(redactText("1234567 24:30")).toBe("1234567 24:30");
    expect(redactText("1234567 0:00")).toBe("1234567 0:00");
    expect(redactText("1234567 12:30:45")).toBe("1234567 12:30:45");
  });
});

describe("23.10 property test: separator shapes, dates and times", () => {
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

  // Gaps of 0 to 3 characters from the separator set, none with two spaces.
  const GAPS = ["", " ", ".", "-", "/", " - ", " / ", " (", ") ", "-/", ".-"];
  const WORDS = ["Call", "Card", "Phone", "ok", "now", "until", "Order", "Sent"];

  function pick<T>(random: () => number, list: readonly T[]): T {
    return list[Math.floor(random() * list.length)] as T;
  }

  /** A number shape with exactly `digitCount` digits, placeholder-style digits. */
  function numberShape(random: () => number, digitCount: number): string {
    const cycle = "1234567890";
    let out = random() < 0.2 ? "(" : "";
    let used = 0;
    let offset = Math.floor(random() * 10);
    while (used < digitCount) {
      const group = Math.min(digitCount - used, 1 + Math.floor(random() * 4));
      for (let i = 0; i < group; i += 1) {
        out += cycle.charAt((offset + i) % 10);
      }
      offset += group;
      used += group;
      if (used < digitCount) out += pick(random, GAPS);
    }
    if (random() < 0.2) out += ")";
    return out;
  }

  const DATE_SEPARATORS = [".", "-", "/"];

  function dateShape(random: () => number): string {
    const separator = pick(random, DATE_SEPARATORS);
    const year = 1900 + Math.floor(random() * 300);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 12);
    const dayFirst = random() < 0.5;
    if (random() < 0.5) return [year, month, day].join(separator);
    return dayFirst
      ? [day, month, year].join(separator)
      : [month, day, year].join(separator);
  }

  function timeShape(random: () => number): string {
    const hours = Math.floor(random() * 25);
    const minutes = String(Math.floor(random() * 60)).padStart(2, "0");
    const seconds = String(Math.floor(random() * 60)).padStart(2, "0");
    return random() < 0.5
      ? `${hours}:${minutes}`
      : `${hours}:${minutes}:${seconds}`;
  }

  /** The longest digit count of a run (gaps of the separator set) in `text`. */
  function longestRunDigits(text: string): number {
    const runs = text.match(
      /\p{Nd}(?:(?:[.\-/()]| (?! )){0,3}\p{Nd})*/gu,
    );
    let best = 0;
    for (const run of runs ?? []) {
      best = Math.max(best, run.replace(/\P{Nd}/gu, "").length);
    }
    return best;
  }

  it("redacts every number shape of 9 to 16 digits", () => {
    const random = createRandom(24041);
    for (let i = 0; i < 600; i += 1) {
      const digits = 9 + Math.floor(random() * 8);
      const shape = numberShape(random, digits);
      const input = `${pick(random, WORDS)} ${shape} ${pick(random, WORDS)}`;
      const output = redactText(input);
      expect(output, input).toContain("[number]");
      expect(longestRunDigits(output), input).toBeLessThan(9);
      expect(output, input).not.toMatch(/\d{5}/);
    }
  });

  it("keeps every number shape of 8 digits or fewer", () => {
    const random = createRandom(24042);
    for (let i = 0; i < 600; i += 1) {
      const digits = 1 + Math.floor(random() * 8);
      const shape = numberShape(random, digits);
      const input = `${pick(random, WORDS)} ${shape} ${pick(random, WORDS)}`;
      expect(redactText(input), input).toBe(input);
    }
  });

  it("keeps every plausible date and time between words", () => {
    const random = createRandom(24043);
    for (let i = 0; i < 600; i += 1) {
      const date = dateShape(random);
      const time = timeShape(random);
      const input = `${pick(random, WORDS)} ${date} ${time} ${pick(random, WORDS)}`;
      expect(redactText(input), input).toBe(input);
    }
  });

  it("redacts a number shape next to a date or a time and keeps the date or time", () => {
    const random = createRandom(24044);
    for (let i = 0; i < 600; i += 1) {
      const digits = 9 + Math.floor(random() * 6);
      const shape = numberShape(random, digits);
      const stamp = random() < 0.5 ? dateShape(random) : timeShape(random);
      const input =
        random() < 0.5
          ? `${shape} ${stamp} ${pick(random, WORDS)}`
          : `${pick(random, WORDS)} ${stamp} ${shape}`;
      const output = redactText(input);
      expect(output, input).toContain(stamp);
      expect(output, input).toContain("[number]");
      // With the date or time cut out, no run of 9 digits is left.
      expect(longestRunDigits(output.replace(stamp, "|")), input).toBeLessThan(9);
    }
  });

  it("leaves no URL, handle, email or long run in strings that mix every shape", () => {
    const random = createRandom(24045);
    const extras = ["a@b.co", "@someone", "http://x.example/y", "x.example/p"];
    for (let i = 0; i < 400; i += 1) {
      const parts = [
        numberShape(random, 9 + Math.floor(random() * 6)),
        dateShape(random),
        timeShape(random),
        pick(random, extras),
        pick(random, WORDS),
      ];
      // Fisher-Yates shuffle with the seeded generator.
      for (let j = parts.length - 1; j > 0; j -= 1) {
        const k = Math.floor(random() * (j + 1));
        const held = parts[j] as string;
        parts[j] = parts[k] as string;
        parts[k] = held;
      }
      const input = parts.join(" ");
      const output = redactText(input);
      expect(output, input).not.toContain("://");
      expect(output, input).not.toMatch(/@[\p{L}\p{N}_]/u);
    }
  });
});

describe("bounded work on longer text", () => {
  it("handles texts of 1,000 and 3,000 characters built to stress the digit rule", () => {
    const shapes = [
      "1 ".repeat(1500),
      "1.".repeat(1500),
      "1 - ".repeat(750),
      "(1)".repeat(1000),
      "1:30 ".repeat(600),
      "31.12.2025 ".repeat(270),
      "1/2/".repeat(750),
      "@a ".repeat(1000),
    ];
    for (const shape of shapes) {
      for (const length of [1000, 3000]) {
        expect(typeof redactText(shape.slice(0, length))).toBe("string");
      }
    }
  });

  it("redacts a number that starts at character 190 of a long text", () => {
    const text = `${"word ".repeat(38)}0532 123 45 67 tail`;
    expect(text.indexOf("0532")).toBe(190);
    expect(redactText(text)).toBe(`${"word ".repeat(38)}[number] tail`);
  });
});
