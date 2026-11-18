# Requirements: Boo-tique Static Pages

This spec builds the static pages of The Boo-tique, the fake demo shop served from the same Next.js app under `/boo-tique`, together with the typed ground-truth fixture and the tests that prove every fixture entry is planted on its page.

## Out of scope

- Multi-step flows and interactions that need state across pages: the checkout walk, the cancel flow, add-to-cart, sneak-into-basket behaviour and drip-pricing behaviour. A later `boo-tique-flows` spec adds them.
- The real-inventory behaviour "drops when added to cart" (needs cart state).
- Page capture, `getBrowser()` and the extractor.
- Detectors and the LLM judge.
- The scanner UI and the results overlay.
- Supabase and any API route.
- shadcn/ui. This spec does not use it.
- Deployment.
- Playwright tests.
- Images and photography.
- Internationalisation.
- Any change to the Trick or Trap dark theme or to its existing tokens.
- Editing existing specs (`.kiro/specs/foundation*`).
- Measuring computed layout, real reload variance or real contrast in a browser. The later page-capture and detector specs cover those.
- Verifying overlay behaviour (fixed positioning, focus movement, focus trap, Escape, dismissal) in a browser. The later capture spec does that. This spec unit tests only the pure helper functions and checks the server markup and the stylesheet text.
- Any new npm dependency.

## Ground-truth reference

Counted directly from `docs/research/boo-tique-ground-truth.json`:

- 30 entries: 22 with `expectedVerdict: "flag"` and 8 with `"no-flag"`.
- Phase 1: 25 entries (19 flag, 6 no-flag). Phase 2: 5 entries (3 flag, 2 no-flag).
- Canonical pattern counts of the 22 flag entries: preselection 5, fake-urgency 3, fake-scarcity 3, confirmshaming 3, visual-interference 3, fake-activity 2, sneak-into-basket 1, drip-pricing 1, hard-to-cancel 1.
- The 8 no-flag entries use the value `none`.

Every entry, with the route it is planted on and the criterion that covers it:

| Entry id | Route (under `/boo-tique`) | Canonical pattern | Verdict | Phase | Criterion |
|---|---|---|---|---|---|
| home-hero-countdown-restart | `/boo-tique` | fake-urgency | flag | 1 | 8.2 |
| home-rolling-midnight-text | `/boo-tique` | fake-urgency | flag | 1 | 8.3 |
| home-fixed-date-sale | `/boo-tique` | none | no-flag | 1 | 8.4 |
| home-cookie-accept-dominant | `/boo-tique` | visual-interference | flag | 1 | 8.5 |
| home-cookie-ghost-reject | `/boo-tique?banner=ghost` | visual-interference | flag | 1 | 8.6 |
| home-cookie-equal-buttons | `/boo-tique?banner=equal` | none | no-flag | 1 | 8.7 |
| newsletter-partners-prechecked | `/boo-tique?modal=exit-intent` | preselection | flag | 1 | 9.1 |
| product-low-stock-random | `/boo-tique/product/ghost-pepper-candle` | fake-scarcity | flag | 1 | 10.1 |
| product-viewers-random | same | fake-activity | flag | 1 | 10.2 |
| product-selling-fast-badge | same | fake-scarcity | flag | 1 | 10.3 |
| product-almost-gone-tiny | same | fake-scarcity | flag | 1 | 10.4 |
| product-real-inventory-3-left | same | none | no-flag | 1 | 10.5 |
| product-sold-toast | same | fake-activity | flag | 1 | 10.6 |
| product-upsell-modal-tiny-close | same | visual-interference | flag | 1 | 10.7 |
| cart-protection-prechecked | `/boo-tique/cart` | preselection | flag | 1 | 11.2 |
| cart-warranty-radio-preselected | `/boo-tique/cart` | preselection | flag | 1 | 11.3 |
| cart-packaging-switch-on | `/boo-tique/cart` | preselection | flag | 1 | 11.4 |
| cart-gift-wrap-unchecked | `/boo-tique/cart` | none | no-flag | 1 | 11.5 |
| cart-cheapest-shipping-default | `/boo-tique/cart` | none | no-flag | 1 | 11.6 |
| cart-insurance-sneaked | `/boo-tique/cart` | sneak-into-basket | flag | 2 | 13.1 |
| checkout-newsletter-prechecked | `/boo-tique/checkout` | preselection | flag | 1 | 11.8 |
| checkout-handling-fees-drip | `/boo-tique/checkout` | drip-pricing | flag | 2 | 13.2 |
| checkout-consistent-shipping-tax | `/boo-tique/checkout?flow=honest` | none | no-flag | 2 | 11.10 |
| club-modal-hate-saving | `/boo-tique/club` | confirmshaming | flag | 1 | 9.5 |
| club-modal-full-price-mortal | `/boo-tique/club` | confirmshaming | flag | 1 | 9.6 |
| club-modal-no-need-protection | `/boo-tique/club` | confirmshaming | flag | 1 | 9.7 |
| club-plain-no-thanks | `/boo-tique/club` | none | no-flag | 1 | 9.8 |
| club-timer-session-restart | `/boo-tique/club` | fake-urgency | flag | 1 | 9.9 |
| account-cancel-five-screens | `/boo-tique/account/subscription` | hard-to-cancel | flag | 2 | 13.3 |
| account-one-click-cancel-plan | `/boo-tique/account/subscription?plan=honest` | none | no-flag | 2 | 12.2 |

