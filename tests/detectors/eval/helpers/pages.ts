import type { CSSProperties } from "react";
import { formatUsd } from "@/lib/boo-tique/cart";
import { PRODUCTS } from "@/lib/boo-tique/content";
import type { Product } from "@/lib/boo-tique/content";
import { perLoadValues } from "@/lib/boo-tique/per-load";
import type { PerLoadValues } from "@/lib/boo-tique/per-load";
import {
  ACCEPT_ALL_STYLE,
  ALMOST_GONE_STYLE,
  EQUAL_BUTTON_STYLE,
  GHOST_ACCEPT_STYLE,
  GHOST_REJECT_STYLE,
  OPTIONS_LINK_STYLE,
  PALETTE,
  UPSELL_ADD_STYLE,
  UPSELL_CLOSE_STYLE,
} from "@/lib/boo-tique/styles";
import { PageSnapshotSchema } from "@/lib/types";
import type { PageSnapshot } from "@/lib/types";
import { toLightSample } from "@/tests/detectors/eval/helpers/light";
import { buildSnapshot } from "@/tests/detectors/eval/helpers/tree";
import type { NodeStyle, PageNode } from "@/tests/detectors/eval/helpers/tree";

/**
 * Page trees of the Boo-tique for the evaluation harness (design section 13).
 *
 * Each factory mirrors the markup the shop renders for one route and variant, shell
 * included: texts, input states, roles and attributes are written out here, and the
 * structural sync test compares them with `renderRoute(route, { shell: true })`.
 * Inline styles come from `lib/boo-tique/styles.ts` and the palette. Styles that the
 * shop sets through CSS classes are copied from `app/boo-tique/boo-tique.css`; they are
 * guesses of the computed values and are listed in `CLASS_STYLE_PROPS`.
 *
 * Nodes carry no `data-*` attribute. A node `key` names a node for the entry map only
 * and never enters a snapshot.
 */

// ── Times and pairs ────────────────────────────────────────────────────────

/** Capture time of the first sample. */
export const BASE_TIME = "2026-12-01T12:00:00.000Z";
/** Capture time of the reload sample. */
export const RELOAD_TIME = "2026-12-01T12:00:09.000Z";
/** Seconds between the two samples. */
export const RELOAD_GAP_SECONDS = 9;

const ORIGIN = "https://boo-tique.example";

/**
 * Keys of nodes whose text is client state: the server markup always shows 04:59:59 and
 * 09:59, and the page ticks after load. The sync test compares them with digits masked.
 */
export const CLIENT_STATE_KEYS: readonly string[] = ["hero-countdown", "club-timer"];

/**
 * For planted nodes: the style values among font size, colour, background and opacity
 * that come from a CSS class and not from an inline style. The sync test requires every
 * other value to appear in the element's inline style in the markup.
 */
export const CLASS_STYLE_PROPS: Readonly<Record<string, readonly string[]>> = {
  "hero-countdown": ["fontSize"],
  "rolling-midnight": ["fontSize"],
  "fixed-date-sale": ["fontSize"],
  "cookie-banner": ["backgroundColor"],
  "selling-fast": ["backgroundColor", "color", "fontSize"],
  "packaging-switch": ["backgroundColor"],
  "sold-toast": ["backgroundColor"],
  "upsell-dialog": ["backgroundColor"],
  "newsletter-dialog": ["backgroundColor"],
};

/** A function that returns the given draws in turn and throws when they run out. */
export function sequence(draws: readonly number[]): () => number {
  let next = 0;
  return () => {
    if (next >= draws.length) throw new Error("The injected random sequence is exhausted.");
    const draw = draws[next];
    next += 1;
    return draw;
  };
}

// ── Style helpers ──────────────────────────────────────────────────────────

const WHITE = "#ffffff";

