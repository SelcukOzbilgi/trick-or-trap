# Design: Boo-tique Static Pages

## Architecture and module boundaries

| Area | Path | Role |
|---|---|---|
| Routes | `app/boo-tique/` | `layout.tsx` (fonts, CSS import, metadata) and thin pages. Pages read `searchParams`, pick a variant and return components. |
| Components | `components/boo-tique/` | Synchronous server components, plus five small `"use client"` components (`hero-countdown`, `sold-toast`, `club-timer`, `cookie-banner`, `overlay-dialog`). No `next/font`, `next/link` or `next/navigation`. |
| Pure logic | `lib/boo-tique/` | Palette and style constants, contrast, variants, per-load values, timers, content constants, metadata object, ground-truth schema. |
| Tests | `tests/boo-tique/` | Unit and markup tests, plus `helpers/` (not matched by the Vitest include). |
| Fixture | `tests/fixtures/boo-tique-ground-truth.json` | Canonical copy of the research JSON. Read only by tests. |

Dependency direction: `app/boo-tique` imports `components/boo-tique` and `lib/boo-tique`. `components/boo-tique` imports `lib/boo-tique`. `lib/boo-tique` imports only `lib/types` (and only `ground-truth.ts` does). Nothing under `app/`, `components/` or `lib/` (except `ground-truth.ts`) imports the fixture or the ground-truth schema, so the verdict never reaches the DOM.

### Deviations from `structure.md`

- The sketch uses a route group `app/(boo-tique)/`. A route group adds no URL segment, so its `page.tsx` would resolve to `/` and clash with `app/page.tsx` (the Trick or Trap landing page). This spec uses the real segment `app/boo-tique/`. The last task updates the directory-layout block of `structure.md` to match.
- `/boo-tique/checkout` and `/boo-tique/club` are headline-less pages. They exist only because the ground-truth JSON has entries for them (three `checkout-*` entries and five `club-*` entries). Checkout is one static view with no steps and no payment fields.
- `product.md` says the Boo-tique records live in `docs/research/...`. The tests use the copy in `tests/fixtures/`, which `testing-and-commands.md` already names.

### Dependencies

None are added. `react-dom/server`, `react`, `vitest`, `zod` and `next/font/google` are already installed. If a task seems to need one, it stops and reports.

---

## Key data types and interfaces

### Ground-truth schema (`lib/boo-tique/ground-truth.ts`)

```ts
import { z } from "zod";
import { PatternIdSchema } from "@/lib/types";

export const GROUND_TRUTH_ID_SHAPE =
  /^(home|product|cart|checkout|club|account|newsletter)(-[a-z0-9]+)+$/;

export const GroundTruthPatternSchema = z.union([PatternIdSchema, z.literal("none")]);
export const GroundTruthPageSchema = z.enum(
  ["home", "product", "cart", "checkout", "club", "account", "newsletter-modal"]);

export const GroundTruthEntrySchema = z
  .object({
    id: z.string().regex(GROUND_TRUTH_ID_SHAPE),
    page: GroundTruthPageSchema,
    route: z.string().regex(/^\/boo-tique(?:[/?]|$)/),
    element: z.string().min(1),
    pattern: GroundTruthPatternSchema,
    phase: z.union([z.literal(1), z.literal(2)]),
    difficulty: z.enum(["easy", "medium", "subtle", "lookalike"]),
    expectedVerdict: z.enum(["flag", "no-flag"]),
  })
  .refine((e) => (e.pattern === "none") === (e.expectedVerdict === "no-flag"),
    "pattern none must pair with no-flag, and every other pattern with flag");

export const GroundTruthSchema = z.array(GroundTruthEntrySchema).superRefine(/* unique ids */);

export type GroundTruthEntry = z.infer<typeof GroundTruthEntrySchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
```

`none` is allowed in this schema only. It is not a `PatternId`.

### Id mapping (research JSON to fixture)

| Research `pattern` | Fixture `pattern` |
|---|---|
| `urgency` | `fake-urgency` |
| `scarcity` | `fake-scarcity` |
| `activity` | `fake-activity` |
| `confirmshaming` | `confirmshaming` |
| `preselection` | `preselection` |
| `visual-interference` | `visual-interference` |
| `sneak-into-basket` | `sneak-into-basket` |
| `drip-pricing` | `drip-pricing` |
| `hard-to-cancel` | `hard-to-cancel` |
| `none` | `none` (honest look-alikes, fixture only) |