---

## 1. Routes and variants

**User story:** As a judge or a test author, I want every Boo-tique page and variant at a stable URL, so that I can scan or render exactly the page a ground-truth entry names.

**Acceptance criteria:**

1.1. WHEN a visitor requests `/boo-tique` THE SYSTEM SHALL respond with the shop home page that contains a product grid.

1.2. WHEN a visitor requests `/boo-tique?banner=ghost` THE SYSTEM SHALL respond with the home page variant that has the ghost-reject cookie banner.

1.3. WHEN a visitor requests `/boo-tique?banner=equal` THE SYSTEM SHALL respond with the home page variant that has the equal-buttons cookie banner.

1.4. WHEN a visitor requests `/boo-tique?modal=exit-intent` THE SYSTEM SHALL respond with the home page variant whose exit-intent newsletter modal is open in the initial HTML.

1.5. WHEN a visitor requests `/boo-tique/product/ghost-pepper-candle` THE SYSTEM SHALL respond with the product detail page.

1.6. WHEN a visitor requests `/boo-tique/cart` THE SYSTEM SHALL respond with the cart page with fixed demo contents.

1.7. WHEN a visitor requests `/boo-tique/club` THE SYSTEM SHALL respond with the club page that hosts the offer-modal content.

1.8. WHEN a visitor requests `/boo-tique/checkout` THE SYSTEM SHALL respond with one static checkout view that has no steps, no payment fields and no card inputs.

1.9. WHEN a visitor requests `/boo-tique/checkout?flow=honest` THE SYSTEM SHALL respond with the honest variant of that one static checkout view.

1.10. WHEN a visitor requests `/boo-tique/account/subscription` THE SYSTEM SHALL respond with the static account and subscription page.

1.11. WHEN a visitor requests `/boo-tique/account/subscription?plan=honest` THE SYSTEM SHALL respond with the honest-plan variant of that page.

1.12. WHEN a query parameter has a value that is not listed for it in 1.2 to 1.11 THE SYSTEM SHALL render the default variant of that page and SHALL NOT throw.

1.13. WHEN a query parameter is repeated THE SYSTEM SHALL use its first value.

1.14. WHEN a product slug other than `ghost-pepper-candle` is requested THE SYSTEM SHALL render an in-page "not available in this demo" message that contains no ground-truth test id.

1.15. WHEN the app is built THE SYSTEM SHALL serve the Boo-tique from the real segment `app/boo-tique/` and SHALL keep `/` served by `app/page.tsx`, with no `app/(boo-tique)` route group.

## 2. Theme and layout isolation

**User story:** As a viewer, I want the Boo-tique to look unmistakably different from Trick or Trap, so that I know I am on the demo target.

**Acceptance criteria:**

2.1. WHEN any Boo-tique page is rendered THE SYSTEM SHALL wrap its content in one element with the class `bt-root` that carries the scoped Boo-tique tokens.

2.2. WHEN any Boo-tique page is rendered THE SYSTEM SHALL NOT output an `<html>` or `<body>` element, because the root layout owns them.

2.3. WHEN the Boo-tique stylesheet is read THE SYSTEM SHALL declare its tokens only as `--bt-*` custom properties scoped to `.bt-root`, with no `@theme` block, no `--color-*` property and no `:root` or `body` selector.

2.4. WHEN `app/globals.css` is read THE SYSTEM SHALL contain no `--bt-` declaration.

2.5. WHEN the palette is read THE SYSTEM SHALL define the page background as `#fbf3e4`, the primary as `#8b1a1a` and the ink as `#2a1512`, and the `--bt-*` tokens in the stylesheet SHALL equal the palette constants in code.

