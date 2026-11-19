import type { PatternId } from "@/lib/types";
import type { PageNode } from "@/tests/detectors/eval/helpers/tree";

/**
 * The hold-out case table (requirement 4, design section 13): 28 flag cases, 20 honest
 * look-alikes and 10 extras (8 first written, 2 banner cases added after the second review),
 * written once and never changed because of a result (4.7).
 *
 * Texts are written as the extractor delivers them: the own text of an element only.
 * Every page is a `body` with the case's elements and, where a control needs one, a
 * plain companion. Companion wording, chosen once by the author before the first run
 * and not fitted to a detector (4.11):
 *   - an accept button next to a decline: "Sign up" (English), "Kaydol" (Turkish);
 *   - a button after a check box or radio group: "Continue", "Devam";
 *   - the other shipping options of the radio group: "Express shipping $9.99",
 *     "Next-day shipping $14.99".
 * Elements marked ⟦…⟧ in the design, completed here once:
 *   - "Fırsatı kaçırma! Kampanya bitimine 01:59:59";
 *   - "Winter sale ends 28 February 2027";
 *   - "Accept all" and "Reject all" in equal style (grey fill, dark text, 160 x 40 px);
 *   - "Subscribe to our newsletter" and "Bültenimize abone ol";
 *   - "Mesafeli satış sözleşmesini okudum ve kabul ediyorum";
 *   - "Saat 14:00'e kadar verilen siparişler aynı gün kargoda".
 */

export type HoldoutGroup = "flag" | "honest" | "extra";

export type HoldoutShape =
  | "single"
  | "split-span"
  | "split-countdown"
  | "inflected-tr"
  | "reload-pair"
  | "form-control"
  | "banner";

export type HoldoutCase = {
  id: string;
  group: HoldoutGroup;
  language: "en" | "tr";
  shape: HoldoutShape;
  /** Present for a case that is expected to be flagged with this pattern. */
  pattern?: PatternId;
  /** The page text as written in design section 13 (markup shown for split cases). */
  text: string;
  first: PageNode;
  /** The tree after a reload, 9 s later. */
  reload?: PageNode;
  /** Key of the node a finding must name (flag cases). */
  node: string;
  /** Why the case is expected to stay missed. */
  knownMiss?: string;
};

const NODE = "node";

// ── Tree helpers ────────────────────────────────────────────────────────────

const body = (...children: PageNode[]): PageNode => ({ tag: "body", children });
const para = (text: string, key?: string, children?: PageNode[]): PageNode => ({
  tag: "p",
  text,
  ...(key !== undefined ? { key } : {}),
  ...(children !== undefined ? { children } : {}),
});
const button = (text: string, key?: string, extra: Partial<PageNode> = {}): PageNode => ({
  tag: "button",
  text,
  ...(key !== undefined ? { key } : {}),
  ...extra,
});
/** A container without own text, which the capture leaves out. */
const wrap = (...children: PageNode[]): PageNode => ({ tag: "div", children });
/** A parent with its own text and one child. */
const under = (parentText: string, child: PageNode): PageNode =>
  body({ tag: "div", text: parentText, children: [child] });

const ACCEPT: Record<"en" | "tr", string> = { en: "Sign up", tr: "Kaydol" };
const CONTINUE: Record<"en" | "tr", string> = { en: "Continue", tr: "Devam" };

const SPLIT_SPAN_MISS = "the number sits in a child element (claims split across elements are out of scope)";
const SPLIT_COUNTDOWN_MISS = "the three units sit in three child elements (claims split across elements are out of scope)";
const COUNTING_UP_MISS = "a rise of 7 s inside the 9 s gap is classed as counting up (old criterion 8.6)";

// ── Case builders ───────────────────────────────────────────────────────────

type Meta = { id: string; group: HoldoutGroup; language: "en" | "tr"; pattern?: PatternId };