The mapping lives in the derivation test, not in production code. Route mapping: prefix `/boo-tique` and drop a lone `/` path, so `/` becomes `/boo-tique`, `/?banner=ghost` becomes `/boo-tique?banner=ghost` and `/cart` becomes `/boo-tique/cart`.

### Variant selection (`lib/boo-tique/variants.ts`)

```ts
export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export function pickVariant<T extends string>(
  raw: string | string[] | undefined, allowed: readonly T[], fallback: T): T;
```

Takes the first value of an array. Returns `fallback` for `undefined` or any value not in `allowed`. It never throws.

### Route table and render helper (tests only)

```ts
// tests/boo-tique/helpers/route-table.ts
export type PageProps = { params: Promise<Record<string, string>>; searchParams: Promise<SearchParamsRecord> };
export type PageModule = { default: (props: PageProps) => ReactNode | Promise<ReactNode> };
export type RouteTableEntry = { pattern: string; load: () => Promise<PageModule> };
export const ROUTE_TABLE: readonly RouteTableEntry[] = [ /* one entry per built page */ ];

// tests/boo-tique/helpers/pending-routes.ts
export const PENDING_ROUTES: readonly string[] = [ /* all 11 distinct fixture routes at the start */ ];

// tests/boo-tique/helpers/render-route.ts
export async function renderRoute(
  route: string,
  options?: { table?: readonly RouteTableEntry[]; shell?: boolean }): Promise<string>;
```

`renderRoute` does this: parse `new URL(route, "http://boo-tique.test")`; match the pathname against `pattern` (`[slug]` segments become params); `await entry.load()`; `await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(record) })`; wrap the element in `createElement(BooTiqueShell, null, element)` unless `shell: false`; return `renderToStaticMarkup(...)`. A pathname with no entry throws `Error("No route-table entry for <pathname>")`.

Each page task adds its own `load: () => import("@/app/boo-tique/...")` line and removes the routes it finishes from `PENDING_ROUTES`. A page that does not exist yet has no line, so `tsc` never sees a missing import. The coverage test builds its per-route tests only from fixture routes that are not pending, so no test is ever skipped. A guard test asserts that every distinct fixture route is in exactly one of `PENDING_ROUTES` or the route table; the last task adds the assertion that `PENDING_ROUTES` is empty.

### Markup helpers (`tests/boo-tique/helpers/markup.ts`)

`testIds(markup)` returns every `data-testid` value. `countTestId(markup, id)` counts exact `data-testid="id"` occurrences. `openTag(markup, id)` returns the opening tag of the element that carries the id. `textOf(markup, id)` returns its text with tags removed and HTML entities decoded (React writes `'` as `&#x27;`). `visibleText(markup, { exclude })` returns the text of the whole markup with tags and attributes removed and entities decoded; `exclude` is a list of test ids whose elements (matched by balanced tags of the same name) are cut out first. Word rules such as 13.5 and the brand tripwire use `visibleText`, never a raw markup scan, so attribute values like `data-testid="cart-insurance-sneaked"` are not scanned. `hasAttr(tag, name)` and `attr(tag, name)` read attributes. Attribute order in React output is not relied on.

### Per-load values (`lib/boo-tique/per-load.ts`) and the page factory

```ts
export type PerLoadValues = { stockLeft: number; viewers: number };
export function perLoadValues(random: () => number = Math.random): PerLoadValues;
// stockLeft = 2 + floor(random() * 8)   -> 2..9
// viewers   = 8 + floor(random() * 41)  -> 8..48

// components/boo-tique/product-page.tsx
export function createProductPage(random?: () => number):
  (props: { params: Promise<{ slug: string }> }) => Promise<ReactNode>;
```

`app/boo-tique/product/[slug]/page.tsx` exports `dynamic = "force-dynamic"` and `export default createProductPage()`. The factory lives in `components/boo-tique/`, not in the page file, because Next.js rejects extra named exports from a page file. Tests call `createProductPage(injectedRandom)` and render the result, so no test depends on `Math.random()` or on two real loads differing.

### Overlay helpers (`lib/boo-tique/overlay.ts`)

