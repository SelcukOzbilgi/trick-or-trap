# Design: Boo-tique Polish

This design fixes the 16 review findings listed in `requirements.md`. It changes the existing code in place. It does not restructure the shop. Facts below were read from the current code under `app/boo-tique/`, `components/boo-tique/`, `lib/boo-tique/` and `tests/boo-tique/`.

## Architecture and module boundaries

The directory layout and the dependency direction of the old spec hold: `app/boo-tique` imports `components/boo-tique` and `lib/boo-tique`; `components/boo-tique` imports `lib/boo-tique`; nothing outside `lib/boo-tique/ground-truth.ts` imports the fixture or the ground-truth schema. No new dependency, no `next/link`, `next/image`, `next/navigation` or `next/font` outside `app/boo-tique/layout.tsx`.

| Path | Change | Task |
|---|---|---|
| `lib/boo-tique/content.ts` | edit: `FIXED_SALE_TEXT`, new `DEMO_VALID_UNTIL`; later `NAV_LINKS` gets Checkout, new `PRODUCT_ICONS` | 1, 5 |
| `lib/boo-tique/cart.ts` | new: the shared price, line and total source (see below) | 4 |
| `lib/boo-tique/per-load.ts` | edit: `STOCK_VALUES` without 3 | 4 |
| `lib/boo-tique/overlay.ts` | edit: `EXIT_CONFIRM_DELAY_MS`, `EXIT_CONFIRM_TEXT`, `dialogClickAction` | 6 |
| `lib/boo-tique/ground-truth.ts` | edit: `DETECTION_SIGNALS`, two new required entry fields, one refinement | 3 |
| `lib/boo-tique/styles.ts` | not edited (the planted inline styles stay as they are) | none |
| `app/boo-tique/boo-tique.css` | edit: new rules and one media block (exact listing below) | 4 |
| `app/boo-tique/page.tsx` | edit: hero band, promo block | 5 |
| `app/boo-tique/cart/page.tsx` | edit: lines, summary, Checkout link, no `Phase2Preview` | 7 |
| `app/boo-tique/checkout/page.tsx` | edit: `bt-button` on Place order | 8 |
| `components/boo-tique/product-grid.tsx` | edit: `Tile({ slug })`, `Stars` role, `formatUsd`, `PALETTE` | 5 |
| `components/boo-tique/product-page.tsx` | edit: `Tile` slug, `formatUsd` instead of the local `formatPrice` | 5 |
| `components/boo-tique/cookie-banner.tsx` | edit: `.bt-banner-actions` wrapper | 6 |
| `components/boo-tique/overlay-dialog.tsx` | edit: `data-bt-close` handling, confirm state, `PALETTE.ink` | 6 |
| `components/boo-tique/exit-intent-modal.tsx` | edit: markers on the two buttons, `confirmText` prop | 6 |
| `components/boo-tique/cart-addons.tsx` | edit: render from `CART_OPTIONS`, `.bt-choice-row`, `ToggleSwitch` | 7 |
| `components/boo-tique/toggle-switch.tsx` | new, `"use client"` (the sixth client component) | 7 |
| `components/boo-tique/summary-list.tsx` | new, server component: the `<dl>` of summary rows | 7 |
| `components/boo-tique/order-summary.tsx` | edit: both variants from `summaryRows` | 8 |
| `components/boo-tique/account-plans.tsx` | edit: neutral cancel section, `ACCOUNT_PLANS`, `bt-button` | 9 |
| `components/boo-tique/sold-toast.tsx` | edit: dismiss button classes | 9 |
| `components/boo-tique/phase2-preview.tsx` | **delete** (its label and anchor must not come back) | 9 |
| `tests/fixtures/boo-tique-ground-truth.json`, `docs/research/boo-tique-ground-truth.json` | edit: two `element` texts; fixture also gets the two new fields | 1, 3 |
| `docs/research/dark-patterns.md`, `.kiro/specs/boo-tique-static/requirements.md`, `.kiro/specs/boo-tique-static/design.md` | one line or row each (the date) | 2 |

`.kiro/specs/foundation/`, `.kiro/specs/foundation-fixes/`, `.kiro/specs/page-capture/`, `.github/`, `.githooks/`, `scripts/`, `SECURITY.md`, `.kiro/agents/` and every `.env*` file are not touched.

### Edit authority over `docs/research/` and the old spec

The owner authorises exactly these edits, and no other:

1. `docs/research/boo-tique-ground-truth.json`: the `element` text of `home-fixed-date-sale` (task 1) and of `product-selling-fast-badge` (task 3). No other entry and no other field.
2. `docs/research/dark-patterns.md`: the one table row that quotes the old date (task 2). The row `"Selling fast" badge on all products, no number` stays. It now differs from the JSON text, which is accepted: that file is research notes.
3. `.kiro/specs/boo-tique-static/requirements.md`: the one line of criterion 8.4 (task 2).
4. `.kiro/specs/boo-tique-static/design.md`: the one row of the per-entry placement table for `home-fixed-date-sale` (task 2).

The `element` text of the three phase-2 flag entries in the research JSON ("Step 1 total $40; step 3 adds 'handling $6.99' and 'haunting fee $3'" and so on) describes the later flow and is not edited. The derivation test keeps comparing it.

## Key data types and interfaces

### Shared price source (`lib/boo-tique/cart.ts`)

All amounts are integer cents. `PRODUCTS` stays in `content.ts` with `priceUsd` in whole dollars.

