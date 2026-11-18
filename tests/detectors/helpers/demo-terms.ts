import {
  FIXED_SALE_TEXT,
  HERO_COUNTDOWN_LABEL,
  ROLLING_MIDNIGHT_TEXT,
} from "@/lib/boo-tique/content";
import { SOLD_TOAST_MESSAGES } from "@/lib/boo-tique/countdown";
import { loadFixture } from "@/tests/boo-tique/helpers/fixture";

/**
 * Words that belong to the demo shop (design section 14): shop name, route
 * segments, product, brand and theme words. They never appear in the detector
 * source or in a word list.
 */
export const DEMO_TERMS: readonly string[] = Object.freeze([
  "boo",
  "bootique",
  "tique",
  "boo-tique",
  "crypt",
  "raven",
  "coffin",
  "curse",
  "cursed",
  "ghost",
  "ghoul",
  "mortal",
  "haunting",
  "phantom",
  "candle",
  "pepper",
  "tote",
  "hoodie",
  "nanza",
  "morgan",
  "riley",
  "ohio",
  "texas",
  "maine",
  "oregon",
  "ghost-pepper-candle",
]);

/**
 * Accept and decline texts of the club offer cards, copied from
 * components/boo-tique/club-offers.tsx.
 */
const CLUB_OFFER_TEXTS: readonly string[] = Object.freeze([
  "Yes, give me 20% off!",
  "No thanks, I hate saving money",
  "Yes, ship it free",
  "I'll pay full price like a mortal",
  "Add protection",
  "Maybe later, I don't need protection",
  "Subscribe",
  "No thanks",
]);

function isLetterOrDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * The strings inside single quotes of a text. An apostrophe between two
 * letters ("I'll", "don't") neither opens nor closes a string: a string opens
 * at a quote that does not follow a letter or digit and closes at the next
 * quote that is not followed by one.
 */
export function singleQuotedStrings(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'" && !isLetterOrDigit(text[i - 1])) {
      let end = -1;
      for (let j = i + 1; j < text.length; j += 1) {
        if (text[j] === "'" && !isLetterOrDigit(text[j + 1])) {
          end = j;
          break;
        }
      }
      if (end > i + 1) {
        found.push(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    i += 1;
  }
  return found;
}

/**
 * Every text the Boo-tique plants: the content constants of the home page, the
 * toast messages, the club offer texts and the single-quoted strings of the
 * fixture's `element` fields. No word list may equal or contain one of them.
 */
export function plantedTexts(): string[] {
  const texts: string[] = [
    FIXED_SALE_TEXT,
    ROLLING_MIDNIGHT_TEXT,
    HERO_COUNTDOWN_LABEL,
    ...SOLD_TOAST_MESSAGES,
    ...CLUB_OFFER_TEXTS,
  ];
  for (const entry of loadFixture()) {
    texts.push(...singleQuotedStrings(entry.element));
  }
  return [...new Set(texts)];
}