```ts
export function nextFocusIndex(current: number, count: number, shiftKey: boolean): number; // wraps; count 0 returns -1
export function shouldCloseOnKey(key: string): boolean;                                     // true only for "Escape"
```

### Timers (`lib/boo-tique/countdown.ts`, `lib/boo-tique/club-timer.ts`)

```ts
export const HERO_COUNTDOWN_SECONDS = 17999;            // 04:59:59
export function formatCountdown(totalSeconds: number): string; // "HH:MM:SS", clamped at 00:00:00
export const CLUB_TIMER_SECONDS = 599;                  // 09:59
export const CLUB_TIMER_STORAGE_KEY = "bt-club-timer-end";
export function formatMinutesSeconds(totalSeconds: number): string; // "MM:SS"
export function nextClubTimerState(storedEndMs: number | null, nowMs: number):
  { endMs: number; remainingSeconds: number };
// missing, NaN or past end -> endMs = nowMs + 599_000, remainingSeconds = 599
// future end -> remainingSeconds = ceil((storedEndMs - nowMs) / 1000), endMs unchanged
export const SOLD_TOAST_MESSAGES: readonly string[];   // four fixed messages
export const SOLD_TOAST_INTERVAL_MS = 6000;
export function nextToastIndex(current: number, length: number): number;
```

---

## Decisions

### Layout testing under plain Vitest (node environment)

`next/font/google`, `next/link` and `next/navigation` are not verified to work outside the Next runtime, so the design avoids them in everything the tests import.

- `app/boo-tique/layout.tsx` is a thin file: it imports `next/font/google`, the Boo-tique CSS and `BooTiqueShell`, calls the two font loaders, exports `metadata = booTiqueMetadata` and renders `<BooTiqueShell fontClassName={...}>{children}</BooTiqueShell>`. **Tests never import it.**
- `components/boo-tique/shell.tsx` holds the theme wrapper (`bt-root`), the demo notice, the header and the footer. It takes a `fontClassName` prop and has no font import. Tests render it with `createElement`.
- `lib/boo-tique/metadata.ts` holds the `booTiqueMetadata` object (`robots: { index: false, follow: false }`). The test checks the object. A second test reads `layout.tsx` as text and checks that it exports `metadata` from `booTiqueMetadata`, that it imports `next/font/google`, and that no other module imports `next/font`.
- Rejected: mocking the three next modules with `vi.mock`. It would pass even if the real modules fail to load in Next.
- Components use plain `<a href>` anchors instead of `next/link`, and no hook from `next/navigation`. Pages read `searchParams` as a prop. `notFound()` is not used: an unknown product slug renders an in-page message (HTTP 200, page is `noindex`).

### Per-load randomness: server `force-dynamic`, not client randomisation

A server component that calls `Math.random()` is frozen at build time by static prerendering. Two ways to fix it:

| | `export const dynamic = "force-dynamic"` (chosen) | Randomise in a client component after mount |
|---|---|---|
| Variance in the initial HTML | Yes, every request | No, the HTML is fixed and the number changes later |
| Works with a capture that reads the first paint | Yes | Only after effects run |
| Hydration risk | None: the numbers are plain server markup, no client component receives them | Needs a stable first render to avoid mismatches |
| Cost | The product page is rendered per request | Extra client code |

Chosen: the product page is `force-dynamic` and calls `perLoadValues()` on the server through `createProductPage()`. The numbers go into server components only. Two real loads can show the same numbers; tests therefore use injected random sources and never compare two real loads.

Other per-load behaviour is client-side and starts from a stable server markup:

- `HeroCountdown` renders "Boo-nanza ends in 04:59:59" on the server. After mount it ticks once per second from 17999 s. A reload restarts it. It uses no storage.
- `SoldToast` renders message 0 on the server. After mount it rotates every 6000 ms.
- `ClubTimer` renders "Join in 09:59 for 20% off" on the server. After mount it reads `sessionStorage` (inside `try/catch`), calls `nextClubTimerState`, ticks each second, and when it reaches zero starts a new 599 s period with the same text.

All client components set state only in `useEffect`, never call `Date.now()` or `Math.random()` during render, and build each visible string as one template-literal text node. The home page, checkout and account page read `searchParams`, so Next renders them per request, but their markup holds no randomness.

### Honest look-alikes and the "neutral copy" rules

Precision matters as much as recall. Rules for every page:

1. Outside the 30 listed elements, shop copy has no countdown, deadline, stock claim, viewer count, guilt wording or preselected control.
2. Every accept and decline pair uses one shared style constant (`EQUAL_BUTTON_STYLE`), except the three visual-interference entries. This keeps the club cards and the exit-intent modal from looking like visual interference.
3. The product grid shows name, price and rating only. The design sketch's "was/now" price is dropped, because a struck-through price would be an unlisted pattern.
4. Only the cart's four listed controls are preselected (11.7). The honest checkout has no checked control.
5. Each variant route contains only the entry ids whose route is that route (6.1, 6.2). The default home page has the urgency block and the default banner. The ghost and equal variants have neither the urgency block nor the default banner. The exit-intent variant has no banner and no urgency block.

### Overlays are real overlays

The cookie banner, the exit-intent newsletter modal, the upsell dialog and the sold toast are fixed-position overlays, open in the initial server HTML and dismissible in the browser. Dismissal is client behaviour in small `"use client"` components that render the same markup as the server on first render and set state only in event handlers and effects, so there is no hydration mismatch.

| Overlay | Component | Behaviour |
|---|---|---|
| Cookie banner | `CookieBanner` (client) | Bar fixed to the bottom, full width, height at most 96px. Any banner button hides it. Nothing is stored. |
| Exit-intent modal, upsell dialog | `OverlayDialog` (client) wrapped by `ExitIntentModal` and `UpsellModal` | `role="dialog"`, `aria-modal="true"`, `tabindex="-1"` on the dialog, a sibling backdrop. On mount it focuses the dialog and remembers the previous focus. Tab and Shift+Tab wrap through the focusable children using `nextFocusIndex`. Escape (`shouldCloseOnKey`) and the close button close it and return focus. |
| Sold toast | `SoldToast` (client) | `role="status"`, fixed bottom-left, rotates messages, has a dismiss button. Not modal. |

Placement at 1280x800 (also the stylesheet values in 17.11):

| Overlay | Position | Size |
|---|---|---|
| Cookie banner (`.bt-banner`) | fixed, bottom 0, left 0, right 0, z-index 40 | height at most 96px |
| Backdrop (`.bt-backdrop`) | fixed, inset 0, z-index 50, `rgba(42, 21, 18, 0.45)` | full viewport |
| Dialog (`.bt-dialog`) | fixed, centred (top 50%, left 50%, translate -50% -50%), z-index 60 | width at most 480px, height at most 80vh, so about 400px to 880px across and 80px to 720px down |
| Toast (`.bt-toast`) | fixed, bottom 16px, left 16px, z-index 70 | width 320px, so about 16px to 336px across, clear of the dialog box |

Rules that keep planted elements reachable:

1. A dismissed overlay is removed from the DOM, so after dismissal nothing is under it. The page content of `.bt-root` has a bottom padding of 112px, so the last content line is not hidden by the banner even while it is open.
2. No route renders two overlays whose boxes overlap: home variants have either the banner or the modal, never both; the product page has one dialog and the toast, whose boxes do not intersect and whose z-index (70) is above the backdrop (50).
3. While open, the upsell close button sits inside the dialog (above the backdrop), and the ghost Reject button sits inside the banner (no other overlay on that route), so both stay visible. The backdrop is semi-transparent, so the page below stays visible but dimmed.
4. Coverage tests assert overlays by `data-testid` in the markup only. Geometry, focus movement and dismissal are verified in a browser by the later capture spec. This spec unit tests only `nextFocusIndex`, `shouldCloseOnKey` and the markup and stylesheet text.
5. Closing never changes the initial HTML, so the test id stays in the server markup.

### Phase-2 previews

All five stay in the fixture with `phase: 2`. The three flag anchors are visible, clearly labelled, inert static previews of the end state of the trick. The label text is always "Static preview of a later flow" (rendered by `Phase2Preview`). They have no link, no button and no input, and use no state from another page. The two honest look-alikes are visible elements as before. The later `boo-tique-flows` spec adds the behaviour for all five and replaces the previews with the real elements, keeping the same test ids.