const H1_STYLE: NodeStyle = { fontSize: "40px", color: PALETTE.ink };
const H2_STYLE: NodeStyle = { fontSize: "28px", color: PALETTE.ink };
const H3_STYLE: NodeStyle = { fontSize: "20px", color: PALETTE.ink };
const LINK_STYLE: NodeStyle = { color: PALETTE.blood };
const MUTED_STYLE: NodeStyle = { color: PALETTE.muted };
const FIXED_PANEL_STYLE: NodeStyle = { position: "fixed", backgroundColor: PALETTE.paper };
const PROMO_STYLE: NodeStyle = { fontSize: "28px" };
const CHECK_STYLE: NodeStyle = { width: "20px", height: "20px" };

/** `.bt-button` with the quiet modifier (the Remove and Dismiss buttons). */
const QUIET_BUTTON_STYLE: NodeStyle = {
  color: PALETTE.blood,
  backgroundColor: "transparent",
  padding: "8px 12px",
  minHeight: "44px",
  border: "2px solid transparent",
};

/** `.bt-button`, the base button of the shop. */
const BUTTON_STYLE: NodeStyle = {
  color: WHITE,
  backgroundColor: PALETTE.blood,
  padding: "12px 24px",
  minHeight: "44px",
  border: `2px solid ${PALETTE.blood}`,
};

/** `.bt-button:disabled`. */
const DISABLED_BUTTON_STYLE: NodeStyle = {
  color: PALETTE.muted,
  backgroundColor: PALETTE.paper,
  padding: "12px 24px",
  minHeight: "44px",
  border: `2px solid ${PALETTE.muted}`,
};

/** `.bt-badge`. */
const BADGE_STYLE: NodeStyle = {
  color: WHITE,
  backgroundColor: PALETTE.blood,
  fontSize: "14px",
  padding: "2px 10px",
};

/** `.bt-toggle` with `aria-checked="true"`. */
const TOGGLE_ON_STYLE: NodeStyle = {
  display: "inline-flex",
  width: "44px",
  height: "24px",
  backgroundColor: PALETTE.blood,
};

/** The default close style of the overlay dialog (`overlay-dialog.tsx`). */
const DEFAULT_CLOSE_STYLE: CSSProperties = {
  fontSize: "20px",
  lineHeight: 1,
  color: PALETTE.ink,
  background: "transparent",
  border: 0,
  padding: "4px 8px",
};

/** A style from `styles.ts`, with the `background` shorthand moved to `backgroundColor`, which is what `tree.ts` reads. */
function inline(style: CSSProperties): NodeStyle {
  const { background, ...rest } = style;
  return background === undefined ? rest : { ...rest, backgroundColor: String(background) };
}

// ── Small node builders ────────────────────────────────────────────────────

function keyed(key: string | undefined): { key?: string } {
  return key === undefined ? {} : { key };
}

function para(text: string, key?: string, style?: NodeStyle): PageNode {
  return { ...keyed(key), tag: "p", text, ...(style === undefined ? {} : { style }) };
}

function heading(tag: "h1" | "h2" | "h3", text: string): PageNode {
  const style = tag === "h1" ? H1_STYLE : tag === "h2" ? H2_STYLE : H3_STYLE;
  return { tag, text, style };
}

function button(key: string | undefined, text: string, style: NodeStyle, extra: Partial<PageNode> = {}): PageNode {
  return { ...keyed(key), tag: "button", attrs: { type: "button" }, text, style, ...extra };
}

function stars(rating: number): PageNode {
  return {
    tag: "p",
    role: "img",
    attrs: { "aria-label": `Rated ${rating} out of 5` },
    text: `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`,
    style: MUTED_STYLE,
  };
}

/** The decorative product tile: an `aria-hidden` box around an svg that has `role="presentation"`. */
function tile(): PageNode {
  return { tag: "div", children: [{ tag: "svg", role: "presentation", box: { width: 64, height: 64 } }] };
}

function summaryList(key: string | undefined, rows: ReadonlyArray<readonly [string, string]>): PageNode {
  return {
    ...keyed(key),
    tag: "dl",
    children: rows.map(([label, amount]) => ({
      tag: "div",
      children: [
        { tag: "dt", text: label },
        { tag: "dd", text: amount },
      ],
    })),
  };
}