```ts
import { PRODUCTS } from "./content";

/** "$18.00". Integer cents only. -250 gives "-$2.50". A non-integer throws RangeError. */
export function formatUsd(cents: number): string;

export type CartOption = { readonly id: string; readonly name: string; readonly cents: number };

export const CART_OPTIONS: {
  readonly protection: CartOption;               // id "protection", "Add Raven Shipping Protection", 499
  readonly giftWrap: CartOption;                 // id "gift-wrap", "Gift wrap", 200
  readonly packaging: CartOption;                // id "packaging", "Priority coffin packaging", 250
  readonly warranty: readonly CartOption[];      // "warranty-none" 0, "warranty-silver" 300, "warranty-gold" 900
  readonly shipping: readonly CartOption[];      // "shipping-standard" 400, "shipping-express" 900, "shipping-overnight" 1500
};
// Names: "No warranty", "Silver Curse Warranty", "Gold Extended Curse Warranty",
//        "Standard coffin post", "Express bat post", "Overnight spirit post".

export const INSURANCE: CartOption;              // id "insurance", "Insurance", 400
export const DRIP_FEES: { readonly handling: CartOption; readonly haunting: CartOption };
// handling: id "handling", "Handling", 699. haunting: id "haunting", "Haunting fee", 300.
export const TAX_RATE_PERCENT = 8;

export const CART: {
  readonly lines: readonly CartOption[];         // from PRODUCTS: ghost-pepper-candle 1800, moon-phase-mug 2200
  readonly extras: readonly CartOption[];        // protection, warranty-gold, packaging (the preselected extras)
  readonly shipping: CartOption;                 // shipping-standard
  readonly insurance: CartOption;                // INSURANCE
};

export const ACCOUNT_PLANS: {
  readonly club: { readonly name: string; readonly cents: number };   // "Midnight Club Monthly", 999
  readonly basic: { readonly name: string; readonly cents: number };  // "Moonlight Basic", 499
};

export function addOnLabel(option: CartOption): string; // "Gift wrap +$2.00"; cents 0 gives "No warranty $0.00"
export function plainLabel(option: CartOption): string; // "Standard coffin post $4.00"
export function taxCents(itemsCents: number): number;   // Math.round(itemsCents * 8 / 100); 4000 gives 320

export type SummaryKey =
  "items" | "extras" | "shipping" | "insurance" | "tax" | "handling" | "haunting" | "total";
export type SummaryRow = { readonly key: SummaryKey; readonly label: string; readonly cents: number };
export type SummaryView = "cart" | "checkout-honest" | "checkout-default";
export function summaryRows(view: SummaryView): readonly SummaryRow[];

export type Totals = {
  readonly itemsCents: number; readonly extrasCents: number; readonly shippingCents: number;
  readonly insuranceCents: number; readonly taxCents: number; readonly feesCents: number;
  readonly totalCents: number;
};
export function cartTotals(): Totals;                          // feesCents 0
export function checkoutTotals(variant: "honest" | "default"): Totals; // default adds feesCents 999
```

`summaryRows` is built from `cartTotals()` and `checkoutTotals()`, so a row cannot disagree with a total. A view throws on an unknown name (TypeScript prevents it).

The pinned numbers, all derived from the constants:

| Row | Cart | Honest checkout | Default checkout |
|---|---|---|---|
| Items | $40.00 | $40.00 | $40.00 |
| Extras (4.99 + 9.00 + 2.50) | $16.49 | $16.49 | $16.49 |
| Shipping | $4.00 | $4.00 | $4.00 |
| Insurance | $4.00 | $4.00 | $4.00 |
| Tax label | "Estimated tax" | "Tax" | "Tax" |
| Tax (8% of $40.00 only) | $3.20 | $3.20 | $3.20 |
| Handling | none | none | $6.99 |
| Haunting fee | none | none | $3.00 |
| Total | **$67.69** | **$67.69** | **$77.68** |

Check: 4000 + 1649 + 400 + 400 + 320 = 6769. Default adds 699 + 300 = 999, giving 7768.

Why tax applies to the items total only: it keeps the old figure "$3.20", makes the rule one line, and shows that the two checkout views differ only by the planted fees, because fees and extras are untaxed.

Why the sneaked insurance row is inside the total: the row is a line in the cart, so a cart that shows a total without it would disagree with its own lines. This is the M4 repair.

### Per-load values (`lib/boo-tique/per-load.ts`)

```ts
import { INVENTORY } from "./content";
export const STOCK_VALUES: readonly number[]; // the integers 2..9 without INVENTORY["travel-tin"] = 3 -> [2,4,5,6,7,8,9]
// stockLeft = STOCK_VALUES[pick(random, STOCK_VALUES.length)]   // pick = existing clamp, floor(draw * span)
// viewers   = 8 + pick(random, 41)                              // unchanged, 8..48
```

The fake stock can never equal the honest twin's real 3. Two independent loads still match with probability 1/7, so detectors need at least 3 samples (noted in the fixture).

### Overlay helpers (`lib/boo-tique/overlay.ts`)

```ts
export const EXIT_CONFIRM_DELAY_MS = 1500;
export const EXIT_CONFIRM_TEXT = "Demo shop: nothing was sent";

export type ClosestTarget = { closest(selector: string): unknown } | null;
export type DialogClickAction = "ignore" | "close" | "confirm-then-close";

/** closest("[data-bt-confirm]") non-null -> "confirm-then-close"; else closest("[data-bt-close]") non-null -> "close"; else "ignore". */
export function dialogClickAction(target: ClosestTarget): DialogClickAction;
```

`nextFocusIndex` and `shouldCloseOnKey` stay as they are.

`OverlayDialog` gets an optional `confirmText?: string` prop and a click handler on the dialog `<section>`:

```
onClick(event):
  action = dialogClickAction(event.target instanceof Element ? event.target : null)
  "ignore"             -> nothing
  "close"              -> close()                       // same close() as Escape and the × button
  "confirm-then-close" -> if confirmText is set: setConfirming(true); else close()
effect while confirming: id = setTimeout(close, EXIT_CONFIRM_DELAY_MS); cleanup clears it
render while confirming: the children are replaced by <p role="status" data-testid="bt-dialog-confirm">{confirmText}</p>;
                         the "×" close button and the backdrop stay
```

The first render (server and client) is unchanged, so there is no hydration mismatch. The confirmation text exists only after a click, so it is not in the server markup (6.8). Nothing is stored or sent. The upsell passes no `confirmText` and its buttons carry no marker, so it behaves as before. `ExitIntentModal` passes `confirmText={EXIT_CONFIRM_TEXT}`; it stays a server component because the prop is a string.

### Ground-truth schema (`lib/boo-tique/ground-truth.ts`)

```ts
export const DETECTION_SIGNALS =
  ["text", "attribute", "style", "reload-variance", "timing", "cross-page", "not-static"] as const;
export const DetectionSignalSchema = z.enum(DETECTION_SIGNALS);

// added to the object of GroundTruthEntrySchema:
detectionSignals: z.array(DetectionSignalSchema).min(1) // plus: values must be unique
detectionNote: z.string().trim().min(20)

// added refinement, "not scored" rule:
//   signals include "not-static"  <=>  signals equal ["not-static"]  <=>  note starts with "Not scored:"
```

`GroundTruthEntry` gains the two fields through `z.infer`. The research JSON does not get them. The existing derivation test already compares field by field, not whole objects, so it stays valid. Task 3 adds the checks of 12.7: the research file has neither key, the fixture keys minus the two new keys equal the research keys, and a mutated copy of one entry fails the comparison (so the test still catches drift).

### Content additions (`lib/boo-tique/content.ts`)

```ts
export const FIXED_SALE_TEXT = "Winter sale ends 28 Feb 2027, 23:59 UTC";
/** Last day the demo's honest fixed-date sale is guaranteed to lie in the future. Build-time constant, never compared to the clock. */
export const DEMO_VALID_UNTIL = "2027-01-31";

export type ProductIcon = "candle" | "hoodie" | "mug" | "tote" | "quill";
export const PRODUCT_ICONS: Readonly<Record<string, ProductIcon>>; // by slug:
//   cursed-candle-set candle, phantom-hoodie hoodie, moon-phase-mug mug,
//   crypt-keeper-tote tote, raven-feather-quill-pen quill, ghost-pepper-candle candle

// NAV_LINKS order: Home, Cart, Checkout, Club, Account.
```

The guard test (`tests/boo-tique/content.test.ts`) parses `FIXED_SALE_TEXT` with `/^Winter sale ends (\d{1,2}) ([A-Z][a-z]{2}) (\d{4}), 23:59 UTC$/`, maps the month with a table (Jan to Dec), builds an ISO string `YYYY-MM-DD` and compares it with `DEMO_VALID_UNTIL` as strings (both zero-padded). A text that does not match fails the test. The date 2027-02-28 is later than 2027-01-31. A future edit that moves the sale into the past, or to a date on or before the constant, fails.

## Decisions

### The phase-2 flag elements become ordinary shop UI

Old criteria 13.1 to 13.5 put a label and `data-anchor="phase-2"` on exactly the three flag entries. An LLM judge or a DOM detector could learn "labelled preview means flag". The fix renders the end state of each trick with the same tags and classes as the neighbouring honest elements.

| Entry | Element | Honest neighbour it must match |
|---|---|---|
| `cart-insurance-sneaked` | third `<li class="bt-line-row">` of the cart lines list | the two product-line `<li class="bt-line-row">` |
| `checkout-handling-fees-drip` | the order-summary `<dl class="bt-list">` of the default view | the order-summary `<dl class="bt-list">` of the honest view |
| `account-cancel-five-screens` | `<section class="bt-card" aria-labelledby="bt-cancel-heading">` | the plan `<section class="bt-card" aria-labelledby="bt-plan-heading">` |

Two consequences:

- **Remove buttons on all three cart lines.** An insurance row with a Remove button while the two product lines had none would differ in kind. So every cart line gets the same inert `Remove` button. All three are plain `type="button"` with no handler.
- **The checkout entry element is the whole summary `<dl>`.** The two fee rows are ordinary rows inside it, so the carrying element is the same kind in both variants. For `checkout-consistent-shipping-tax` the carrying element is the honest `<dl>`.

Static scanning is not expected to prove these three entries. The fixture notes (12.4, 12.5) say "Not scored:". The two honest phase-2 entries, `checkout-consistent-shipping-tax` and `account-one-click-cancel-plan`, stay scored as no-flag precision checks: a static detector must return zero findings on them. This reads decision 4's sentence "phase-2 entries are not scored" as applying to the three flag entries, which matches decision 8b.

The class and id vocabulary rule (3.13) keeps pattern words out of attributes. The earlier name `bt-urgency` is therefore not used; the home block is `bt-promo`.

### One source of numbers for cart and checkout

The cart page, the extras card, `SummaryList` and `OrderSummary` read `lib/boo-tique/cart.ts` and call `formatUsd`. No page or component writes a `$` followed by a digit (7.13). Honest checkout rows equal cart rows except the tax label ("Estimated tax" in a cart, "Tax" at checkout). Default checkout inserts the two fee rows before the total. The newsletter section stays in the default checkout only.

### Hero, promo block and the same-size rule

The hero is a blood-red band with white text. `ProductGrid` and the cookie banner sit outside it. The promo block holds the three urgency lines in one `<div class="bt-promo">`, styled by a single descendant rule `.bt-hero .bt-promo p`. `HeroCountdown` is not edited: it already returns a `<p>`, so the descendant rule styles it identically to the two plain `<p>` lines. The three lines share size (28px), weight (600) and colour (white). Nothing visual separates the honest fixed-date line from the two fake lines except its wording, which is the point.