function single(meta: Meta, text: string, shape: HoldoutShape = "single"): HoldoutCase {
  return { ...meta, shape, text, first: body(para(text, NODE)), node: NODE };
}

/** A text in the form the extractor delivers a Turkish suffixed claim: one element. */
function inflected(meta: Meta, text: string): HoldoutCase {
  return single(meta, text, "inflected-tr");
}

function reloadPair(meta: Meta, text: string, reloadText: string = text): HoldoutCase {
  return {
    ...meta,
    shape: "reload-pair",
    text,
    first: body(para(text, NODE)),
    reload: body(para(reloadText, NODE)),
    node: NODE,
  };
}

/** A decline button next to an accept button. */
function declinePage(meta: Meta, text: string): HoldoutCase {
  const accept = button(ACCEPT[meta.language], "accept");
  return { ...meta, shape: "banner", text, first: body(wrap(accept, button(text, NODE))), node: NODE };
}

function checkInput(type: "checkbox" | "radio", checked: boolean, name?: string): PageNode {
  return { tag: "input", attrs: { type, ...(name !== undefined ? { name } : {}) }, checked };
}

/** A label with a nested input, under a div with a companion button. */
function controlPage(meta: Meta, text: string, checked: boolean): HoldoutCase {
  const label: PageNode = { tag: "label", key: NODE, text, children: [checkInput("checkbox", checked)] };
  return {
    ...meta,
    shape: "form-control",
    text,
    first: body(wrap(label, button(CONTINUE[meta.language]))),
    node: NODE,
  };
}

/** A shipping radio group with the cheapest option checked. */
function radioGroupPage(meta: Meta, text: string): HoldoutCase {
  const option = (label: string, checked: boolean, key?: string): PageNode => ({
    tag: "label",
    text: label,
    ...(key !== undefined ? { key } : {}),
    children: [checkInput("radio", checked, "shipping")],
  });
  return {
    ...meta,
    shape: "form-control",
    text,
    first: body(
      wrap(
        option(text, true, NODE),
        option("Express shipping $9.99", false),
        option("Next-day shipping $14.99", false),
        button(CONTINUE[meta.language])
      )
    ),
    node: NODE,
  };
}

const BUTTON_BOX = { width: 160, height: 40 };

/** The banner sentence of the two cases added after the second review. Fixed once, never changed. */
const BANNER_SENTENCE = "We use cookies to improve your experience.";

/** An accept and a reject button under a container without own text. */
function bannerPage(
  meta: Meta,
  accept: { style: PageNode["style"] },
  reject: { style: PageNode["style"] },
  container: PageNode["style"],
  /** A banner sentence, captured as its own text element before the two buttons. */
  sentence?: string
): HoldoutCase {
  const buttons: PageNode[] = [
    button("Accept all", NODE, { style: { ...accept.style, fontSize: 16 }, box: { x: 0, ...BUTTON_BOX } }),
    button("Reject all", "reject", { style: { ...reject.style, fontSize: 16 }, box: { x: 180, ...BUTTON_BOX } }),
  ];
  return {
    ...meta,
    shape: "banner",
    text: sentence === undefined ? "Accept all / Reject all" : `${sentence} Accept all / Reject all`,
    first: body({
      tag: "div",
      style: container,
      children:
        sentence === undefined
          ? buttons
          : [{ tag: "p", key: "sentence", text: sentence, style: { color: "#ffffff" } }, ...buttons],
    }),
    node: NODE,
  };
}

const flag = (id: string, language: "en" | "tr", pattern: PatternId): Meta => ({ id, group: "flag", language, pattern });
const honest = (id: string, language: "en" | "tr"): Meta => ({ id, group: "honest", language });
const extra = (id: string, language: "en" | "tr", pattern?: PatternId): Meta => ({
  id,
  group: "extra",
  language,
  ...(pattern !== undefined ? { pattern } : {}),
});

// ── The 28 flag cases ───────────────────────────────────────────────────────