function dialogClose(key: string, text: string, style: CSSProperties, box?: PageNode["box"]): PageNode {
  return {
    key,
    tag: "button",
    attrs: { type: "button", "aria-label": "Close" },
    text,
    style: { ...inline(style), position: "absolute" },
    ...(box === undefined ? {} : { box }),
  };
}

/** A checkbox or radio in a label with a text span, as the cart rows render them. */
function choiceRow(
  slug: string,
  kind: "checkbox" | "radio",
  label: string,
  checked: boolean,
  group?: string,
): PageNode {
  return {
    key: `${slug}-label`,
    tag: "label",
    children: [
      {
        key: `${slug}-input`,
        tag: "input",
        attrs: group === undefined ? { type: kind } : { type: kind, name: group },
        checked,
        style: CHECK_STYLE,
      },
      { key: `${slug}-text`, tag: "span", text: label },
    ],
  };
}

// ── The shell ──────────────────────────────────────────────────────────────

const NAV: ReadonlyArray<readonly [string, string]> = [
  ["Home", "/boo-tique"],
  ["Cart", "/boo-tique/cart"],
  ["Checkout", "/boo-tique/checkout"],
  ["Club", "/boo-tique/club"],
  ["Account", "/boo-tique/account/subscription"],
];

/** The `<body>` node: the shop shell around the page content. */
function shell(content: readonly PageNode[]): PageNode {
  return {
    tag: "body",
    children: [
      {
        tag: "div",
        style: { color: PALETTE.ink, fontSize: "16px", backgroundColor: PALETTE.bg },
        children: [
          {
            tag: "div",
            text: "Demo shop, nothing is for sale",
            style: { backgroundColor: PALETTE.bloodDark, color: WHITE, fontSize: "14px", padding: "8px 16px" },
          },
          {
            tag: "header",
            children: [
              { tag: "a", attrs: { href: "/boo-tique" }, text: "The Boo-tique", style: LINK_STYLE },
              {
                tag: "nav",
                attrs: { "aria-label": "Shop" },
                children: NAV.map(([label, href]) => ({ tag: "a", attrs: { href }, text: label, style: LINK_STYLE })),
              },
            ],
          },
          { tag: "main", children: content },
          {
            tag: "footer",
            text: "The Boo-tique is a fictional shop. It has no real products, orders or payments.",
            style: { fontSize: "14px", color: PALETTE.muted },
          },
        ],
      },
    ],
  };
}

// ── Home ───────────────────────────────────────────────────────────────────

type BannerVariant = "default" | "ghost" | "equal";

function hero(heroTime: string | null): PageNode {
  const promo: PageNode[] =
    heroTime === null
      ? []
      : [
          {
            tag: "div",
            children: [
              para(`Boo-nanza ends in ${heroTime}`, "hero-countdown", PROMO_STYLE),
              para("Black Friday of the Dead ends at midnight", "rolling-midnight", PROMO_STYLE),
              para("Winter sale ends 28 Feb 2027, 23:59 UTC", "fixed-date-sale", PROMO_STYLE),
            ],
          },
        ];
  return {
    tag: "section",
    style: { backgroundColor: PALETTE.blood, color: WHITE },
    children: [
      { tag: "h1", text: "The Boo-tique", style: { ...H1_STYLE, color: WHITE } },
      para("Gothic goods for living ghouls", undefined, { fontSize: "18px", color: PALETTE.paper }),
      ...promo,
    ],
  };
}

function productCard(product: Product): PageNode {
  const name = heading("h3", product.name);
  return {
    tag: "li",
    children: [
      tile(),
      product.href === null ? name : { tag: "a", attrs: { href: product.href }, style: LINK_STYLE, children: [name] },
      para(formatUsd(product.priceUsd * 100)),
      stars(product.rating),
    ],
  };
}