### Phone layout instead of a clipped bar

At or below 640px the banner wraps, its paragraph takes the full row at 14px, the buttons sit together in `.bt-banner-actions` below it, and the page bottom padding grows to 176px so a taller banner cannot cover the last content line. The inline styles of the buttons are not touched. Arithmetic: at 390px the content width is 390 - 2 x 16 = 358px; the two equal buttons need 2 x 160 + 8 = 328px, so both fit side by side. Height budget: at most 96px at 641px and up (the base `max-height: 96px` stays), at most 160px below (the paragraph is two lines at 14px and the buttons are 56px high, about 130px). The 160px figure is a budget checked by the later capture spec, not by this spec.

### Element order in a media-block-aware stylesheet test

`tests/boo-tique/styles.test.ts` parses rules with a regex that has no notion of `@media`. A nested rule inside a media block would be merged into the base rule of the same selector by `declsFor`, and `.bt-banner` would appear to have `max-height: none`. Task 4 adds a small helper first: `splitMedia(css)` walks the text with a brace counter, returns the base text (media blocks removed) and a list of `{ query, css }` blocks, and the existing tests keep reading the base rules. New tests read the single media block.

The stylesheet must contain no word `body` and no word `html` anywhere, even in a comment, because the existing test matches `\bbody\b` on the comment-stripped text, and 14.1 adds `html`. The new CSS comments avoid both words.

## Stylesheet (exact additions)

Everything is in `app/boo-tique/boo-tique.css`, scoped by `.bt-` classes. The listing is the source of truth for the stylesheet tests. Existing rules not shown stay as they are. File order matters where noted.

```css
/* Added to the existing .bt-root rule */
.bt-root { accent-color: var(--bt-blood); overflow-wrap: break-word; }

/* Type scale. After the existing combined heading rule, which keeps font-family, colour and margin. */
.bt-root h1 { font-size: 40px; font-weight: 700; line-height: 1.1; }
.bt-root h2 { font-size: 28px; font-weight: 600; line-height: 1.2; }
.bt-root h3 { font-size: 20px; font-weight: 600; line-height: 1.25; }

/* Hero. Descendant selectors win over .bt-root p and .bt-root h1 by specificity. */
.bt-hero { width: 100%; padding: 32px; border-radius: 12px; background: var(--bt-blood); color: #ffffff; }
.bt-hero h1 { margin: 0 0 8px; color: #ffffff; }
.bt-hero .bt-hero-tagline { margin: 0; font-size: 18px; color: var(--bt-paper); }
.bt-hero .bt-promo { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.bt-hero .bt-promo p { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.2; }

/* Grid and cards (replaces repeat(3, 1fr)) */
.bt-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }   /* edit the existing declaration */
.bt-card { min-width: 0; }                                        /* add to the existing rule */

/* Product tiles: five gradients from palette tokens only */
.bt-tile--candle { background: linear-gradient(135deg, color-mix(in srgb, var(--bt-blood) 14%, var(--bt-paper)), var(--bt-line)); }
.bt-tile--hoodie { background: linear-gradient(135deg, var(--bt-line), color-mix(in srgb, var(--bt-blood) 22%, var(--bt-paper))); }
.bt-tile--mug    { background: linear-gradient(135deg, var(--bt-paper), var(--bt-line)); }
.bt-tile--tote   { background: linear-gradient(135deg, color-mix(in srgb, var(--bt-ink) 10%, var(--bt-paper)), var(--bt-line)); }
.bt-tile--quill  { background: linear-gradient(135deg, var(--bt-line), var(--bt-paper)); }

/* Rows */
.bt-choice-row { display: flex; align-items: center; justify-content: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid var(--bt-line); border-radius: 8px; }
.bt-choice-row input { flex: none; width: 20px; height: 20px; margin: 0; }
.bt-line-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid var(--bt-line); border-radius: 8px; }

/* Buttons. The .bt-root prefix beats .bt-root a. Modifiers come after the base rule. */
.bt-root .bt-button { display: inline-flex; align-items: center; justify-content: center; padding: 12px 24px; min-height: 44px; border: 2px solid var(--bt-blood); border-radius: 8px; background: var(--bt-blood); color: #ffffff; font-weight: 600; text-decoration: none; cursor: pointer; }
.bt-root .bt-button:hover { background: var(--bt-blood-dark); border-color: var(--bt-blood-dark); }
.bt-root .bt-button:focus-visible { outline: 3px solid var(--bt-ink); outline-offset: 2px; }
.bt-root .bt-button:disabled { background: var(--bt-paper); border-color: var(--bt-muted); color: var(--bt-muted); cursor: not-allowed; }
.bt-root .bt-button--secondary { background: transparent; color: var(--bt-blood); border-color: var(--bt-blood); }
.bt-root .bt-button--secondary:hover { background: var(--bt-paper); }
.bt-root .bt-button--quiet { background: transparent; border-color: transparent; color: var(--bt-blood); padding: 8px 12px; font-weight: 500; }
.bt-root .bt-button--quiet:hover { background: transparent; border-color: transparent; text-decoration: underline; }

/* Banner actions (base) */
.bt-banner-actions { display: flex; gap: 8px; align-items: center; flex: none; }

/* Phone layout. The only media block. */
@media (max-width: 640px) {
  .bt-root { padding-bottom: 176px; }
  .bt-banner { flex-wrap: wrap; max-height: none; }
  .bt-banner p { flex-basis: 100%; font-size: 14px; margin: 0; }
  .bt-banner-actions { flex-wrap: wrap; }
  .bt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

Notes for the stylesheet tests:

- The media block rules come after the base `.bt-banner` and `.bt-root` rules, so they win at 640px and below. `.bt-banner p` sits in the media block only; the base banner paragraph keeps the page paragraph style.
- Specificity check: `.bt-hero .bt-hero-tagline` (0,2,0) beats `.bt-root p` (0,1,1). `.bt-root .bt-button` (0,2,0) beats `.bt-root a` (0,1,1). `.bt-root .bt-button:hover` and `.bt-root .bt-button:disabled` both have specificity (0,3,0). The hover rule also matches a disabled button, so `:disabled` must stay after `:hover` in file order and then wins. The two modifier hover rules (0,3,0) come after the base hover rule so a quiet or secondary button is not repainted blood-dark on hover.
- `#ffffff` is the only literal colour outside the seven token declarations (4.26).
- Contrast (computed with the repo helper, hand check): `#ffffff` on `#8b1a1a` is about 9.3; `#fff9ee` on `#8b1a1a` about 8.9; `#8b1a1a` on `#fff9ee` about 8.8; `#6b5a52` on `#fff9ee` about 6.2.
- No new motion: no transition and no animation, so no `prefers-reduced-motion` rule is needed.