2.6. WHEN the Boo-tique layout loads fonts THE SYSTEM SHALL load Cormorant Garamond for headings and Jost for body text with `next/font/google` inside `app/boo-tique/layout.tsx`.

2.7. WHEN any module under `app/boo-tique/` other than `layout.tsx`, or under `components/boo-tique/` or `lib/boo-tique/`, is read THE SYSTEM SHALL contain no import from `next/font`.

2.8. WHEN a product is drawn THE SYSTEM SHALL use a CSS and inline-SVG tile and SHALL NOT output an `<img>` element or an external image URL.

2.9. WHEN a navigation link is rendered THE SYSTEM SHALL use a plain `<a>` element with a relative `/boo-tique` or `#` href, and no module SHALL import `next/link`.

2.10. WHEN a Boo-tique page is shorter than the viewport, or the browser overscrolls, THE SYSTEM SHALL keep the dark root `<body>` from showing, because `.bt-root` has `min-height: 100dvh` and its own background `var(--bt-bg)`.

## 3. Clearly fake shop and no real payment

**User story:** As a judge, I want it to be obvious that the Boo-tique is fake and cannot take money or data, so that scanning it is safe.

**Acceptance criteria:**

3.1. WHEN any Boo-tique page is rendered through the Boo-tique shell THE SYSTEM SHALL show the text "Demo shop, nothing is for sale".

3.2. WHEN any Boo-tique page is rendered through the Boo-tique shell THE SYSTEM SHALL contain that notice exactly once, on an element with `data-testid="bt-demo-notice"`.

3.3. WHEN a Boo-tique page component is rendered without the shell THE SYSTEM SHALL NOT contain the notice, which proves the notice lives in the layout and not in each page.

3.4. WHEN the Boo-tique layout is read THE SYSTEM SHALL export `metadata` whose `robots` value is `{ index: false, follow: false }`.

3.5. WHEN any Boo-tique page variant is rendered THE SYSTEM SHALL output no `<form` element.

3.6. WHEN any Boo-tique page variant is rendered THE SYSTEM SHALL output only `<input>` elements of type `checkbox` or `radio`, and none whose `name`, `id` or `autocomplete` matches card, cvc, cvv, iban, expiry or payment.

3.7. WHEN any Boo-tique page variant is rendered THE SYSTEM SHALL give every `<button>` the attribute `type="button"`.

3.8. WHEN any Boo-tique page variant is rendered THE SYSTEM SHALL contain no `href`, `src` or `action` value that starts with `http://`, `https://` or `//`, no `url(` pointing to an external host, and no `<img`, `<iframe`, `<script` or `<link` element.

3.9. WHEN any module under `app/boo-tique/`, `components/boo-tique/` or `lib/boo-tique/` is read THE SYSTEM SHALL contain no `fetch(`, `XMLHttpRequest`, `sendBeacon` or `WebSocket`, and no import of `next/link`, `next/image` or `next/navigation`.

3.10. WHEN product names are rendered THE SYSTEM SHALL use only these original names: Cursed Candle Set, Phantom Hoodie, Moon-Phase Mug, Crypt Keeper Tote, Raven Feather Quill Pen, Ghost Pepper Candle.

3.11. WHEN the visible text of any route variant is extracted THE SYSTEM SHALL contain none of the names in the typed constant `BRAND_TRIPWIRE` (Amazon, Walmart, Target, eBay, Etsy, Shopify, Nike, Apple, IKEA, Visa, Mastercard, PayPal, Stripe, Klarna, Amex), matched case-insensitively as whole words.

3.12. WHEN any module under `app/boo-tique/`, `components/boo-tique/` or `lib/boo-tique/` is read THE SYSTEM SHALL NOT contain a name from `BRAND_TRIPWIRE`, which lives only in `tests/boo-tique/helpers/brand-tripwire.ts` and is used only as a negative list.

## 4. Ground-truth fixture, schema and id mapping

**User story:** As a detector author, I want a typed, validated copy of the ground truth with canonical pattern ids, so that detector tests use the same ids as the product.

**Acceptance criteria:**

4.1. WHEN `tests/fixtures/boo-tique-ground-truth.json` is read THE SYSTEM SHALL contain 30 entries, of which 22 have `expectedVerdict: "flag"` and 8 have `"no-flag"`.

4.2. WHEN the fixture is read THE SYSTEM SHALL use canonical pattern ids, mapping the research values `urgency` to `fake-urgency`, `scarcity` to `fake-scarcity` and `activity` to `fake-activity` and leaving every other canonical value unchanged.