function productGrid(): PageNode {
  return {
    tag: "section",
    children: [heading("h2", "Shop the crypt"), { tag: "ul", children: PRODUCTS.map(productCard) }],
  };
}

function bannerActions(variant: BannerVariant): PageNode[] {
  if (variant === "default") {
    return [
      {
        key: "cookie-options",
        tag: "a",
        attrs: { href: "#cookie-options" },
        text: "options",
        style: inline(OPTIONS_LINK_STYLE),
      },
      button("cookie-accept", "Accept all", inline(ACCEPT_ALL_STYLE)),
    ];
  }
  if (variant === "ghost") {
    return [
      button("cookie-accept", "Accept all", inline(GHOST_ACCEPT_STYLE)),
      button("cookie-reject", "Reject", inline(GHOST_REJECT_STYLE)),
    ];
  }
  return [
    button("cookie-accept", "Accept all", inline(EQUAL_BUTTON_STYLE)),
    button("cookie-reject", "Reject all", inline(EQUAL_BUTTON_STYLE)),
  ];
}

function cookieBanner(variant: BannerVariant): PageNode {
  return {
    key: "cookie-banner",
    tag: "div",
    role: "region",
    attrs: { "aria-label": "Cookie preferences" },
    style: { ...FIXED_PANEL_STYLE, padding: "8px 16px" },
    box: { width: 1280, height: 96 },
    children: [
      para("We use cookies to remember your basket and to count visits."),
      { tag: "div", children: bannerActions(variant) },
    ],
  };
}

function exitIntentModal(): PageNode[] {
  const equal = inline(EQUAL_BUTTON_STYLE);
  return [
    { tag: "div" },
    {
      key: "newsletter-dialog",
      tag: "section",
      role: "dialog",
      attrs: { "aria-modal": "true", "aria-label": "Newsletter sign-up" },
      style: { ...FIXED_PANEL_STYLE, padding: "24px" },
      box: { width: 480, height: 320 },
      children: [
        dialogClose("exit-close", "×", DEFAULT_CLOSE_STYLE),
        heading("h2", "Before you go"),
        para("Get the Boo-letter: new curses and candles, once a week."),
        {
          tag: "p",
          children: [
            {
              key: "optin-label",
              tag: "label",
              text: "Send me the Boo-letter",
              children: [{ key: "optin-input", tag: "input", attrs: { type: "checkbox" }, checked: false }],
            },
          ],
        },
        {
          tag: "p",
          children: [
            {
              key: "partners-label",
              tag: "label",
              text: "Share my details with trusted partners",
              children: [{ key: "partners-input", tag: "input", attrs: { type: "checkbox" }, checked: true }],
            },
          ],
        },
        {
          tag: "p",
          children: [
            button("exit-subscribe", "Subscribe", equal),
            button("exit-not-now", "Not now", equal),
          ],
        },
      ],
    },
  ];
}

type HomeOptions = { banner: BannerVariant; modal: "none" | "exit-intent"; heroTime: string };

function homeTree(options: HomeOptions): PageNode {
  const showUrgencyBlock = options.banner === "default" && options.modal === "none";
  const overlay = options.modal === "exit-intent" ? exitIntentModal() : [cookieBanner(options.banner)];
  return shell([hero(showUrgencyBlock ? options.heroTime : null), productGrid(), ...overlay]);
}

// ── Product ────────────────────────────────────────────────────────────────

function upsellModal(): PageNode[] {
  return [
    { tag: "div" },
    {
      key: "upsell-dialog",
      tag: "section",
      role: "dialog",
      attrs: { "aria-modal": "true", "aria-label": "Bundle offer" },
      style: { ...FIXED_PANEL_STYLE, padding: "24px" },
      box: { width: 480, height: 250 },
      children: [
        // The close control renders about 3 x 8 px.
        dialogClose("upsell-close", "x", UPSELL_CLOSE_STYLE, { width: 3, height: 8 }),
        heading("h2", "Complete the set"),
        para("The Crypt Keeper bundle pairs this candle with a matching tote."),
        {
          tag: "p",
          children: [
            button("upsell-add", "Add crypt keeper bundle", inline(UPSELL_ADD_STYLE), {
              box: { width: 432, height: 57 },
            }),
          ],
        },
      ],
    },
  ];
}