## Markup

React renders `className` as `class`. "Same kind" in the tables means the same tag, the same class string and the same attribute names.

### Home page (`app/boo-tique/page.tsx`)

```
<section class="bt-hero" aria-labelledby="bt-hero-heading">
  <h1 id="bt-hero-heading">The Boo-tique</h1>
  <p class="bt-hero-tagline">Gothic goods for living ghouls</p>
  [default variant only]
  <div class="bt-promo">
    <HeroCountdown/>                                  // <p data-testid="home-hero-countdown-restart">
    <p data-testid="home-rolling-midnight-text">…</p>
    <p data-testid="home-fixed-date-sale">{FIXED_SALE_TEXT}</p>
  </div>
</section>
<ProductGrid/>  <ExitIntentModal/> or <CookieBanner/> as before
```

Product card (`product-grid.tsx`):

```
<li class="bt-card" data-testid="bt-product-card">
  <div class="bt-tile bt-tile--ICON" aria-hidden="true"><svg …/></div>
  <a href=…><h3>Name</h3></a> or <h3>Name</h3>
  <p class="bt-price">$24.00</p>
  <p class="bt-muted" role="img" aria-label="Rated 4 out of 5">★★★★☆</p>
</li>
```

`Tile({ slug })` looks up `PRODUCT_ICONS[slug]` (default `candle` for an unknown slug). Each icon is a 64 by 64 `viewBox` SVG of at most six simple shapes with `fill="currentColor"` and `PALETTE.paper` highlights, `focusable="false"`. There are five icons: candle (rectangle body and a flame path), hoodie (body, hood and pocket shapes), mug (rectangle, handle ring), tote (bag rectangle and a handle arc), quill (a feather path and a nib line). No `<img>`, no `url(`, no external reference.

### Cookie banner (`cookie-banner.tsx`)

```
<div class="bt-banner" role="region" aria-label="Cookie preferences" data-testid=…>
  <p>We use cookies to remember your basket and to count visits.</p>
  <div class="bt-banner-actions"> … controls of the variant, in the order of 2.2 to 2.4 … </div>
</div>
```

All inline `style` values stay exactly as they are. On desktop the paragraph sits left and the actions group sits right (`justify-content: space-between` has two children now), which also fixes the "Accept all" in mid-banner, "Reject all" in the far corner layout of L9.

### Cart page (`app/boo-tique/cart/page.tsx`)

```
<section class="bt-card" aria-labelledby="bt-cart-heading">
  <h1 id="bt-cart-heading">Your cart</h1>
  <ul class="bt-list">
    <li class="bt-line-row"><span>Ghost Pepper Candle</span><span class="bt-price">$18.00</span>
        <button type="button" class="bt-button bt-button--quiet" aria-label="Remove Ghost Pepper Candle">Remove</button></li>
    <li class="bt-line-row"><span>Moon-Phase Mug</span> … $22.00 … Remove</li>
    <li class="bt-line-row" data-testid="cart-insurance-sneaked"><span>Insurance</span><span class="bt-price">$4.00</span>
        <button … aria-label="Remove Insurance">Remove</button></li>
  </ul>
</section>
<CartAddons/>
<section class="bt-card" aria-labelledby="bt-cart-summary-heading">
  <h2 id="bt-cart-summary-heading">Summary</h2>
  <SummaryList rows={summaryRows("cart")} testId="bt-cart-summary"/>
  <p><a class="bt-button" href="/boo-tique/checkout">Checkout</a></p>
</section>
```

`SummaryList` renders `<dl class="bt-list" data-testid={testId}>` and, per row, `<div class="bt-variant-row"><dt>{label}</dt><dd class="bt-price">{formatUsd(cents)}</dd></div>`.

The cart lines list is built from `CART.lines` plus `CART.insurance`, so the names and prices come from the shared source.

### Cart extras (`cart-addons.tsx`)

Rendered from `CART_OPTIONS`. Preselection is derived: a checkbox or radio is `defaultChecked` when its option id is in `CART.extras` or equals `CART.shipping.id`; gift wrap is unchecked. Test ids stay as they are:

| Option id | Control | `data-testid` | Initial state |
|---|---|---|---|
| protection | checkbox | `cart-protection-prechecked` | checked |
| gift-wrap | checkbox | `cart-gift-wrap-unchecked` | unchecked |
| packaging | `ToggleSwitch` | `cart-packaging-switch-on` | on |
| warranty-none | radio `warranty` | `bt-cart-warranty-none` | unchecked |
| warranty-silver | radio `warranty` | `bt-cart-warranty-silver` | unchecked |
| warranty-gold | radio `warranty` | `cart-warranty-radio-preselected` | checked |
| shipping-standard | radio `shipping` | `cart-cheapest-shipping-default` | checked |
| shipping-express | radio `shipping` | `bt-cart-shipping-express` | unchecked |
| shipping-overnight | radio `shipping` | `bt-cart-shipping-overnight` | unchecked |