4.3. WHEN the fixture is read THE SYSTEM SHALL use the value `none` as the pattern of exactly the 8 no-flag entries.

4.4. WHEN the fixture is read THE SYSTEM SHALL give every entry a `route` that starts with `/boo-tique` and keeps the query string of the research route.

4.5. WHEN the fixture is read THE SYSTEM SHALL mark exactly these five entries with `phase: 2`: cart-insurance-sneaked, checkout-handling-fees-drip, checkout-consistent-shipping-tax, account-cancel-five-screens, account-one-click-cancel-plan.

4.6. WHEN an entry is parsed with `GroundTruthEntrySchema` in `lib/boo-tique/ground-truth.ts` THE SYSTEM SHALL accept a pattern that is a `PatternIdSchema` value or the literal `none`.

4.7. WHEN an entry has pattern `none` and verdict `flag` THE SYSTEM SHALL reject it.

4.8. WHEN an entry has a canonical pattern id and verdict `no-flag` THE SYSTEM SHALL reject it.

4.9. WHEN an entry uses a research short id (`urgency`, `scarcity` or `activity`) as its pattern THE SYSTEM SHALL reject it.

4.10. WHEN a list of entries contains a duplicate `id` THE SYSTEM SHALL reject the list with `GroundTruthSchema`.

4.11. WHEN an entry id does not match the shape `<home|product|cart|checkout|club|account|newsletter>-<kebab-case words>` THE SYSTEM SHALL reject the entry.

4.12. WHEN the fixture file is parsed with `GroundTruthSchema` THE SYSTEM SHALL succeed.

## 5. Derivation test

**User story:** As a maintainer, I want a test that ties the fixture to the research file, so that the two cannot drift apart.

**Acceptance criteria:**

5.1. WHEN the derivation test runs THE SYSTEM SHALL check that the fixture has the same number of entries as `docs/research/boo-tique-ground-truth.json`.

5.2. WHEN the derivation test runs THE SYSTEM SHALL check that both files list the same ids in the same order.

5.3. WHEN the derivation test runs THE SYSTEM SHALL check that each entry has the same `expectedVerdict` in both files.

5.4. WHEN the derivation test runs THE SYSTEM SHALL check that each entry has the same `phase` in both files.

5.5. WHEN the derivation test runs THE SYSTEM SHALL check that each entry has the same `difficulty` in both files.

5.6. WHEN the derivation test runs THE SYSTEM SHALL check that each fixture `pattern` equals the research `pattern` after the id mapping in 4.2.

5.7. WHEN the derivation test runs THE SYSTEM SHALL check that each entry has the same `page` and `element` text in both files.

5.8. WHEN the derivation test runs THE SYSTEM SHALL check that each fixture `route` equals `/boo-tique` followed by the research route with a lone `/` path removed, so `/` becomes `/boo-tique` and `/?banner=ghost` becomes `/boo-tique?banner=ghost`.

5.9. WHEN the research file contains a pattern value that is neither in the mapping nor a canonical id nor `none` THE SYSTEM SHALL fail the derivation test.

## 6. Stable test ids and a verdict-free DOM

**User story:** As a test author, I want each planted element addressable by its entry id and nothing else in the DOM giving the answer away, so that tests and detectors cannot cheat.

**Acceptance criteria:**

6.1. WHEN a route is rendered THE SYSTEM SHALL contain exactly one element with `data-testid` equal to the id of each fixture entry whose `route` is that route.

6.2. WHEN a route is rendered THE SYSTEM SHALL contain no `data-testid` equal to the id of a fixture entry whose `route` is a different route.

6.3. WHEN an element that is not a fixture entry carries a `data-testid` THE SYSTEM SHALL start that value with `bt-`.

6.4. WHEN a rendered route contains a `data-testid` that matches the entry id shape in 4.11 THE SYSTEM SHALL have that id in the fixture.

6.5. WHEN any route is rendered THE SYSTEM SHALL output none of these strings: the nine canonical pattern ids, `data-pattern`, `data-verdict`, `no-flag`, `lookalike`.

6.6. WHEN any module under `app/boo-tique/`, `components/boo-tique/` or `lib/boo-tique/` (other than `lib/boo-tique/ground-truth.ts`) is read THE SYSTEM SHALL NOT import the fixture or the ground-truth schema, so the verdict stays in the JSON only.

## 7. Coverage test and render harness

**User story:** As a developer, I want a browserless test that renders every route and checks the planted elements, so that I can verify pages one task at a time.