const SPLIT_SPAN_FIRST: PageNode = body(para("Only left in stock", NODE, [{ tag: "span", text: "3" }]));
const SPLIT_COUNTDOWN_FIRST: PageNode = body(
  para("Offer ends in : :", NODE, [
    { tag: "span", text: "02" },
    { tag: "span", text: "14" },
    { tag: "span", text: "33" },
  ])
);

const FLAG_CASES: readonly HoldoutCase[] = [
  // fake-scarcity
  single(flag("scarcity-hurry-only-3-left", "en", "fake-scarcity"), "Hurry! Only 3 left in stock"),
  single(flag("scarcity-tukenmek-uzere", "tr", "fake-scarcity"), "Tükenmek üzere!"),
  single(flag("scarcity-son-3-urun", "tr", "fake-scarcity"), "Son 3 ürün!"),
  single(flag("scarcity-stokta-son-2-adet", "tr", "fake-scarcity"), "Stokta son 2 adet"),
  single(flag("scarcity-selling-fast", "en", "fake-scarcity"), "Selling fast"),
  single(flag("scarcity-almost-gone", "en", "fake-scarcity"), "Almost gone!"),
  single(flag("scarcity-stokta-son-urunler", "tr", "fake-scarcity"), "Stokta son ürünler"),
  {
    ...flag("scarcity-only-3-split-span", "en", "fake-scarcity"),
    shape: "split-span",
    text: "Only <span>3</span> left in stock",
    first: SPLIT_SPAN_FIRST,
    node: NODE,
    knownMiss: SPLIT_SPAN_MISS,
  },
  // fake-activity
  single(flag("activity-12-people-looking", "en", "fake-activity"), "12 people are looking at this right now"),
  inflected(flag("activity-istanbul-ayse-az-once", "tr", "fake-activity"), "İstanbul'dan Ayşe az önce satın aldı"),
  reloadPair(
    flag("activity-5-people-in-cart", "en", "fake-activity"),
    "5 people have this in their cart",
    "9 people have this in their cart"
  ),
  single(
    flag("activity-sarah-london-purchased", "en", "fake-activity"),
    "Sarah in London purchased a Blue Dress 5 minutes ago"
  ),
  single(flag("activity-23-kisi-bakiyor", "tr", "fake-activity"), "23 kişi şu an bakıyor"),
  reloadPair(
    flag("activity-15-kisi-inceliyor", "tr", "fake-activity"),
    "Bu ürünü şu anda 15 kişi inceliyor",
    "Bu ürünü şu anda 27 kişi inceliyor"
  ),
  // fake-urgency
  single(flag("urgency-sale-ends-tonight", "en", "fake-urgency"), "Sale ends tonight!"),
  single(flag("urgency-deal-ends-today", "en", "fake-urgency"), "Deal ends today"),
  reloadPair(flag("urgency-offer-ends-reload", "en", "fake-urgency"), "Offer ends in 02:14:33", "Offer ends in 02:14:59"),
  inflected(flag("urgency-kampanya-gece-yarisi", "tr", "fake-urgency"), "Kampanya gece yarısı bitiyor, kaçırmayın!"),
  reloadPair(
    flag("urgency-firsati-kacirma-equal", "tr", "fake-urgency"),
    "Fırsatı kaçırma! Kampanya bitimine 01:59:59"
  ),
  {
    ...flag("urgency-offer-split-countdown", "en", "fake-urgency"),
    shape: "split-countdown",
    text: "Offer ends in <span>02</span>:<span>14</span>:<span>33</span>",
    first: SPLIT_COUNTDOWN_FIRST,
    node: NODE,
    knownMiss: SPLIT_COUNTDOWN_MISS,
  },
  // confirmshaming
  declinePage(flag("confirm-no-thanks-free-stuff", "en", "confirmshaming"), "No thanks, I don't like free stuff"),
  declinePage(flag("confirm-prefer-full-price", "en", "confirmshaming"), "No, I prefer paying full price"),
  declinePage(flag("confirm-hayir-indirim-istemiyorum", "tr", "confirmshaming"), "Hayır, indirim istemiyorum"),
  declinePage(
    flag("confirm-hayir-indirimleri-kacirmak", "tr", "confirmshaming"),
    "Hayır, indirimleri kaçırmak istiyorum"
  ),
  // preselection
  controlPage(flag("presel-shipping-insurance", "en", "preselection"), "Add shipping insurance for $2.99", true),
  controlPage(flag("presel-email-offers", "en", "preselection"), "email me offers and promotions", true),
  controlPage(
    flag("presel-kampanya-eposta", "tr", "preselection"),
    "Kampanyalardan e-posta ile haberdar olmak istiyorum",
    true
  ),
  controlPage(flag("presel-urun-koruma", "tr", "preselection"), "Ürün koruma paketi ekle +49,90 TL", true),
];