| Entry | Route | Anchor element |
|---|---|---|
| cart-insurance-sneaked | `/boo-tique/cart` | `<li data-testid="cart-insurance-sneaked" data-anchor="phase-2">` in the cart lines `<ul>`, showing "Insurance $4.00" and the label. The items total of $40.00 sums the two product lines only. |
| checkout-handling-fees-drip | `/boo-tique/checkout` | `<li data-testid="checkout-handling-fees-drip" data-anchor="phase-2">` in the order summary `<ul>`, showing "Handling $6.99", "Haunting fee $3.00" and the label. The summary reads "Items $40.00", then this `<li>`, then "Total $49.99" (40.00 + 6.99 + 3.00). |
| checkout-consistent-shipping-tax | `/boo-tique/checkout?flow=honest` | Visible `<dl>` order summary: Items $40.00, Shipping $4.00, Tax $3.20, Total $47.20. |
| account-cancel-five-screens | `/boo-tique/account/subscription` | `<section data-testid="account-cancel-five-screens" data-anchor="phase-2">` headed "Cancel membership", stating that the member must call the shop to finish cancelling, with the label. It names no phone number. |
| account-one-click-cancel-plan | `/boo-tique/account/subscription?plan=honest` | Visible plan card "Moonlight Basic, $4.99/month" with one inert `<button type="button">Cancel plan</button>`. |

The word rule 13.5 is checked on visible text. Tests call `visibleText(markup, { exclude: [<the three preview ids>] })` on the cart, default checkout and default account views, and `visibleText(markup)` without exclusion on the honest variants. Test ids and other attributes are not part of visible text.

### Real-brand tripwire

`tests/boo-tique/helpers/brand-tripwire.ts` exports `BRAND_TRIPWIRE: readonly string[]` with Amazon, Walmart, Target, eBay, Etsy, Shopify, Nike, Apple, IKEA, Visa, Mastercard, PayPal, Stripe, Klarna and Amex. The safety test matches each name case-insensitively as a whole word against `visibleText` of every route variant (3.11), and against the source files of `app/boo-tique/`, `components/boo-tique/` and `lib/boo-tique/` (3.12). Shop copy must therefore avoid the common word "target". The list is only a negative test list and is never imported by shop code.

---

## Per-entry placement

The test id always goes on the carrying element named below. For controls (checkbox, radio, switch) it sits on the control, not on the label. Non-entry test ids start with `bt-` (for example `bt-demo-notice`, `bt-cookie-accept`).