function soldToast(): PageNode {
  return {
    key: "sold-toast",
    tag: "div",
    role: "status",
    style: FIXED_PANEL_STYLE,
    box: { width: 320, height: 64 },
    children: [
      { key: "sold-message", tag: "span", text: "Morgan from Ohio just bought the Cursed Candle Set" },
      {
        tag: "button",
        attrs: { type: "button", "aria-label": "Dismiss" },
        text: "×",
        style: QUIET_BUTTON_STYLE,
      },
    ],
  };
}

function productTree(values: PerLoadValues): PageNode {
  const candle = PRODUCTS.find((product) => product.slug === "ghost-pepper-candle");
  if (candle === undefined) throw new Error("The product page needs the Ghost Pepper Candle.");
  return shell([
    {
      tag: "article",
      children: [
        tile(),
        heading("h1", candle.name),
        para(formatUsd(candle.priceUsd * 100)),
        stars(candle.rating),
        para("A smoky, pepper-scented candle in a black glass jar."),
        {
          tag: "div",
          children: [
            para(`Only ${values.stockLeft} left!`, "low-stock"),
            para(`${values.viewers} people are viewing this`, "viewers"),
            {
              tag: "p",
              children: [
                { key: "selling-fast", tag: "span", text: "Selling fast", style: BADGE_STYLE },
                { key: "almost-gone", tag: "span", text: "Almost gone", style: inline(ALMOST_GONE_STYLE) },
              ],
            },
          ],
        },
        {
          tag: "ul",
          attrs: { "aria-label": "Sizes" },
          children: [
            { tag: "li", children: [{ tag: "span", text: "Large jar" }] },
            {
              tag: "li",
              children: [
                { tag: "span", text: "Travel tin" },
                { key: "real-inventory", tag: "span", text: "3 left" },
              ],
            },
          ],
        },
        { tag: "p", children: [button(undefined, "Add to cart", inline(EQUAL_BUTTON_STYLE))] },
      ],
    },
    ...upsellModal(),
    soldToast(),
  ]);
}

// ── Cart ───────────────────────────────────────────────────────────────────

function cartLine(name: string, price: string, key?: string): PageNode {
  return {
    ...keyed(key),
    tag: "li",
    children: [
      { tag: "span", text: name },
      { tag: "span", text: price },
      {
        tag: "button",
        attrs: { type: "button", "aria-label": `Remove ${name}` },
        text: "Remove",
        style: QUIET_BUTTON_STYLE,
      },
    ],
  };
}