**Acceptance criteria:**

7.1. WHEN the harness renders a route THE SYSTEM SHALL produce markup with `renderToStaticMarkup` from `react-dom/server`, with no jsdom, no Playwright and no browser.

7.2. WHEN the harness renders a route THE SYSTEM SHALL await the page function and pass `params` and `searchParams` as Promises.

7.3. WHEN the route has a query string THE SYSTEM SHALL pass it as the `searchParams` record, with a repeated key as an array.

7.4. WHEN the harness renders a route THE SYSTEM SHALL wrap the page element in `BooTiqueShell`, unless the caller asks for no shell.

7.5. WHEN the route path has no entry in the route table THE SYSTEM SHALL throw an error that names the path.

7.6. WHEN a fixture route is listed in the exported constant `PENDING_ROUTES` THE SYSTEM SHALL leave it out of the per-route coverage tests, and every distinct fixture route SHALL be in exactly one of `PENDING_ROUTES` or the route table, so a task can verify only its own pages and no test is skipped.

7.7. WHEN every page task is finished THE SYSTEM SHALL have an empty `PENDING_ROUTES` and a route-table entry for every distinct fixture route, checked by a guard test.

## 8. Home page and cookie banner variants

**User story:** As a detector author, I want the home page to carry the urgency and cookie-banner entries, so that I can test them.

**Acceptance criteria:**

8.1. WHEN the default home page is rendered THE SYSTEM SHALL show a grid of six products, each with a name, a price and a star rating, and a link only on the Ghost Pepper Candle card.

8.2. WHEN the default home page is rendered THE SYSTEM SHALL contain `home-hero-countdown-restart` on an element whose initial text is "Boo-nanza ends in 04:59:59".

8.3. WHEN the default home page is rendered THE SYSTEM SHALL contain `home-rolling-midnight-text` on an element whose text is "Black Friday of the Dead ends at midnight".

8.4. WHEN the default home page is rendered THE SYSTEM SHALL contain `home-fixed-date-sale` on an element whose text is "Winter sale ends 28 Feb 2027, 23:59 UTC".

8.5. WHEN the default home page is rendered THE SYSTEM SHALL contain `home-cookie-accept-dominant` on a cookie banner that has a large filled "Accept all" button, a small grey "options" link and no reject control.

8.6. WHEN `/boo-tique?banner=ghost` is rendered THE SYSTEM SHALL contain `home-cookie-ghost-reject` on a cookie banner whose "Reject" control is a faded ghost button.

8.7. WHEN `/boo-tique?banner=equal` is rendered THE SYSTEM SHALL contain `home-cookie-equal-buttons` on a cookie banner whose "Accept" and "Reject" buttons have the same size and the same style.

8.8. WHEN a home page variant is rendered THE SYSTEM SHALL contain exactly one cookie banner for the default, ghost and equal variants.

8.9. WHEN the ghost or equal variant is rendered THE SYSTEM SHALL NOT contain the hero countdown, the rolling-midnight text or the fixed-date text.

## 9. Exit-intent modal and club page

**User story:** As a detector author, I want the newsletter modal and the club offers on pages of their own, so that confirmshaming and preselection can be tested.

**Acceptance criteria:**

9.1. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL contain `newsletter-partners-prechecked` on a checkbox labelled "Share my details with trusted partners" that is checked.

9.2. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL show the modal's own newsletter checkbox unchecked and a plain decline button labelled "Not now".

9.3. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL NOT contain a cookie banner or the promo block.

9.4. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL contain no text input.

9.5. WHEN the club page is rendered THE SYSTEM SHALL contain `club-modal-hate-saving` on the decline button "No thanks, I hate saving money", next to an accept button "Yes, give me 20% off!".

9.6. WHEN the club page is rendered THE SYSTEM SHALL contain `club-modal-full-price-mortal` on the decline button "I'll pay full price like a mortal".

9.7. WHEN the club page is rendered THE SYSTEM SHALL contain `club-modal-no-need-protection` on the decline button "Maybe later, I don't need protection" inside a protection upsell card.

9.8. WHEN the club page is rendered THE SYSTEM SHALL contain `club-plain-no-thanks` on a decline button labelled "No thanks" inside a newsletter card whose accept and decline buttons have the same style.

9.9. WHEN the club page is rendered THE SYSTEM SHALL contain `club-timer-session-restart` on an element whose initial text is "Join in 09:59 for 20% off".

9.10. WHEN the club page is rendered THE SYSTEM SHALL render every accept and decline pair with the same style and SHALL NOT submit or post anything.