| Entry id | Route | Carrying element | Component |
|---|---|---|---|
| home-hero-countdown-restart | `/boo-tique` | `<p>` "Boo-nanza ends in 04:59:59" | `HeroCountdown` in `PromoBlock` |
| home-rolling-midnight-text | `/boo-tique` | `<p>` "Black Friday of the Dead ends at midnight" | `PromoBlock` |
| home-fixed-date-sale | `/boo-tique` | `<p>` "Halloween sale ends 31 Oct 2026, 23:59 UTC" (constant `FIXED_SALE_TEXT`) | `PromoBlock` |
| home-cookie-accept-dominant | `/boo-tique` | Banner root `<div role="region" aria-label="Cookie preferences">`, a fixed bottom bar | `CookieBanner variant="default"` |
| home-cookie-ghost-reject | `/boo-tique?banner=ghost` | Banner root (fixed bottom bar) | `CookieBanner variant="ghost"` |
| home-cookie-equal-buttons | `/boo-tique?banner=equal` | Banner root (fixed bottom bar) | `CookieBanner variant="equal"` |
| newsletter-partners-prechecked | `/boo-tique?modal=exit-intent` | Partners `<input type="checkbox" checked>` inside the modal dialog | `ExitIntentModal` (via `OverlayDialog`) |
| product-low-stock-random | `/boo-tique/product/ghost-pepper-candle` | `<p>` "Only N left!" | `StockSignals` |
| product-viewers-random | same | `<p>` "N people are viewing this" | `StockSignals` |
| product-selling-fast-badge | same | `<span>` "Selling fast" | `StockSignals` |
| product-almost-gone-tiny | same | `<span data-stock-label="Almost gone" style 10px>` with text "Almost gone" | `StockSignals` |
| product-real-inventory-3-left | same | `<span>` "3 left" in the "Travel tin" variant row, from `INVENTORY["travel-tin"] = 3` | `StockSignals` |
| product-sold-toast | same | `<div role="status">`, fixed bottom-left toast | `SoldToast` |
| product-upsell-modal-tiny-close | same | `<section role="dialog" aria-modal="true" aria-label="Bundle offer" tabindex="-1">`, fixed and centred, open | `UpsellModal` (via `OverlayDialog`) |
| cart-protection-prechecked | `/boo-tique/cart` | `<input type="checkbox" checked>` "Add Raven Shipping Protection +$4.99" | `CartAddons` |
| cart-warranty-radio-preselected | same | Gold radio (checked) in group `warranty`: None $0.00, Silver $3.00, Gold $9.00 | `CartAddons` |
| cart-packaging-switch-on | same | `<button type="button" role="switch" aria-checked="true">` "Priority coffin packaging +$2.50" | `CartAddons` |
| cart-gift-wrap-unchecked | same | `<input type="checkbox">` unchecked "Gift wrap +$2.00" | `CartAddons` |
| cart-cheapest-shipping-default | same | Standard radio (checked) in group `shipping`: Standard $4.00, Express $9.00, Overnight $15.00 | `CartAddons` |
| cart-insurance-sneaked | same | Visible `<li>` "Insurance $4.00" with the label "Static preview of a later flow" | `Phase2Preview` |
| checkout-newsletter-prechecked | `/boo-tique/checkout` | `<input type="checkbox" checked>` "Send me the Boo-letter" | `CheckoutView` |
| checkout-handling-fees-drip | same | Visible `<li>` "Handling $6.99", "Haunting fee $3.00" and the label | `Phase2Preview` |
| checkout-consistent-shipping-tax | `/boo-tique/checkout?flow=honest` | Visible `<dl>` summary | `OrderSummary` |
| club-modal-hate-saving | `/boo-tique/club` | Decline `<button type="button">` "No thanks, I hate saving money" | `ClubOffers` |
| club-modal-full-price-mortal | same | Decline button "I'll pay full price like a mortal" | `ClubOffers` |
| club-modal-no-need-protection | same | Decline button "Maybe later, I don't need protection" in the protection card | `ClubOffers` |
| club-plain-no-thanks | same | Decline button "No thanks" in the newsletter card | `ClubOffers` |
| club-timer-session-restart | same | `<p>` "Join in 09:59 for 20% off" | `ClubTimer` |
| account-cancel-five-screens | `/boo-tique/account/subscription` | Visible `<section>` "Cancel membership": call the shop to finish, plus the label | `Phase2Preview` |
| account-one-click-cancel-plan | `/boo-tique/account/subscription?plan=honest` | Visible plan card `<section>` | `AccountPlans` |

Pages and fixed content:

- Home: the grid has six products (Cursed Candle Set $24, Phantom Hoodie $58, Moon-Phase Mug $22, Crypt Keeper Tote $26, Raven Feather Quill Pen $14, Ghost Pepper Candle $18). Only the Ghost Pepper Candle card links, to `/boo-tique/product/ghost-pepper-candle`.
- Cart: product lines Ghost Pepper Candle $18.00 and Moon-Phase Mug $22.00, then the labelled insurance preview line; items $40.00 (the two product lines only), estimated tax $3.20. Add-ons are inert and keep no state.
- Checkout default: heading, order summary `<ul>` with "Items $40.00" and then the labelled preview `<li>` (Handling $6.99, Haunting fee $3.00), "Total $49.99", the newsletter checkbox, a disabled place-order button. No other input.
- Club: four offer cards (20% off, free ghost-post shipping, protection upsell, newsletter) and the timer. Every accept button is `type="button"` and does nothing.
- Exit-intent modal: heading, own newsletter checkbox (unchecked), partners checkbox (checked), "Subscribe" and "Not now" buttons with the same style, and a close button. No text input.
- Product: Ghost Pepper Candle, $18.00, rating, variant rows "Large jar" and "Travel tin" (with "3 left"), inert "Add to cart"; the upsell dialog and the sold toast are overlays (see "Overlays are real overlays").

---

## Exact style values

All hex constants are lower case in `lib/boo-tique/styles.ts` and in the CSS tokens, so tests compare strings exactly. React writes inline styles as `font-size:11px`.

| Token | Value |
|---|---|
| `--bt-bg` cream | `#fbf3e4` |
| `--bt-paper` (banner, cards, modals) | `#fff9ee` |
| `--bt-ink` | `#2a1512` |
| `--bt-blood` (primary) | `#8b1a1a` |
| `--bt-blood-dark` | `#6e1212` |
| `--bt-muted` | `#6b5a52` |
| `--bt-line` | `#e3d2b2` |