// ── The 20 honest cases ─────────────────────────────────────────────────────

const HONEST_CASES: readonly HoldoutCase[] = [
  reloadPair(honest("honest-only-3-same-after-reload", "en"), "Only 3 left in stock"),
  single(honest("honest-only-5-m-left", "en"), "Only 5 m left"),
  single(honest("honest-only-1-m-left", "en"), "Only 1 M left"),
  single(honest("honest-winter-sale-date", "en"), "Winter sale ends 28 February 2027"),
  reloadPair(honest("honest-3-in-stock-same-after-reload", "en"), "3 in stock"),
  reloadPair(honest("honest-stokta-3-adet-same-after-reload", "tr"), "Stokta 3 adet"),
  bannerPage(
    honest("honest-banner-equal-style", "en"),
    { style: { backgroundColor: "#e5e7eb", color: "#111111" } },
    { style: { backgroundColor: "#e5e7eb", color: "#111111" } },
    { position: "fixed" }
  ),
  declinePage(honest("honest-no-thanks", "en"), "No thanks"),
  declinePage(honest("honest-hayir-tesekkurler", "tr"), "Hayır, teşekkürler"),
  controlPage(honest("honest-newsletter-unticked-en", "en"), "Subscribe to our newsletter", false),
  controlPage(honest("honest-newsletter-unticked-tr", "tr"), "Bültenimize abone ol", false),
  controlPage(honest("honest-terms-ticked", "en"), "I agree to the Terms", true),
  controlPage(
    honest("honest-mesafeli-ticked", "tr"),
    "Mesafeli satış sözleşmesini okudum ve kabul ediyorum",
    true
  ),
  single(honest("honest-order-within-2h-15m", "en"), "Order within 2h 15m for next-day delivery"),
  single(honest("honest-reviews-4-8", "en"), "4.8 (1,203 reviews)"),
  inflected(honest("honest-kis-indirimi-date", "tr"), "Kış indirimi 28 Şubat 2027'de sona eriyor"),
  inflected(honest("honest-sepetinizde-2-urun", "tr"), "Sepetinizde 2 ürün var"),
  inflected(honest("honest-saat-14-kargo", "tr"), "Saat 14:00'e kadar verilen siparişler aynı gün kargoda"),
  radioGroupPage(honest("honest-shipping-radio-cheapest", "en"), "Standard shipping $4.99"),
  single(honest("honest-free-returns", "en"), "Free returns within 30 days"),
];

// ── The extras ──────────────────────────────────────────────────────────────