Each checkbox and radio row is `<label class="bt-choice-row"><input …/><span>{label}</span></label>`; the packaging row is `<div class="bt-choice-row"><span id="bt-cart-packaging-label">{label}</span><ToggleSwitch …/></div>`.

`ToggleSwitch({ labelId, testId, defaultChecked })` (`"use client"`) keeps one `useState(defaultChecked)` and renders the same button as before with `aria-checked={checked}` and `onClick` flipping it. It stores nothing and sends nothing. Server HTML: `aria-checked="true"`. Toggling any add-on does not change a figure (9.8).

### Checkout (`order-summary.tsx`, `app/boo-tique/checkout/page.tsx`)

```
<section class="bt-card" aria-labelledby="bt-checkout-summary-heading">
  <h2 id="bt-checkout-summary-heading">Order summary</h2>
  <SummaryList rows={summaryRows("checkout-honest" | "checkout-default")}
               testId={"checkout-consistent-shipping-tax" | "checkout-handling-fees-drip"}/>
</section>
[default only] the Updates card with checkout-newsletter-prechecked
<button type="button" class="bt-button" disabled>Place order</button>
```

### Account (`account-plans.tsx`)

Default view:

```
<section class="bt-card" aria-labelledby="bt-plan-heading">
  <h2 id="bt-plan-heading">Midnight Club Monthly, $9.99/month</h2><p>Your current plan.</p>
</section>
<section class="bt-card" aria-labelledby="bt-cancel-heading" data-testid="account-cancel-five-screens">
  <h2 id="bt-cancel-heading">Cancel membership</h2>
  <p>To cancel, call us during opening hours.</p>
</section>
```

Honest view: the existing card with `data-testid="account-one-click-cancel-plan"`, `<h2 id="bt-plan-heading">Moonlight Basic, $4.99/month</h2>`, `<p>Your current plan.</p>` and `<button type="button" class="bt-button">Cancel plan</button>`. The button is as visible as any button in the shop: the filled blood style, 44px minimum height, and it is the only button on its card.

## Documented inert controls

These controls do nothing, or only part of a real action, by design. Each one is listed so that a later detector or flow spec does not mistake it for a defect.

| Control | Where | Behaviour | Why |
|---|---|---|---|
| Remove (three lines) | cart | plain `type="button"`, no handler | cart state belongs to the later flows spec |
| Add to cart | product page | no handler (old 10.9) | flows |
| Add crypt keeper bundle | upsell dialog | no handler | nothing is added |
| Accept and decline buttons | club page | no handler (old 9.10) | nothing is submitted |
| Checkbox, radio, switch add-ons | cart | change their own state only; the summary figures stay fixed | fixed demo contents (old 1.6) |
| Place order | checkout | disabled | no payments |
| Cancel plan | honest account | no handler | flows |
| Cookie banner buttons | home | only hide the banner | nothing stored |
| Subscribe | exit-intent modal | confirmation text, then close after 1500 ms | nothing is submitted |

## Detection signals per entry

The fixture gets `detectionSignals` and `detectionNote` for all 30 entries, in the same entry order. The values below are the exact content of the fixture. Notes use plain single quotes inside the JSON strings.