The wrapper `.bt-root` sets `min-height: 100dvh`, `background: var(--bt-bg)` and `color: var(--bt-ink)`, so the dark root `<body>` never shows on short pages or during overscroll (2.10). It also sets `padding-bottom: 112px` so the fixed cookie banner never hides the last content line.

| Element | Values |
|---|---|
| Default banner "options" link | `font-size:11px; color:#9a9a9a; text-decoration:underline`, an `<a href="#cookie-options">`. No reject control on this layer. |
| Default banner "Accept all" | `font-size:20px; font-weight:700; padding:16px 48px; min-height:56px; background:#8b1a1a; color:#ffffff; border:0; border-radius:8px` |
| Ghost banner "Accept all" | Same as the default "Accept all". |
| Ghost banner "Reject" | `font-size:14px; color:#b3b3b3; background:transparent; border:1px solid #b3b3b3; padding:8px 20px; opacity:0.6`. Contrast of `#b3b3b3` on `#fff9ee` is about 2.00:1 (hand calculation). The test allows 1.9 to 2.1. The 60% opacity lowers the rendered contrast further. |
| Equal banner, both buttons | One shared style: `font-size:16px; font-weight:600; padding:12px 32px; min-width:160px; min-height:48px; background:#8b1a1a; color:#ffffff; border:2px solid #8b1a1a; border-radius:8px; opacity:1`. Labels "Accept all" and "Reject all". |
| Product "Almost gone" | `font-size:10px; color:#9a9a9a` |
| Upsell "Add crypt keeper bundle" | `font-size:20px; font-weight:700; padding:16px 32px; width:100%; background:#8b1a1a; color:#ffffff` |
| Upsell close "x" | `font-size:8px; line-height:1; color:#cfc6bc; background:transparent; border:0; padding:0`, with `aria-label="Close"` |
| Club and exit-intent buttons | Shared `EQUAL_BUTTON_STYLE` (the equal banner style) for accept and decline. |

"Almost gone" keeps its text in the DOM and also in `data-stock-label`. A CSS `::after { content: attr(...) }` variant was rejected: the capture spec has no extractor yet, and text that only exists in a pseudo-element could not be reached by a text-based detector. The later capture spec can add such a variant.

`lib/boo-tique/contrast.ts` exports `relativeLuminance(hex)` and `contrastRatio(a, b)` using the WCAG 2 formula (sRGB channel linearisation, then `(L1 + 0.05) / (L2 + 0.05)`).

---

## Error handling

- An unknown or repeated query value never throws: `pickVariant` uses the first array value and falls back to the default variant (1.12, 1.13).
- An unknown product slug renders a "not available in this demo" panel with no entry id (1.14). The page does not call `notFound()`.
- `ClubTimer` wraps every `sessionStorage` call in `try/catch` and keeps the end time in a ref when storage is blocked (14.13). A stored value that is not a finite number counts as missing.
- `renderRoute` throws a descriptive error for an unmatched path (7.5). Schema failures surface as Zod issues with a path; the derivation test names the first mismatching entry id.
- Nothing is posted anywhere. There is no network call, so there is no network error path.

## Test strategy

Unit tested without a browser (Vitest, node environment, no JSX in tests):