## 10. Product page

**User story:** As a detector author, I want the product page to carry the scarcity, activity and upsell entries, so that I can test them.

**Acceptance criteria:**

10.1. WHEN the product page is rendered THE SYSTEM SHALL contain `product-low-stock-random` on an element whose text is "Only N left!", with N a generated number.

10.2. WHEN the product page is rendered THE SYSTEM SHALL contain `product-viewers-random` on an element whose text is "N people are viewing this", with N a generated number.

10.3. WHEN the product page is rendered THE SYSTEM SHALL contain `product-selling-fast-badge` on a badge whose text is "Selling fast" and contains no digit.

10.4. WHEN the product page is rendered THE SYSTEM SHALL contain `product-almost-gone-tiny` on a span whose text is "Almost gone" and whose label is also held in a `data-stock-label` attribute.

10.5. WHEN the product page is rendered THE SYSTEM SHALL contain `product-real-inventory-3-left` on a span whose text is "3 left", taken from a typed inventory constant, with no urgency wording around it.

10.6. WHEN the product page is rendered THE SYSTEM SHALL contain `product-sold-toast` on a status element whose initial text is "Morgan from Ohio just bought the Cursed Candle Set".

10.7. WHEN the product page is rendered THE SYSTEM SHALL contain `product-upsell-modal-tiny-close` on a dialog that is open in the initial HTML, with a large "Add crypt keeper bundle" button and a tiny "x" close button.

10.8. WHEN the product page is rendered THE SYSTEM SHALL contain the upsell dialog and the sold toast as the overlays described in requirement 17.

10.9. WHEN the product page is rendered THE SYSTEM SHALL show an "Add to cart" button of type `button` with no handler.

## 11. Cart and checkout pages

**User story:** As a detector author, I want the cart and checkout to carry the preselection entries and their honest look-alikes, so that precision can be tested.

**Acceptance criteria:**

11.1. WHEN the cart page is rendered THE SYSTEM SHALL list two fixed product lines, Ghost Pepper Candle at $18.00 and Moon-Phase Mug at $22.00, and an items total of $40.00 that sums the two product lines only.

11.2. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-protection-prechecked` on a checked checkbox labelled "Add Raven Shipping Protection +$4.99".

11.3. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-warranty-radio-preselected` on the checked radio "Gold Extended Curse Warranty" in a group where a cheaper option exists.

11.4. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-packaging-switch-on` on a `<button role="switch">` labelled "Priority coffin packaging" with `aria-checked="true"`.

11.5. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-gift-wrap-unchecked` on an unchecked checkbox labelled "Gift wrap +$2.00".

11.6. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-cheapest-shipping-default` on the checked radio of the cheapest shipping option, "Standard coffin post $4.00", with two dearer options unchecked.

11.7. WHEN the cart page is rendered THE SYSTEM SHALL list exactly four preselected controls: the entries in 11.2, 11.3, 11.4 and 11.6.

11.8. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL contain `checkout-newsletter-prechecked` on a checked checkbox labelled "Send me the Boo-letter".

11.9. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL show "Items $40.00" first in the order summary, then the labelled preview lines of 13.2, then "Total $49.99" (items plus the two preview fees), and a place-order button that is disabled.

11.10. WHEN `/boo-tique/checkout?flow=honest` is rendered THE SYSTEM SHALL contain `checkout-consistent-shipping-tax` on a visible summary that shows items $40.00, shipping $4.00 and tax $3.20, the same shipping and tax figures as the cart.

11.11. WHEN `/boo-tique/checkout?flow=honest` is rendered THE SYSTEM SHALL contain no checked control and no input.

11.12. WHEN the cart page is rendered THE SYSTEM SHALL show an estimated tax of $3.20.

## 12. Account and subscription page

**User story:** As a detector author, I want the account page to have an honest variant, so that the one-click cancel look-alike exists.

**Acceptance criteria:**

12.1. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL show the plan "Midnight Club Monthly, $9.99/month" and a membership section that holds the preview of 13.3.

12.2. WHEN `/boo-tique/account/subscription?plan=honest` is rendered THE SYSTEM SHALL contain `account-one-click-cancel-plan` on a visible card for "Moonlight Basic, $4.99/month" that has one inert "Cancel plan" button.

12.3. WHEN `/boo-tique/account/subscription?plan=honest` is rendered THE SYSTEM SHALL contain no retention offer text and no phone number.

## 13. Phase-2 anchors

**User story:** As a later spec author, I want the five phase-2 entries to have inert anchors on the right pages, so that the coverage test holds now and the flows can replace them later.

**Acceptance criteria:**

13.1. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-insurance-sneaked` on a visible `<li>` in the cart lines list that shows the line "Insurance $4.00" and the label "Static preview of a later flow".