| Entry id | detectionSignals | detectionNote |
|---|---|---|
| home-hero-countdown-restart | text, timing | Server HTML always shows 04:59:59 and the client ticks down from 17999 s. The restart shows on any reload made more than 1 s after the first load. One snapshot gives a text match only. |
| home-rolling-midnight-text | text | Static string. It never rolls inside a snapshot, so a detector separates it from home-fixed-date-sale only by wording ('midnight' with no calendar date). Text only. |
| home-fixed-date-sale | text | Honest twin. A real calendar date, identical on every load and later than DEMO_VALID_UNTIL (2027-01-31). A detector must not flag it. |
| home-cookie-accept-dominant | style, text | Accept all is 20px and weight 700 on a filled button. The 'options' link is 11px #9a9a9a (about 2.7:1 on #fff9ee). No reject control on this layer. |
| home-cookie-ghost-reject | style | Reject is 14px #b3b3b3 (about 2.0:1 on #fff9ee) at opacity 0.6, next to a large filled Accept all. |
| home-cookie-equal-buttons | style | Honest twin. Accept all and Reject all carry identical inline styles. At 390x844 both must lie fully inside the viewport (checked by the later capture spec). |
| product-low-stock-random | text, reload-variance | The value changes per load and is never 3 (it is one of 2, 4, 5, 6, 7, 8, 9). Two loads match with probability 1/7, so a detector needs at least 3 samples. |
| product-viewers-random | text, reload-variance | The value changes per load between 8 and 48. Two loads match with probability 1/41, so use at least 3 samples. |
| product-selling-fast-badge | text | An unquantified 'Selling fast' badge on the product page only, not on the grid. Text only, so low confidence. |
| product-almost-gone-tiny | text, attribute, style | 'Almost gone' at 10px #9a9a9a, also held in a data-stock-label attribute. |
| product-real-inventory-3-left | text, reload-variance | Honest twin. '3 left' comes from a fixed inventory constant and is identical on every load. The per-load stock never equals 3, so values across loads separate the twins. One snapshot separates them only by wording. |
| product-sold-toast | text, timing | A role=status toast. The first message is the same on every load and four messages rotate every 6000 ms, so seeing the rotation needs a wait of at least 6 s. |
| product-upsell-modal-tiny-close | style | The close 'x' is 8px #cfc6bc and renders about 3x8 px (about 1.6:1). The bundle button is 20px, weight 700 and full width. |
| cart-protection-prechecked | attribute | Checkbox with the checked attribute and +$4.99 in its label. |
| cart-warranty-radio-preselected | attribute, text | The Gold radio (+$9.00) is checked while None ($0.00) and Silver (+$3.00) are cheaper. A detector must parse the prices. |
| cart-packaging-switch-on | attribute | A role=switch button with aria-checked=true in the server HTML. A visitor can switch it off; a snapshot sees the initial state. |
| cart-gift-wrap-unchecked | attribute | Honest twin. Optional gift wrap, unchecked. |
| cart-cheapest-shipping-default | attribute, text | Honest twin. The checked radio is the cheapest of three ($4.00). It has the same shape as the warranty entry, so a detector must compare prices. |
| cart-insurance-sneaked | not-static | Not scored: one static snapshot cannot show sneak-into-basket, because the row looks like any other cart row. The later boo-tique-flows spec makes the add-to-cart step real. |
| checkout-newsletter-prechecked | attribute | Checkbox with the checked attribute. |
| checkout-handling-fees-drip | not-static | Not scored: drip pricing needs the cart and the checkout side by side, which one snapshot cannot give. The later boo-tique-flows spec makes it real. |
| checkout-consistent-shipping-tax | text, cross-page | Honest twin. Every row of the summary equals the cart summary. Scored only as no-flag: a static detector must return no finding. The cart comparison is a cross-page signal for the later flows spec. |
| club-modal-hate-saving | text | Confirmshaming wording on the decline button. The decline button has the same style as the accept button. |
| club-modal-full-price-mortal | text | Confirmshaming wording on the decline button. The decline button has the same style as the accept button. |
| club-modal-no-need-protection | text | Confirmshaming wording on the decline button inside a protection upsell card. Same style as the accept button. |
| club-plain-no-thanks | text | Honest twin. A plain 'No thanks' with a style equal to the accept button. |
| club-timer-session-restart | text, timing | The timer lives in sessionStorage. It restarts with the same offer only after 10 minutes, or in a fresh browser context where it starts at 09:59 again. One snapshot gives a text match only. |
| account-cancel-five-screens | not-static | Not scored: the page shows only a call-us sentence, and a cancel maze needs a walk through screens that one snapshot cannot show. The later boo-tique-flows spec makes it real. |
| account-one-click-cancel-plan | text, style | Honest twin. The Cancel plan button has the bt-button class, the same size and weight as the most prominent button on its card, and the card has no retention copy. A salience detector must not flag it. |
| newsletter-partners-prechecked | attribute | The partners checkbox has the checked attribute in the server HTML. The modal's own newsletter checkbox is unchecked. |

The table follows the fixture order, which is the research order. `newsletter-partners-prechecked` is the last of the 30 entries.

## Constraints for the later page-capture, detector and eval specs

These are requirements on specs that are not written yet. This spec records them so they are not rediscovered.

1. **Detectors and judges must not read `data-testid`.** The attribute holds the 30 entry ids. It exists for the project's own tests only. A detector, judge or extractor that used it would read the answer. Requirement 12.11 adds a guard test over `lib/detectors/`, `lib/judge/` and `lib/capture/`.
2. **Phase-2 flag entries are "not scored"** until `boo-tique-flows` makes them real: `cart-insurance-sneaked`, `checkout-handling-fees-drip` and `account-cancel-five-screens`. The two honest phase-2 entries are scored as no-flag.
3. **At 390x844 the capture spec must assert** that both equal-banner buttons ("Accept all" and "Reject all") lie fully inside the 390px viewport, that no element overflows horizontally, and that the banner is at most 160px high (at most 96px at widths from 641px). This spec checks stylesheet text only.
4. **Reload-variance entries need at least 3 samples** (`product-low-stock-random`: match chance 1/7 between two loads; `product-viewers-random`: 1/41).
5. **Time-based entries need a clock plan**: `club-timer-session-restart` restarts only after 10 minutes or in a fresh context; `product-sold-toast` rotates every 6000 ms; `home-hero-countdown-restart` restarts on any reload more than 1 s apart; `home-rolling-midnight-text` never rolls inside a snapshot.
6. **Overscroll** shows the dark root outside `.bt-root` (L4, not fixed by decision 9). A capture spec must not assume the cream colour reaches the viewport edge on overscroll.

## Error handling

- `formatUsd` throws `RangeError` for a non-integer or non-finite input. It is only ever called with integers from the shared source, so no page can throw.
- `dialogClickAction(null)` and an object without a match return `"ignore"`; they never throw.
- `OverlayDialog` with a confirm action but no `confirmText` closes at once instead of showing an empty confirmation. The confirm timer is cleared on unmount and on any earlier close (Escape, ×), so no state update happens after the dialog is gone.
- `Tile` falls back to the candle icon for an unknown slug.
- The schema reports a missing or empty `detectionSignals` or `detectionNote` as a Zod issue with the entry index and field name. The "not scored" refinement names the entry id in its message.
- The date guard fails with a message that shows the text it could not parse, instead of passing or skipping.
- Unknown query values still fall back to the default variant (old 1.12 holds).

## Test strategy

Unit tested without a browser (Vitest, node environment, no JSX, `createElement` only, `renderToStaticMarkup` through `renderRoute`):