| Test file | Covers |
|---|---|
| `tests/boo-tique/tsx-smoke.test.ts` | First task only: a tiny `.tsx` component loads and renders under Vitest (16.3). Deleted with `components/boo-tique/smoke.tsx` in the shell task, where `shell.test.ts` takes over the TSX proof. |
| `tests/boo-tique/ground-truth.test.ts` | Schema cases (4.6 to 4.11), fixture parse and counts (4.1 to 4.5, 4.12), derivation against the research file (5.x). |
| `tests/boo-tique/contrast.test.ts`, `styles.test.ts` | Contrast function, ghost-reject ratio, palette and style constants, CSS token isolation, wrapper fill (`min-height: 100dvh`, `--bt-bg`), overlay placement values in the stylesheet text (2.3 to 2.5, 2.10, 15.4, 15.5, 17.11). |
| `tests/boo-tique/shell.test.ts`, `metadata.test.ts` | Wrapper, notice, no html/body, noindex, layout wiring (1.15, 2.1, 2.2, 2.6, 3.1 to 3.4). |
| `tests/boo-tique/variants.test.ts`, `render-route.test.ts` | `pickVariant` and the harness against a fake route table (1.12, 1.13, 7.1 to 7.5). |
| `tests/boo-tique/coverage.test.ts` | For every fixture route that is not in `PENDING_ROUTES`: each entry id once, no foreign entry id, no unknown entry-shaped id, `bt-` rule, no verdict strings, no shell in raw page output; plus the guard that every fixture route is in exactly one of `PENDING_ROUTES` or the route table, and (last task) that `PENDING_ROUTES` is empty (6.x, 7.6, 7.7, 3.3). No `it.skip`. |
| `tests/boo-tique/<page>-page.test.ts` | Per-page text, checked state, style attributes, overlay markup (`role`, `aria-modal`, backdrop, `tabindex`), neutral-copy rules and the `visibleText` word rules. |
| `tests/boo-tique/countdown.test.ts`, `club-timer.test.ts`, `per-load.test.ts`, `overlay.test.ts` | Pure timer, toast, generator and focus functions (`nextFocusIndex`, `shouldCloseOnKey`); the `dynamic` export; `createProductPage` with injected random sources (14.x, 17.6, 17.7). |
| `tests/boo-tique/safety.test.ts` | Fake-shop scan of every route variant plus source scans, using `visibleText` and `BRAND_TRIPWIRE` (3.5 to 3.12, 2.7, 2.9, 6.6, and the allowed `"use client"` file list). |

Not tested automatically: computed layout, real contrast after opacity, whether client components tick in a browser, overlay behaviour in a browser (fixed positioning, initial focus, focus trap, Escape, dismissal, focus return), real reload variance, static prerender behaviour, and font loading. The later page-capture spec covers overlay behaviour in a browser, reload variance and rendered measurements. The owner's production build covers fonts. That this spec adds no dependency (16.1) is checked by the reviewer reading `package.json`, not by a test.

## Risks

- **Static prerender vs per-load randomness.** Without `force-dynamic`, the product numbers would freeze at build time. Mitigation: the `dynamic` export is asserted by a test. Two real loads can still show the same numbers, so no test and no later spec should rely on one reload pair; tests inject random sources, and the later capture spec takes more than two samples.
- **Hydration.** Client components render identical text and markup on the server and on first client render (overlays open), and change only in effects and event handlers. Mitigation: no `Date.now()` or `Math.random()` in render.
- **Overlays hide planted elements.** Fixed overlays can cover page content while open. Mitigation: the placement table, the 112px bottom padding, removal from the DOM on dismissal, and the rule that no route renders overlapping overlays. A browser check of the geometry belongs to the later capture spec.
- **`next/font` in tests.** Mitigation: fonts live only in `layout.tsx`, which tests never import.
- **Async `searchParams`.** In this Next.js version `searchParams` and `params` are Promises. Mitigation: pages are `async` and `await` them; the harness passes Promises.
- **Async nested components.** `renderToStaticMarkup` cannot render async components below the page. Mitigation: only the page function is async.
- **Page-file exports.** Next.js rejects unknown named exports from a page file. Mitigation: `createProductPage` lives in `components/boo-tique/product-page.tsx`, and the page file exports only `dynamic` and the default.
- **TSX in Vitest.** Vitest transforms `.tsx` with esbuild using the `jsx: "react-jsx"` setting from `tsconfig.json`. This is unverified here, so task 1 starts with a smoke test. If it fails to load, the builder stops and reports and does not edit `vitest.config.ts`; the smallest fix is `esbuild: { jsx: "automatic" }`, which the owner must approve.
- **Lint rules.** `react-hooks` may flag state set inside an effect. Mitigation: set state from the interval callback or an event handler, or add a narrow disable comment with a reason.
- **Fonts offline.** `next build` downloads Google Fonts and needs network access. `Cormorant_Garamond` is given explicit weights (`400`, `600`, `700`) to work for static and variable builds.
- **Hand-computed contrast.** The 2.00:1 figure is a hand calculation. The test tolerance of 1.9 to 2.1 absorbs rounding.
- **Brand tripwire false positives.** The common word "target" is on the list. Mitigation: shop copy avoids it.