13.2. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL contain `checkout-handling-fees-drip` on a visible `<li>` in the order summary list that shows "Handling $6.99", "Haunting fee $3.00" and the label "Static preview of a later flow".

13.3. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL contain `account-cancel-five-screens` on a visible `<section>` in the membership area that is headed "Cancel membership", states that the member must call the shop to finish cancelling, and shows the label "Static preview of a later flow".

13.4. WHEN a phase-2 anchor of 13.1, 13.2 or 13.3 is rendered THE SYSTEM SHALL give it no link, no button and no input, and SHALL NOT make it depend on state from another page.

13.5. WHEN the cart page, the default checkout view or the default account view is rendered THE SYSTEM SHALL contain none of the words insurance, handling, haunting or phone in its visible text outside the phase-2 anchor elements of 13.1 to 13.3, and the honest checkout and honest account variants SHALL contain none of those words at all. The check uses visible-text extraction (tags and attributes removed), so test ids such as `cart-insurance-sneaked` are not scanned.

13.6. WHEN the fixture is parsed THE SYSTEM SHALL keep the five phase-2 entries in it with `phase: 2`, and the coverage test SHALL treat them like every other entry.

## 14. Per-load behaviours

**User story:** As a detector author, I want the reload and per-session behaviours to be real, so that later reload and clock tests see true variance.

**Acceptance criteria:**

14.1. WHEN the home page is rendered THE SYSTEM SHALL output the hero text "Boo-nanza ends in 04:59:59" on every render.

14.2. WHEN the hero countdown mounts in a browser THE SYSTEM SHALL count down from 17999 seconds, restart from 04:59:59 on every reload and use no storage.

14.3. WHEN the product page module is read THE SYSTEM SHALL export `dynamic` equal to `"force-dynamic"`.

14.4. WHEN the per-load generator runs THE SYSTEM SHALL return a stock number between 2 and 9 inclusive.

14.5. WHEN the per-load generator runs THE SYSTEM SHALL return a viewer number between 8 and 48 inclusive.

14.6. WHEN the per-load generator is called with an injected random function THE SYSTEM SHALL return values that depend only on that function.

14.7. WHEN the product page is rendered with two different generated values THE SYSTEM SHALL output different markup that contains each number.

14.8. WHEN `createProductPage` is called with two different injected random sources THE SYSTEM SHALL return page functions that render different markup, and with the same source SHALL render the same markup.

14.9. WHEN the sold toast first renders THE SYSTEM SHALL show the first of four fixed messages, and after mount SHALL rotate to the next message every 6000 ms.

14.10. WHEN the club page is rendered THE SYSTEM SHALL output "Join in 09:59 for 20% off" as the initial timer text.

14.11. WHEN the stored club timer end is missing or already past THE SYSTEM SHALL start a new 599 second period with the same offer text.

14.12. WHEN the stored club timer end is in the future THE SYSTEM SHALL continue with the remaining seconds.

14.13. WHEN `sessionStorage` is unavailable or throws THE SYSTEM SHALL keep the timer in memory and SHALL NOT throw.

14.14. WHEN the home page is rendered twice THE SYSTEM SHALL output identical text for the fixed-date sale and for the rolling-midnight text.

## 15. Numeric style values

**User story:** As a detector author, I want the tricks to have exact, fixed measurements, so that visual-interference detectors have a known target.

**Acceptance criteria:**

15.1. WHEN the default cookie banner is rendered THE SYSTEM SHALL style the "options" link with `font-size:11px` and colour `#9a9a9a`.

15.2. WHEN the default cookie banner is rendered THE SYSTEM SHALL style "Accept all" with `font-size:20px`, `font-weight:700`, padding `16px 48px`, `min-height:56px`, background `#8b1a1a` and colour `#ffffff`.

15.3. WHEN the ghost banner is rendered THE SYSTEM SHALL style "Reject" with `font-size:14px`, colour `#b3b3b3`, a `1px solid #b3b3b3` border, a transparent background and `opacity:0.6`.

15.4. WHEN the contrast ratio of `#b3b3b3` on the banner background `#fff9ee` is computed with the WCAG formula THE SYSTEM SHALL give a value from 1.9 to 2.1.