function cartTree(): PageNode {
  return shell([
    {
      tag: "section",
      children: [
        heading("h1", "Your cart"),
        {
          tag: "ul",
          children: [
            cartLine("Ghost Pepper Candle", "$18.00"),
            cartLine("Moon-Phase Mug", "$22.00"),
            cartLine("Insurance", "$4.00", "insurance-line"),
          ],
        },
      ],
    },
    {
      tag: "section",
      children: [
        heading("h2", "Extras"),
        {
          tag: "div",
          children: [
            choiceRow("protection", "checkbox", "Add Raven Shipping Protection +$4.99", true),
            choiceRow("gift-wrap", "checkbox", "Gift wrap +$2.00", false),
            {
              tag: "div",
              children: [
                { key: "packaging-text", tag: "span", text: "Priority coffin packaging +$2.50" },
                {
                  key: "packaging-switch",
                  tag: "button",
                  role: "switch",
                  attrs: {
                    type: "button",
                    "aria-checked": "true",
                    "aria-labelledby": "bt-cart-packaging-label",
                  },
                  style: TOGGLE_ON_STYLE,
                  children: [{ tag: "span" }],
                },
              ],
            },
          ],
        },
        {
          tag: "fieldset",
          children: [
            { tag: "legend", text: "Warranty" },
            choiceRow("warranty-none", "radio", "No warranty $0.00", false, "warranty"),
            choiceRow("warranty-silver", "radio", "Silver Curse Warranty +$3.00", false, "warranty"),
            choiceRow("warranty-gold", "radio", "Gold Extended Curse Warranty +$9.00", true, "warranty"),
          ],
        },
        {
          tag: "fieldset",
          children: [
            { tag: "legend", text: "Shipping" },
            choiceRow("shipping-standard", "radio", "Standard coffin post $4.00", true, "shipping"),
            choiceRow("shipping-express", "radio", "Express bat post $9.00", false, "shipping"),
            choiceRow("shipping-overnight", "radio", "Overnight spirit post $15.00", false, "shipping"),
          ],
        },
      ],
    },
    {
      tag: "section",
      children: [
        heading("h2", "Summary"),
        summaryList("cart-summary", [
          ["Items", "$40.00"],
          ["Extras", "$16.49"],
          ["Shipping", "$4.00"],
          ["Insurance", "$4.00"],
          ["Estimated tax", "$3.20"],
          ["Total", "$67.69"],
        ]),
        {
          tag: "p",
          children: [{ tag: "a", attrs: { href: "/boo-tique/checkout" }, text: "Checkout", style: BUTTON_STYLE }],
        },
      ],
    },
  ]);
}

// ── Checkout ───────────────────────────────────────────────────────────────

function checkoutTree(flow: "default" | "honest"): PageNode {
  const common: ReadonlyArray<readonly [string, string]> = [
    ["Items", "$40.00"],
    ["Extras", "$16.49"],
    ["Shipping", "$4.00"],
    ["Insurance", "$4.00"],
    ["Tax", "$3.20"],
  ];
  const rows: ReadonlyArray<readonly [string, string]> =
    flow === "default"
      ? [...common, ["Handling", "$6.99"], ["Haunting fee", "$3.00"], ["Total", "$77.68"]]
      : [...common, ["Total", "$67.69"]];
  const updates: PageNode[] =
    flow === "default"
      ? [
          {
            tag: "section",
            attrs: { "aria-label": "Updates" },
            children: [
              {
                key: "newsletter-label",
                tag: "label",
                children: [
                  { key: "newsletter-input", tag: "input", attrs: { type: "checkbox" }, checked: true },
                  { key: "newsletter-text", tag: "span", text: "Send me the Boo-letter" },
                ],
              },
            ],
          },
        ]
      : [];
  return shell([
    heading("h1", "Checkout"),
    {
      tag: "section",
      children: [
        heading("h2", "Order summary"),
        summaryList(flow === "default" ? "summary-default" : "summary-honest", rows),
      ],
    },
    ...updates,
    button(undefined, "Place order", DISABLED_BUTTON_STYLE, { attrs: { type: "button", disabled: "" } }),
  ]);
}

// ── Club ───────────────────────────────────────────────────────────────────

type Offer = {
  readonly slug: string;
  readonly heading: string;
  readonly body: string;
  readonly accept: string;
  readonly decline: string;
  readonly declineKey: string;
};

const OFFERS: readonly Offer[] = [
  {
    slug: "discount",
    heading: "Club welcome offer",
    body: "Join the Midnight Club and take 20% off your first order.",
    accept: "Yes, give me 20% off!",
    decline: "No thanks, I hate saving money",
    declineKey: "hate-saving-decline",
  },
  {
    slug: "shipping",
    heading: "Ghost-post shipping",
    body: "Club members get free ghost-post shipping on every order.",
    accept: "Yes, ship it free",
    decline: "I'll pay full price like a mortal",
    declineKey: "full-price-decline",
  },
  {
    slug: "protection",
    heading: "Raven Shipping Protection",
    body: "Cover your parcel on its way from the crypt to your door.",
    accept: "Add protection",
    decline: "Maybe later, I don't need protection",
    declineKey: "no-need-protection-decline",
  },
  {
    slug: "newsletter",
    heading: "The Boo-letter",
    body: "New curses and candles in your inbox once a week.",
    accept: "Subscribe",
    decline: "No thanks",
    declineKey: "plain-no-thanks-decline",
  },
];