const EXTRA_CASES: readonly HoldoutCase[] = [
  {
    ...extra("extra-free-returns-under-sale", "en"),
    shape: "single",
    text: "Free returns within 30 days",
    first: under("Sale", para("Free returns within 30 days", NODE)),
    node: NODE,
  },
  {
    ...extra("extra-battery-next-to-save", "en"),
    shape: "single",
    text: "Battery life 12 hours",
    first: body(para("Battery life 12 hours", NODE), para("Save 10%")),
    node: NODE,
  },
  {
    ...extra("extra-video-under-sale", "en"),
    shape: "single",
    text: "Video 12:34",
    first: under("Sale", para("Video 12:34", NODE)),
    node: NODE,
  },
  {
    ...extra("extra-ready-in-15-min", "en"),
    shape: "single",
    text: "Ready in 15 min",
    first: under("Deal of the day", para("Ready in 15 min", NODE)),
    node: NODE,
  },
  single(extra("extra-delivery-2-days-20-off", "en"), "Delivery in 2 days · 20% off"),
  // The honest dark cookie banner of design section 12: a dark container without own text,
  // a filled light accept button and a transparent reject button with light text.
  bannerPage(
    extra("extra-dark-banner", "en"),
    { style: { backgroundColor: "#ffffff", color: "#111111" } },
    { style: { backgroundColor: "transparent", color: "#ffffff" } },
    { position: "fixed", backgroundColor: "#111111" }
  ),
  single(extra("extra-only-2-days-left", "en", "fake-urgency"), "Only 2 days left"),
  {
    ...reloadPair(extra("extra-offer-counting-up", "en", "fake-urgency"), "Offer ends in 02:14:33", "Offer ends in 02:14:40"),
    knownMiss: COUNTING_UP_MISS,
  },
  // Two more honest dark cookie banners, added after the second independent review (requirement
  // 4.2, fix (a)). The first two banner cases above have no banner sentence, so the detector never
  // compared their two buttons and their "0 false positives" is empty. These two carry the
  // sentence as a captured text element inside the banner container. Wording fixed once before
  // the first run and never changed. Nothing here is tuned to a result.
  //   - equal weight: both buttons have the same style and size on a dark container;
  //   - uncaptured wrapper: the same look as `extra-dark-banner` (filled light accept button,
  //     transparent reject button with light text, equal boxes) on a dark container without own text.
  // See `KNOWN_FALSE_POSITIVES` for which of them the detectors flag.
  bannerPage(
    extra("extra-dark-banner-with-sentence-equal-weight", "en"),
    { style: { backgroundColor: "#ffffff", color: "#111111" } },
    { style: { backgroundColor: "#ffffff", color: "#111111" } },
    { position: "fixed", backgroundColor: "#111111" },
    BANNER_SENTENCE
  ),
  bannerPage(
    extra("extra-dark-banner-with-sentence-uncaptured-wrapper", "en"),
    { style: { backgroundColor: "#ffffff", color: "#111111" } },
    { style: { backgroundColor: "transparent", color: "#ffffff" } },
    { position: "fixed", backgroundColor: "#111111" },
    BANNER_SENTENCE
  ),
];

/**
 * Honest hold-out cases that the detectors are known to flag today (second independent review).
 * Each id is an honest dark cookie banner on an uncaptured dark wrapper: the detector cannot see
 * the wrapper's background, so it measures the transparent reject button against an assumed white
 * page and reports a visual-interference finding on an honest banner. The fix is task 7 of
 * `.kiro/specs/detectors-static-fixes/tasks.md` (unseen layers behind uncaptured wrappers,
 * requirement 11), which has NOT been run. These cases are never counted as clean. When one stops
 * producing a false positive (for example because task 7 is done), `holdout-eval.test.ts` fails and
 * the entry must be removed from this list.
 *
 * `extra-dark-banner-with-sentence-equal-weight` is not listed: its two buttons have the same
 * style and size, so the detector skips the pair and the case is clean.
 */
export const KNOWN_FALSE_POSITIVES: readonly string[] = [
  // Open under task 7 of detectors-static-fixes (requirement 11).
  "extra-dark-banner-with-sentence-uncaptured-wrapper",
];

export const HOLDOUT_CASES: readonly HoldoutCase[] = [...FLAG_CASES, ...HONEST_CASES, ...EXTRA_CASES];