15.5. WHEN `contrastRatio` is called with black and white THE SYSTEM SHALL return 21, and with two equal colours SHALL return 1.

15.6. WHEN the equal banner is rendered THE SYSTEM SHALL give the Accept and Reject buttons identical `style` attributes.

15.7. WHEN the product page is rendered THE SYSTEM SHALL style "Almost gone" with `font-size:10px` and colour `#9a9a9a`.

15.8. WHEN the product page is rendered THE SYSTEM SHALL style the upsell close button with `font-size:8px` and colour `#cfc6bc`, with the text "x".

15.9. WHEN the product page is rendered THE SYSTEM SHALL style the "Add crypt keeper bundle" button with `font-size:20px`, `font-weight:700` and the full width of the modal.

## 16. No new dependencies and test constraints

**User story:** As the owner, I want this spec to stay inside the installed toolchain, so that nothing new needs approval.

**Acceptance criteria:**

16.1. WHEN the spec is implemented THE SYSTEM SHALL add no entry to `dependencies` or `devDependencies` in `package.json` and make no change to `package-lock.json`. The reviewer checks this by reading `package.json`; no automated test does.

16.2. WHEN a test under `tests/boo-tique/` is read THE SYSTEM SHALL contain no JSX, and SHALL build elements with `createElement`, because `vitest.config.ts` includes only `tests/**/*.test.ts`.

16.3. WHEN the first task is run THE SYSTEM SHALL prove with a smoke test that a `.tsx` component under `components/boo-tique/` can be imported, rendered with `createElement` and `renderToStaticMarkup`, and asserted under Vitest, before any other component is written.

## 17. Overlays and dismissal

**User story:** As a viewer, I want the cookie banner, the modals and the toast to behave like real overlays, so that the demo shop looks and works like the shops the scanner will meet.

**Acceptance criteria:**

17.1. WHEN the default, ghost or equal home variant is rendered THE SYSTEM SHALL contain the cookie banner in the initial HTML as a bar fixed to the bottom of the viewport (class `bt-banner`), and WHEN a visitor activates a banner button THE SYSTEM SHALL hide the banner and store nothing.

17.2. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL contain the newsletter modal in the initial HTML as an element with `role="dialog"` and `aria-modal="true"`, with a backdrop element.

17.3. WHEN the product page is rendered THE SYSTEM SHALL contain the upsell dialog in the initial HTML as an element with `role="dialog"` and `aria-modal="true"`, with a backdrop element.

17.4. WHEN the product page is rendered THE SYSTEM SHALL contain the sold toast in the initial HTML as a `role="status"` element fixed to the bottom-left corner (class `bt-toast`) with a dismiss button.

17.5. WHEN a modal dialog opens in a browser THE SYSTEM SHALL move focus to the dialog element, which is rendered with `tabindex="-1"`, and WHEN it closes SHALL return focus to the element that had focus before.

17.6. WHEN Tab or Shift+Tab is pressed on the last or first focusable element of an open modal THE SYSTEM SHALL wrap focus inside the modal, using the pure function `nextFocusIndex`.

17.7. WHEN Escape is pressed while a modal is open THE SYSTEM SHALL close it, using the pure function `shouldCloseOnKey`.

17.8. WHEN the close button of a modal is activated THE SYSTEM SHALL close that modal.

17.9. WHEN an overlay is rendered on the server THE SYSTEM SHALL render it open, with the same markup as its first client render.

17.10. WHEN an overlay is closed THE SYSTEM SHALL remove only that overlay and its backdrop from the DOM, and its `data-testid` SHALL remain in the initial server HTML.

17.11. WHEN the Boo-tique stylesheet is read THE SYSTEM SHALL place the overlays as follows: the banner is `position: fixed` at the bottom with a height of at most 96px; each dialog is `position: fixed`, centred, at most 480px wide and at most 80vh high; the toast is `position: fixed` at 16px from the bottom and left and 320px wide; the backdrop is `rgba(42, 21, 18, 0.45)`; the stacking order from lowest to highest is banner 40, backdrop 50, dialog 60, toast 70; and `.bt-root` has a bottom padding of 112px.

17.12. WHEN every overlay is dismissed at 1280x800 THE SYSTEM SHALL leave no planted non-overlay element under an overlay, and WHEN the overlays are open THE SYSTEM SHALL keep the upsell close button and the ghost Reject button visible, because no route renders two overlays whose boxes overlap.

17.13. WHEN the coverage tests check an overlay element THE SYSTEM SHALL assert its presence by `data-testid` in the markup only, never its geometry.