function clubTree(timerText: string): PageNode {
  const equal = inline(EQUAL_BUTTON_STYLE);
  return shell([
    {
      tag: "section",
      children: [heading("h1", "The Midnight Club"), para(timerText, "club-timer")],
    },
    {
      tag: "div",
      children: OFFERS.map((offer) => ({
        tag: "section",
        children: [
          heading("h2", offer.heading),
          para(offer.body),
          {
            tag: "p",
            children: [
              button(`${offer.slug}-accept`, offer.accept, equal),
              button(offer.declineKey, offer.decline, equal),
            ],
          },
        ],
      })),
    },
  ]);
}

// ── Account ────────────────────────────────────────────────────────────────

function accountTree(plan: "default" | "honest"): PageNode {
  if (plan === "honest") {
    return shell([
      heading("h1", "Your membership"),
      {
        key: "plan-honest",
        tag: "section",
        attrs: { "aria-labelledby": "bt-plan-heading" },
        children: [
          heading("h2", "Moonlight Basic, $4.99/month"),
          para("Your current plan."),
          button(undefined, "Cancel plan", BUTTON_STYLE),
        ],
      },
    ]);
  }
  return shell([
    heading("h1", "Your membership"),
    {
      tag: "section",
      children: [heading("h2", "Midnight Club Monthly, $9.99/month"), para("Your current plan.")],
    },
    {
      key: "cancel-section",
      tag: "section",
      attrs: { "aria-labelledby": "bt-cancel-heading" },
      children: [heading("h2", "Cancel membership"), para("To cancel, call us during opening hours.")],
    },
  ]);
}

// ── Variants ───────────────────────────────────────────────────────────────

/** One page variant with its first and reload trees. */
export type PageVariant = {
  readonly id: string;
  /** Route with its query, as in the fixture. */
  readonly route: string;
  readonly scenario: string;
  readonly capturedAt: string;
  readonly reloadAt: string;
  readonly first: PageNode;
  readonly reload: PageNode;
  /** Random draws of the product page for each load (product variants only). */
  readonly draws?: { readonly first: readonly number[]; readonly reload: readonly number[] };
};

function variant(
  id: string,
  route: string,
  scenario: string,
  first: PageNode,
  reload: PageNode = first,
  draws?: PageVariant["draws"],
): PageVariant {
  return {
    id,
    route,
    scenario,
    capturedAt: BASE_TIME,
    reloadAt: RELOAD_TIME,
    first,
    reload,
    ...(draws === undefined ? {} : { draws }),
  };
}

const HOME = "/boo-tique";
const PRODUCT = "/boo-tique/product/ghost-pepper-candle";
const HERO_START = "04:59:59";

/** Differing pair: stock 2 then 6, viewers 14 then 31 (stock values are 2, 4 to 9; viewers 8 to 48). */
const DIFFERING_DRAWS = {
  first: [0, 6.5 / 41],
  reload: [0.5, 23.5 / 41],
} as const;

/** Coinciding pair: the same two draws on both loads. */
const COINCIDING_DRAWS = {
  first: [0, 6.5 / 41],
  reload: [0, 6.5 / 41],
} as const;

function productVariant(id: string, scenario: string, draws: NonNullable<PageVariant["draws"]>): PageVariant {
  return variant(
    id,
    PRODUCT,
    scenario,
    productTree(perLoadValues(sequence(draws.first))),
    productTree(perLoadValues(sequence(draws.reload))),
    draws,
  );
}