| Test file | Covers |
|---|---|
| `tests/boo-tique/content.test.ts` (new, task 1) | `FIXED_SALE_TEXT`, `DEMO_VALID_UNTIL`, the date guard with a month table and an unparseable-text failure case (1.2 to 1.5). Never reads the clock. |
| `tests/boo-tique/spec-sync.test.ts` (new, task 2) | The text of 1.7 and 1.8 in `dark-patterns.md` and the two old-spec files. |
| `tests/boo-tique/ground-truth.test.ts` | New schema fields, the "not scored" refinement, 30 entries with non-empty signals and notes, the three not-static entries, the derivation test (shared fields only, research keys, mutated-copy failure), the two changed `element` texts (12.x, 1.6). |
| `tests/boo-tique/cart.test.ts` (new, task 4) | `formatUsd` table, labels, `taxCents`, rows of the three views with exact cents, sums, honest rows equal cart rows, default minus honest equals the two fees (7.x). |
| `tests/boo-tique/per-load.test.ts` | `STOCK_VALUES`, never 3 over a grid of 10000 draws plus 0.999999, every value seen, fixed draws (11.x). |
| `tests/boo-tique/styles.test.ts` | Media-aware parsing helper; every declaration of the listing above; the single media block; no `body`, `html`, `:root`, `:has(`; colour literals; contrast pairs; the 328 <= 358 arithmetic; file order of button rules (2.x, 4.x, 9.2, 9.3, 14.x). |
| `tests/boo-tique/home-page.test.ts` | New fixed text, hero and promo block, tiles, stars role, card prices, banner wrapper structure and inline styles, `data-bt-close` markup on the modal, no "Selling fast" (1.1, 2.1 to 2.5, 5.x, 6.5, 12.9). |
| `tests/boo-tique/shell.test.ts` | Nav order with Checkout (5.10). |
| `tests/boo-tique/product-page.test.ts` | Tile classes, `formatUsd` price, no `data-bt-*` on the upsell, toast dismiss classes (4.21, 5.11, 6.6). |
| `tests/boo-tique/overlay.test.ts` | `dialogClickAction` with fake `closest` objects, the two constants (6.1 to 6.4); source scan of `overlay-dialog.tsx` and the modal (6.9). |
| `tests/boo-tique/cart-page.test.ts` | Lines, Remove buttons, neutral insurance row (attribute names, no `data-*`), summary text, Checkout link, extras labels, row classes, switch markup, four preselected controls, word rules (3.1 to 3.5, 4.22, 8.1 to 8.4, 8.9, 8.10, 9.x). |
| `tests/boo-tique/checkout-page.test.ts` | Both summaries from `summaryRows`, totals, newsletter only in default, Place order classes, word rules (3.6 to 3.8, 4.19, 8.5 to 8.8, 8.10). |
| `tests/boo-tique/cart-checkout.test.ts` (new, task 8) | Cart rows equal honest rows; default minus honest equals the two fees and 999 cents; every figure equals `formatUsd` of the shared cents (8.5, 8.6, 8.12, 8.13). |
| `tests/boo-tique/account-page.test.ts` | New cancel section markup and sentence, neutral attribute names, Cancel plan class, plan texts, word rules (3.9, 3.10, 4.20, 10.x). |
| `tests/boo-tique/safety.test.ts` | Six `"use client"` files; no label or anchor string on any route; `phase2-preview.tsx` gone; class and id vocabulary; test-id guard over `lib/detectors|judge|capture`; `$`+digit and hex scans; inline-styled controls carry no `bt-button`; visible-text vocabulary (3.11 to 3.13, 4.23, 7.13, 9.7, 12.11, 12.12, 13.x). |
| `tests/boo-tique/coverage.test.ts` | Not edited. Run in task 10 to show 15.1 to 15.3. |

Needs a fixture or a mock: the two JSON files and `docs/research/dark-patterns.md` and the two old-spec files (read with `readFileSync`), a fake `closest` object for `dialogClickAction`, and the injected random sources already used by the product-page tests.

Not tested automatically (out of scope): the confirm timer and the close behaviour in a browser, the real click of the packaging switch, hover and focus rendering, real contrast after opacity, layout at 390x844 and 1280x800, overflow, banner height, overscroll, fonts. The later page-capture spec covers these.

## Risks

- **Specificity.** Preflight and `.bt-root p`, `.bt-root a` and `.bt-root h1` rules can override a single-class selector. Mitigation: the listing uses descendant or `.bt-root`-prefixed selectors where needed, and the stylesheet test reads the exact selector names.
- **Media-block parsing.** A regex parser merges a media rule into its base rule. Mitigation: the `splitMedia` helper in task 4, written test first.
- **The word `body` in CSS comments.** The old test matches `\bbody\b` anywhere. Mitigation: comments avoid it (and `html`).
- **Selector name leaks.** A class like `bt-urgency` would name the pattern in an attribute. Mitigation: 3.13 and the safety test.
- **Hydration.** `ToggleSwitch` and the confirm state start from the server value and change only in handlers and effects. No `Date.now()` or `Math.random()` in render.
- **Lint.** `react-hooks/set-state-in-effect` may flag state changes inside an effect. The confirm timer calls `close` inside a `setTimeout` callback, not synchronously in the effect body. The last task runs `npm run lint` once and fixes at most four source files.
- **`color-mix(`.** It needs a current browser. The planted elements do not depend on it; if a browser lacks it, the tile falls back to the base `.bt-tile` background.
- **Honest phase-2 look-alikes.** The honest checkout now contains an "Insurance" row because it repeats the cart. A detector reading the word "insurance" as a flag would be wrong; the fixture note for `checkout-consistent-shipping-tax` says so.
- **Existing tests that conflict.** Several old assertions contradict the Supersedes table (old fixed-date text, `<ul>` summaries, totals $47.20 and $49.99, preview labels and anchors, five client files, "must call the shop"). Each task updates the old assertions of the test files it lists, test first, and does not weaken any other assertion.