/**
 * Every page variant of the evaluation. The first variant of an entry in the entry map is
 * its primary pair; the ids in `SECONDARY_VARIANT_IDS` are the secondary pairs.
 */
export const PAGE_VARIANTS: readonly PageVariant[] = [
  variant(
    "home-default-equal",
    HOME,
    "Hero countdown shows 04:59:59 in both samples (the page had not ticked yet).",
    homeTree({ banner: "default", modal: "none", heroTime: HERO_START }),
  ),
  variant(
    "home-default-increase",
    HOME,
    "Hero countdown shows 04:59:58, then 04:59:59 after the reload (the page had ticked once).",
    homeTree({ banner: "default", modal: "none", heroTime: "04:59:58" }),
    homeTree({ banner: "default", modal: "none", heroTime: HERO_START }),
  ),
  variant(
    "home-ghost",
    `${HOME}?banner=ghost`,
    "Cookie banner with a faded Reject button.",
    homeTree({ banner: "ghost", modal: "none", heroTime: HERO_START }),
  ),
  variant(
    "home-equal-banner",
    `${HOME}?banner=equal`,
    "Cookie banner with equal Accept all and Reject all buttons.",
    homeTree({ banner: "equal", modal: "none", heroTime: HERO_START }),
  ),
  variant(
    "home-exit-intent",
    `${HOME}?modal=exit-intent`,
    "Exit-intent newsletter dialog with a ticked partners box.",
    homeTree({ banner: "default", modal: "exit-intent", heroTime: HERO_START }),
  ),
  productVariant(
    "product-differing",
    "Stock 2 then 6 and viewers 14 then 31 across the reload.",
    DIFFERING_DRAWS,
  ),
  productVariant(
    "product-coinciding",
    "Stock and viewers draw the same numbers in both loads.",
    COINCIDING_DRAWS,
  ),
  variant("cart", "/boo-tique/cart", "Cart with the preselected extras.", cartTree()),
  variant("checkout-default", "/boo-tique/checkout", "Checkout with the fee rows and a ticked newsletter box.", checkoutTree("default")),
  variant("checkout-honest", "/boo-tique/checkout?flow=honest", "Checkout whose figures equal the cart.", checkoutTree("honest")),
  variant(
    "club",
    "/boo-tique/club",
    "Club timer shows 09:59, then 09:50 after the reload (same-session storage keeps counting).",
    clubTree("Join in 09:59 for 20% off"),
    clubTree("Join in 09:50 for 20% off"),
  ),
  variant("account-default", "/boo-tique/account/subscription", "Membership page with the call-us cancel text.", accountTree("default")),
  variant("account-honest", "/boo-tique/account/subscription?plan=honest", "Plan with a one-click cancel button.", accountTree("honest")),
];

/** The pairs that are not the primary ones: the "increase" hero pair and the coinciding product pair. */
export const SECONDARY_VARIANT_IDS: readonly string[] = ["home-default-increase", "product-coinciding"];

/** A variant by id. Throws on an unknown id. */
export function variantById(id: string): PageVariant {
  const found = PAGE_VARIANTS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Unknown page variant "${id}".`);
  return found;
}

export type BuiltVariant = {
  /** The first sample with the light reload sample as `afterReload`. */
  readonly snapshot: PageSnapshot;
  /** Node key to synthetic id of the first sample. Not part of the snapshot. */
  readonly keyToId: ReadonlyMap<string, string>;
};

/** Builds the snapshot of a variant: the full first sample plus the light reload sample. */
export function buildVariantSnapshot(page: PageVariant): BuiltVariant {
  const url = `${ORIGIN}${page.route}`;
  const first = buildSnapshot(page.first, { capturedAt: page.capturedAt, url });
  const reload = buildSnapshot(page.reload, { capturedAt: page.reloadAt, url });
  const snapshot = PageSnapshotSchema.parse({
    ...first.snapshot,
    afterReload: toLightSample(reload.snapshot, page.reloadAt),
  });
  return { snapshot, keyToId: first.keyToId };
}
