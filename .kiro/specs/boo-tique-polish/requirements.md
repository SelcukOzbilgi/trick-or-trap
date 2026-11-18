# Requirements: Boo-tique Polish

This spec fixes the 16 problems (2 high, 4 medium, 10 low) that an independent review found in the implemented `.kiro/specs/boo-tique-static/` spec. The review text is the authoritative statement of each problem. Where an owner decision differs from the review's suggested fix, this file says so.

The old spec files (`.kiro/specs/boo-tique-static/`) are not rewritten. Exactly two single lines in them change (old requirement 8.4 and one row of the old `design.md` placement table, see requirement 1). Every other old criterion that changes is listed in "Supersedes" below with its new wording or the number of the criterion that replaces it. An old criterion that is not listed still holds.

## Finding to requirement to task

| Finding | Problem | Requirements | Tasks |
|---|---|---|---|
| H1 | Honest fixed-date sale shows an expired date | 1.1 to 1.8 | 1, 2 |
| H2 | Cookie banners clip at 390px, honest "Reject all" cut off | 2.1 to 2.15 | 4, 6 |
| M1 | Phase-2 anchors give away the verdict and cannot show their trick | 3.1 to 3.13, 12.3 to 12.5 | 3, 7, 8, 9 |
| M2 | No visual hierarchy, bare buttons read as text | 4.1 to 4.27, 5.1 to 5.9 | 4, 5, 7, 8, 9 |
| M3 | Exit-intent "Not now" and "Subscribe" do nothing | 6.1 to 6.9 | 6 |
| M4 | Cart and checkout figures disagree | 7.1 to 7.14, 8.1 to 8.13 | 4, 7, 8 |
| L1 | Home page has no `<h1>` | 5.1, 5.2, 5.5 | 5 |
| L2 | Mobile grid too tight | 2.12, 2.13, 2.14 | 4 |
| L3 | Packaging switch cannot be turned off | 9.4 to 9.7 | 7 |
| L4 | Overscroll shows the dark root | 14.1 to 14.3 (not fixed, decision 9) | 4 (guard test only) |
| L5 | Old 7.6 cannot hold mid-sequence | 15.1 to 15.3 (no code change) | 10 |
| L6 | "Selling fast on all products" deviates from the research text | 12.8 to 12.10 | 3 |
| L7 | Small accessibility items (stars, row layout, accent colour) | 5.8, 9.1 to 9.3, 4.18 | 4, 5, 7 |
| L8 | Drift risk: hard-coded prices and hex literals | 7.13, 13.1 to 13.3, 10.6 | 4, 5, 6, 7, 8, 9, 10 |
| L9 | Believability and copy (cancel copy, Checkout links, banner buttons) | 10.1, 8.4, 5.10, 2.1 to 2.4 | 9, 7, 5, 6 |
| L10 | Text-only and time-only entries need notes | 12.1 to 12.7 | 3 |

## Out of scope

- Browser measurement at 390x844 or 1280x800, including real overflow, real clipping and real banner heights. This spec checks stylesheet text and server markup only.
- Real overscroll behaviour on macOS or iOS.
- Screen readers, Lighthouse and any other audit tool.
- Playwright and any browser test.
- The flows: add to cart, a working Remove, checkout steps, the cancel flow, and any state kept between pages. A later `boo-tique-flows` spec adds them.
- Page capture, `getBrowser()` and the extractor.
- Detectors and the LLM judge.
- Any new npm dependency.
- Images, photography and any image file. Product art is CSS plus inline SVG.
- Any change to an existing spec other than the two single-line edits of requirement 1 (`.kiro/specs/boo-tique-static/requirements.md` line of 8.4 and one row of `.kiro/specs/boo-tique-static/design.md`). The specs `foundation`, `foundation-fixes` and `page-capture` are not touched.
- Any edit to `app/globals.css`, the root `app/layout.tsx`, `vitest.config.ts`, the Trick or Trap dark theme or its tokens.
- Any change under `docs/research/` other than the three edits named in requirements 1 and 12: the `element` text of the entries `home-fixed-date-sale` and `product-selling-fast-badge` in `docs/research/boo-tique-ground-truth.json`, and the one row of `docs/research/dark-patterns.md` that quotes the old date.
- Fixing L4 (overscroll). See "Decisions that change a review fix".

## Decisions that change a review fix

| Finding | Review's suggested fix | What this spec does instead, and why |
|---|---|---|
| L4 | Add `body:has(.bt-root) { background: #fbf3e4 }` to `boo-tique.css`. | **Not fixed (decision 9).** The cream styles stay scoped to `.bt-root`, and the dark root layout stays untouched. Old 2.3 ("no body selector") is kept unchanged. The review's rule is recorded here as an option the owner can approve later. Old 2.10 stays as written; its "or the browser overscrolls" clause is known to hold for short pages only. |
| L6 | Add the "Selling fast" badge to every grid card, or change the research text. | The research text changes (requirement 12.8). Adding manipulative copy to every card would plant unlisted manipulative elements on the home page, which breaks the honest look-alike rule. |
| H1 | Pick a future date such as 21 Dec 2026. | The owner picked "Winter sale ends 28 Feb 2027, 23:59 UTC" and a build-time guard `DEMO_VALID_UNTIL = "2027-01-31"`. The guard compares two constants, never the clock. |
| M1 | Prefer marking phase-2 entries "not scored" plus dropping the attribute. | Both, and more: the three flag entries are rendered as ordinary shop UI that shows the end state of the trick (requirement 3). Static scanning is not expected to prove these three entries. A snapshot of one page cannot show sneak-into-basket, drip pricing across pages or a cancel maze. The later `boo-tique-flows` spec makes them real. Until then the detector and eval specs treat these three entries as "not scored" (the fixture notes in requirement 12 say so). The two honest phase-2 entries stay scored as no-flag precision checks: a static detector must return zero findings on them. |
| M3 | Mark "Not now" and "Subscribe" with `data-bt-close`. | "Not now" closes at once. "Subscribe" first replaces the dialog body with "Demo shop: nothing was sent" and closes after 1500 ms. Nothing is submitted. |
| L3 | Allow a sixth `"use client"` file, or keep the switch inert. | A sixth client component, `toggle-switch.tsx`. The server HTML keeps `aria-checked="true"`, so the planted preselection is unchanged. |
| M4 | One canonical cart state. | One shared source, `lib/boo-tique/cart.ts`. The sneaked insurance row ($4.00) is inside the cart total, because it is in the cart. Tax is 8% of the items total only. |

## Supersedes

"Old" means a criterion or rule in `.kiro/specs/boo-tique-static/`. A row marked **replaced** no longer holds. A row marked **extended** holds with the added behaviour. A row marked **clarified** holds with a narrower meaning.

| Old | Status | New wording or replacing criterion |
|---|---|---|
| 2.3 (no `:root` or `body` selector) | unchanged | Kept as written (decision 9). Requirement 14.1 adds the same rule for `html`. |
| 2.10 (overscroll) | unchanged | Not fixed, see L4 above. |
| 4.6, 4.12 (schema accepts the fixture) | extended | The entry schema also requires `detectionSignals` and `detectionNote` (12.1 to 12.3). |
| 5.7 (same `page` and `element` text in both files) | replaced | WHEN the derivation test runs THE SYSTEM SHALL compare only the eight shared fields (`id`, `page`, `route`, `element`, `pattern`, `phase`, `difficulty`, `expectedVerdict`) and the entry order, and SHALL still fail on any drift in them (12.7). The fixture has two extra fields that the research JSON does not have. The `element` text of two entries now differs from the old research text (1.6, 12.8) in both files at once. |
| 7.6 (each fixture route is in exactly one of `PENDING_ROUTES` or the route table) | replaced | "Each fixture route is either in `PENDING_ROUTES` or in the route table, and the final guard asserts `PENDING_ROUTES` is empty and every fixture route is covered" (15.1, 15.2). This is what `tests/boo-tique/coverage.test.ts` already does. No code change. |
| 8.1 (grid card shows a price) | clarified | The price text is `formatUsd(priceUsd * 100)`, for example "$24.00" (5.9). |
| 8.4 (fixed-date text) | replaced | "Winter sale ends 28 Feb 2027, 23:59 UTC" (1.1). The one line in the old file changes (1.8). |
| 8.9 and 9.3 ("promo block" absent in the ghost, equal and exit-intent variants) | clarified | "Promo block" means the `<div class="bt-promo">` that holds the three urgency elements. The hero band with the `<h1>` and the tagline is present in every home variant (5.1, 5.3, 5.4). |
| 10.1 (stock text "Only N left!", N generated) | extended | N comes from `STOCK_VALUES` = 2, 4, 5, 6, 7, 8, 9 (11.1). |
| 11.1 (cart lists two lines and an items total of $40.00 that sums the product lines only) | replaced | Cart lines, extras, shipping, insurance, tax and total come from the shared source (7.x, 8.1, 8.2). Items stay $40.00. |
| 11.9 (checkout default: Items $40.00, preview fees, Total $49.99) | replaced | Default checkout summary shows Items, Extras, Shipping, Insurance, Tax, Handling, Haunting fee, Total. Total is $77.68 (8.6, 8.7). |
| 11.10 (honest checkout: items $40.00, shipping $4.00, tax $3.20, total $47.20) | replaced | Honest checkout repeats the cart figures exactly. Total is $67.69 (8.5, 8.7). |
| 11.12 (cart shows an estimated tax of $3.20) | extended | Still "Estimated tax $3.20", and the cart now also shows Extras, Shipping, Insurance and Total (8.2). |
| 12.1 (membership section holds the preview of 13.3) | replaced | The membership area holds the cancel section of 3.9. |
| 12.2 (one inert "Cancel plan" button) | extended | The button has the class `bt-button` (4.20) and stays inert. |
| 13.1 (insurance `<li>` with label "Static preview of a later flow") | replaced | 3.1 to 3.5 (ordinary cart row, no label, no anchor). |
| 13.2 (handling and haunting `<li>` with the label) | replaced | 3.6 to 3.8 (ordinary summary rows). |
| 13.3 (cancel `<section>` with the label, "must call the shop") | replaced | 3.9, 3.10 and 10.1. |
| 13.4 (no link, button or input in a phase-2 anchor) | replaced | The cart insurance row has one `Remove` button (3.3). The checkout summary and the cancel section have no link, button or input (3.7, 3.9). |
| 13.5 (word rule for insurance, handling, haunting, phone) | replaced | 8.10 (cart and checkout) and 10.4 (account). The cart now legitimately contains the word "insurance". |
| 14.4 (stock between 2 and 9) | replaced | 11.1 to 11.3 (2 to 9 without 3). The viewer range 8 to 48 is unchanged (11.4). |
| 17.8 (a modal's close button closes it) | extended | "Not now" also closes the exit-intent modal, and "Subscribe" confirms then closes it (6.1 to 6.9). The upsell stays as it was. |
| 17.11 (banner at most 96px high, `.bt-root` bottom padding 112px) | replaced | Those two values hold above 640px. At or below 640px the banner wraps and the padding is 176px (2.7 to 2.15). Banner height budget: at most 96px at widths 641px and up, at most 160px below. |
| Old `design.md`: "five small `"use client"` components" | replaced | Six: `hero-countdown`, `sold-toast`, `club-timer`, `cookie-banner`, `overlay-dialog`, `toggle-switch` (9.7). |
| Old `tasks.md` rule: only five `"use client"` files allowed, and the `ALLOWED_USE_CLIENT` list in `tests/boo-tique/safety.test.ts` | replaced | Six files (9.7). Task 7 updates the test. |
| Old `design.md` section "Phase-2 previews", and the three placement-table rows for `cart-insurance-sneaked`, `checkout-handling-fees-drip` and `account-cancel-five-screens` | replaced | Requirement 3 and the markup tables in this spec's `design.md`. |
| Old `design.md` page content (cart, checkout default, checkout honest) | replaced | Requirement 8. |
| Old `design.md`: `stockLeft = 2 + floor(random() * 8)` | replaced | `STOCK_VALUES[floor(random() * 7)]` (11.2). |
| Old `design.md` and `styles.test.ts`: banner `max-height: 96px` and `.bt-root` `padding-bottom: 112px` read from the whole stylesheet | clarified | They are read from the base rules. The test helper splits the single media block from the base rules (2.7). |

## 1. Honest fixed-date sale stays in the future (H1)

**User story:** As a detector author, I want the honest fixed-date look-alike to show a real future date that cannot expire silently, so that a date-aware detector or judge never has a reason to flag it.

**Acceptance criteria:**

1.1. WHEN the default home page is rendered THE SYSTEM SHALL contain `home-fixed-date-sale` on an element whose text is exactly "Winter sale ends 28 Feb 2027, 23:59 UTC".

1.2. WHEN `lib/boo-tique/content.ts` is read THE SYSTEM SHALL export `FIXED_SALE_TEXT` equal to "Winter sale ends 28 Feb 2027, 23:59 UTC" and `DEMO_VALID_UNTIL` equal to `"2027-01-31"`.

1.3. WHEN the guard test parses the day, the three-letter English month and the year out of `FIXED_SALE_TEXT` THE SYSTEM SHALL find a calendar date strictly later than `DEMO_VALID_UNTIL`.

1.4. WHEN `FIXED_SALE_TEXT` does not match `/^Winter sale ends (\d{1,2}) ([A-Z][a-z]{2}) (\d{4}), 23:59 UTC$/` with a month from Jan to Dec THE SYSTEM SHALL fail the guard test instead of skipping it.

1.5. WHEN the guard test runs THE SYSTEM SHALL NOT read the system clock.

1.6. WHEN the `element` text of `home-fixed-date-sale` is read in `docs/research/boo-tique-ground-truth.json` and in `tests/fixtures/boo-tique-ground-truth.json` THE SYSTEM SHALL equal "'Winter sale ends 28 Feb 2027, 23:59 UTC' fixed date, same on reload" in both files, and the derivation test SHALL pass.

1.7. WHEN `docs/research/dark-patterns.md` is read THE SYSTEM SHALL quote "Winter sale ends 28 Feb 2027, 23:59 UTC" in the home fixed-date row and SHALL contain neither "31 Oct 2026" nor "Halloween sale".

1.8. WHEN the old requirement 8.4 line in `.kiro/specs/boo-tique-static/requirements.md` and the `home-fixed-date-sale` row of the placement table in `.kiro/specs/boo-tique-static/design.md` are read THE SYSTEM SHALL quote "Winter sale ends 28 Feb 2027, 23:59 UTC", and neither file SHALL contain "31 Oct 2026" or "Halloween sale". These two lines are the only edits to the old spec.

## 2. Banners and grid fit a phone (H2, L2, L9)

**User story:** As a judge who opens the demo on a phone, I want the cookie banners to wrap and the product grid to fit, so that both equal buttons stay visible and nothing is clipped.

**Acceptance criteria:**

2.1. WHEN any cookie banner variant is rendered THE SYSTEM SHALL output the paragraph "We use cookies to remember your basket and to count visits." as the first child of the banner root and exactly one `<div class="bt-banner-actions">` as its second and last child.

2.2. WHEN the default banner is rendered THE SYSTEM SHALL put the "options" link and then the "Accept all" button, and nothing else, inside `.bt-banner-actions`.

2.3. WHEN the ghost banner is rendered THE SYSTEM SHALL put the "Accept all" button and then the "Reject" button, and nothing else, inside `.bt-banner-actions`.

2.4. WHEN the equal banner is rendered THE SYSTEM SHALL put the "Accept all" button and then the "Reject all" button, and nothing else, inside `.bt-banner-actions`.

2.5. WHEN any banner variant is rendered THE SYSTEM SHALL keep the `style` attributes of old criteria 15.1, 15.2, 15.3 and 15.6 unchanged, and the banner root SHALL keep `class="bt-banner"` exactly.

2.6. WHEN the base rules of `app/boo-tique/boo-tique.css` are read THE SYSTEM SHALL declare `.bt-banner-actions` with `display: flex`, `gap: 8px`, `align-items: center` and `flex: none`.

2.7. WHEN `app/boo-tique/boo-tique.css` is read THE SYSTEM SHALL contain exactly one `@media` block, and its query SHALL be `(max-width: 640px)`.

2.8. WHEN the media block is read THE SYSTEM SHALL declare `.bt-banner` with `flex-wrap: wrap` and `max-height: none`.

2.9. WHEN the media block is read THE SYSTEM SHALL declare `.bt-banner p` with `flex-basis: 100%`, `font-size: 14px` and `margin: 0`.

2.10. WHEN the media block is read THE SYSTEM SHALL declare `.bt-banner-actions` with `flex-wrap: wrap`.

2.11. WHEN the media block is read THE SYSTEM SHALL declare `.bt-root` with `padding-bottom: 176px`.

2.12. WHEN the media block is read THE SYSTEM SHALL declare `.bt-grid` with `grid-template-columns: repeat(2, minmax(0, 1fr))`.

2.13. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-grid` with `grid-template-columns: repeat(3, minmax(0, 1fr))`, `.bt-banner` with `max-height: 96px` and `.bt-root` with `padding-bottom: 112px`.

2.14. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-card` with `min-width: 0` and `.bt-root` with `overflow-wrap: break-word`.

2.15. WHEN the width of the two equal banner buttons is computed from `EQUAL_BUTTON_STYLE.minWidth` (160px), the 8px gap of 2.6 and the 16px banner side padding THE SYSTEM SHALL give 2 x 160 + 8 = 328px, which is at most 390 - 2 x 16 = 358px.

## 3. Phase-2 flag elements look like ordinary shop UI (M1)

**User story:** As a detector author, I want the three phase-2 flag elements to look exactly like their honest neighbours, so that a judge or a DOM detector cannot learn "labelled preview means flag".

Static scanning is not expected to prove these three entries. A snapshot of one page cannot show sneak-into-basket, drip pricing across pages or a cancel maze. The later `boo-tique-flows` spec makes them real. Until then the detector and eval specs treat `cart-insurance-sneaked`, `checkout-handling-fees-drip` and `account-cancel-five-screens` as "not scored" (requirement 12.4, 12.5). The fixture keeps `phase: 2` for all five phase-2 entries (old 4.5 and 13.6 hold).

**Acceptance criteria:**

3.1. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-insurance-sneaked` once, on the third `<li class="bt-line-row">` of the cart lines `<ul class="bt-list">`, after the Ghost Pepper Candle line and the Moon-Phase Mug line.

3.2. WHEN the cart page is rendered THE SYSTEM SHALL give each of the three cart lines the same child sequence: a `<span>` with the name, a `<span class="bt-price">` with the price, and a `<button>`; the insurance line shows "Insurance" and "$4.00".

3.3. WHEN the cart page is rendered THE SYSTEM SHALL give each of the three cart lines a `<button type="button" class="bt-button bt-button--quiet" aria-label="Remove <name>">` with the text "Remove", with no handler. The Remove buttons are inert, because cart state belongs to the later flows spec, and they are listed in the design's table of documented inert controls.

3.4. WHEN the cart page is rendered THE SYSTEM SHALL give the `cart-insurance-sneaked` opening tag exactly the attribute names of the Ghost Pepper Candle line's opening tag plus `data-testid`.

3.5. WHEN the cart page is rendered THE SYSTEM SHALL give the `cart-insurance-sneaked` element and every element inside it no attribute that starts with `data-`, other than the one `data-testid` on the element itself.

3.6. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL contain `checkout-handling-fees-drip` once, on the order-summary `<dl class="bt-list">`, which shows the rows "Handling $6.99" and "Haunting fee $3.00" (8.6).

3.7. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL render the Handling and Haunting fee rows as `<div class="bt-variant-row"><dt>…</dt><dd class="bt-price">…</dd></div>`, the same markup as every other summary row, and the `<dl>` SHALL contain no `<a`, `<button` or `<input`.

3.8. WHEN `/boo-tique/checkout` and `/boo-tique/checkout?flow=honest` are rendered THE SYSTEM SHALL give the two summary `<dl>` opening tags the same attribute names (`class` and `data-testid`) and no `data-` attribute other than `data-testid`.

3.9. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL contain `account-cancel-five-screens` once, on `<section class="bt-card" aria-labelledby="bt-cancel-heading">` that holds `<h2 id="bt-cancel-heading">Cancel membership</h2>` and `<p>To cancel, call us during opening hours.</p>`, with no link, button or input and no phone number.

3.10. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL give the cancel section exactly the attribute names of the plan card's opening tag plus `data-testid`, and no `data-` attribute other than `data-testid`.

3.11. WHEN any fixture route is rendered THE SYSTEM SHALL contain none of the strings `data-anchor`, `phase-2`, `later flow` and `static preview`, matched case-insensitively on the full markup, and the visible text SHALL not contain "Static preview of a later flow".

3.12. WHEN the directories `app/boo-tique/`, `components/boo-tique/` and `lib/boo-tique/` are read THE SYSTEM SHALL contain no file `components/boo-tique/phase2-preview.tsx` and no source text `data-anchor`, `Phase2Preview`, `PHASE2_PREVIEW_LABEL`, `Static preview` or `later flow`.

3.13. WHEN any fixture route is rendered THE SYSTEM SHALL contain no `class` or `id` attribute value that contains `urgency`, `scarcity`, `activity`, `shaming`, `preselect`, `interference`, `sneak` or `drip`, and no selector in `boo-tique.css` SHALL contain those words.

## 4. Visual hierarchy and real buttons (M2)

**User story:** As a viewer, I want the Boo-tique to look like a finished small shop with headings, a hero and real buttons, so that it reads as a believable target and the honest cancel button is clearly visible.

**Acceptance criteria:**

4.1. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root h1` with `font-size: 40px`, `font-weight: 700` and `line-height: 1.1`.

4.2. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root h2` with `font-size: 28px`, `font-weight: 600` and `line-height: 1.2`.

4.3. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root h3` with `font-size: 20px`, `font-weight: 600` and `line-height: 1.25`.

4.4. WHEN the base rules are read THE SYSTEM SHALL keep the heading font family `var(--font-cormorant)` on `.bt-root h1`, `.bt-root h2` and `.bt-root h3` (the existing combined rule stays).

4.5. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-hero` with `width: 100%`, `padding: 32px`, `border-radius: 12px`, `background: var(--bt-blood)` and `color: #ffffff`.

4.6. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-hero h1` with `color: #ffffff` and `.bt-hero .bt-hero-tagline` with `font-size: 18px`, `color: var(--bt-paper)` and `margin: 0`.

4.7. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-hero .bt-promo p` with `font-size: 28px`, `font-weight: 600`, `line-height: 1.2` and `margin: 0`, so the countdown line, the rolling-midnight line and the fixed-date line share one font size, one weight and one colour, and size alone does not separate the honest fixed-date twin from the fake lines.

4.8. WHEN the base rules are read THE SYSTEM SHALL declare the five classes `.bt-tile--candle`, `.bt-tile--hoodie`, `.bt-tile--mug`, `.bt-tile--tote` and `.bt-tile--quill`, each with a `background` that is a `linear-gradient(` of `var(--bt-*)` tokens and `color-mix(` of them, with five different values and no hex literal.

4.9. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button` with `display: inline-flex`, `align-items: center`, `justify-content: center`, `padding: 12px 24px`, `min-height: 44px`, `border: 2px solid var(--bt-blood)`, `border-radius: 8px`, `background: var(--bt-blood)`, `color: #ffffff`, `font-weight: 600`, `text-decoration: none` and `cursor: pointer`.

4.10. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button:hover` with `background: var(--bt-blood-dark)` and `border-color: var(--bt-blood-dark)`.

4.11. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button:focus-visible` with `outline: 3px solid var(--bt-ink)` and `outline-offset: 2px`.

4.12. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button:disabled` with `background: var(--bt-paper)`, `border-color: var(--bt-muted)`, `color: var(--bt-muted)` and `cursor: not-allowed`.

4.13. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button--secondary` with `background: transparent`, `color: var(--bt-blood)` and `border-color: var(--bt-blood)`. No markup uses this class yet; it is defined for later pages.

4.14. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button--quiet` with `background: transparent`, `border-color: transparent`, `color: var(--bt-blood)`, `padding: 8px 12px` and `font-weight: 500`.

4.15. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button--quiet:hover` with `text-decoration: underline`, `background: transparent` and `border-color: transparent`.

4.16. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root .bt-button--secondary:hover` with `background: var(--bt-paper)`.

4.17. WHEN `boo-tique.css` is read THE SYSTEM SHALL place `.bt-root .bt-button--secondary` and `.bt-root .bt-button--quiet` after `.bt-root .bt-button`, `.bt-root .bt-button:disabled` after `.bt-root .bt-button:hover`, and the two modifier `:hover` rules after `.bt-root .bt-button:hover`, in file order, and SHALL write every button-class selector with the `.bt-root` prefix so it beats `.bt-root a`.

4.18. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-root` with `accent-color: var(--bt-blood)`.

4.19. WHEN `/boo-tique/checkout` or `/boo-tique/checkout?flow=honest` is rendered THE SYSTEM SHALL render "Place order" as `<button type="button" disabled class="bt-button">`.

4.20. WHEN `/boo-tique/account/subscription?plan=honest` is rendered THE SYSTEM SHALL render "Cancel plan" as `<button type="button" class="bt-button">`, as the only button on its card, with a class that does not contain `bt-button--quiet`, with no retention copy and no discount wording.

4.21. WHEN the product page is rendered THE SYSTEM SHALL give the sold-toast dismiss button the classes `bt-toast-dismiss bt-button bt-button--quiet`.

4.22. WHEN the cart page is rendered THE SYSTEM SHALL render the cart "Checkout" link as `<a class="bt-button" href="/boo-tique/checkout">`.

4.23. WHEN any fixture route is rendered THE SYSTEM SHALL give every `<button>` or `<a>` that carries a `style` attribute a `class` value that contains no `bt-button`, so the new classes are never applied to the planted inline-styled elements.

4.24. WHEN the planted inline styles are read THE SYSTEM SHALL keep every value of the old "Exact style values" table unchanged (the style constants in `lib/boo-tique/styles.ts` are not edited).

4.25. WHEN the colours of the new classes are resolved to the palette and passed to `contrastRatio` THE SYSTEM SHALL give at least 4.5 for these text pairs: `#ffffff` on `PALETTE.blood` (`.bt-button`, `.bt-hero`), `PALETTE.paper` on `PALETTE.blood` (tagline), `PALETTE.blood` on `PALETTE.paper` (secondary and quiet buttons on a card), `PALETTE.blood` on `PALETTE.bg` (quiet button on the page), and `PALETTE.muted` on `PALETTE.paper` (disabled button); and at least 3 for `PALETTE.ink` on `PALETTE.bg` (focus outline).

4.26. WHEN the colour literals of `boo-tique.css` outside the seven token declarations are read THE SYSTEM SHALL contain only `#ffffff`, in lower case.

4.27. WHEN `boo-tique.css` is read THE SYSTEM SHALL start every selector with a `.bt-` class, as old criterion 2.3 and the existing stylesheet test require.

## 5. Home page outline, product tiles and accessibility basics (M2, L1, L7, L9)

**User story:** As a visitor, I want the home page to start with a title and a hero, and the product cards to show a picture and readable stars, so that the page has a clear outline.

**Acceptance criteria:**

5.1. WHEN any home variant is rendered THE SYSTEM SHALL contain exactly one `<h1>`, inside `<section class="bt-hero" aria-labelledby="bt-hero-heading">`, with the markup `<h1 id="bt-hero-heading">The Boo-tique</h1>`.

5.2. WHEN any home variant is rendered THE SYSTEM SHALL contain `<p class="bt-hero-tagline">Gothic goods for living ghouls</p>` directly after the `<h1>`.

5.3. WHEN the default home variant is rendered THE SYSTEM SHALL contain one `<div class="bt-promo">` inside `.bt-hero`, after the tagline, whose three `<p>` children are in this order: `home-hero-countdown-restart`, `home-rolling-midnight-text`, `home-fixed-date-sale`.

5.4. WHEN the ghost, equal or exit-intent home variant is rendered THE SYSTEM SHALL contain no `bt-promo` and none of the three urgency entry ids, and SHALL still contain the hero band with the `<h1>` and the tagline.

5.5. WHEN any home variant is rendered THE SYSTEM SHALL place the `<h1>` before the `<h2 id="bt-products-heading">Shop the crypt</h2>` in document order.

5.6. WHEN the home grid is rendered THE SYSTEM SHALL give each of the six cards `<div class="bt-tile bt-tile--ICON" aria-hidden="true">` with one inline `<svg>` inside, where ICON comes from `PRODUCT_ICONS` (candle for Cursed Candle Set and Ghost Pepper Candle, hoodie, mug, tote and quill for the other four), so five different modifier classes appear.

5.7. WHEN a product tile is rendered THE SYSTEM SHALL contain no `<img` and no external URL, and the source of `components/boo-tique/product-grid.tsx` SHALL contain no hex literal (the SVG uses `currentColor` and `PALETTE`).

5.8. WHEN a star rating is rendered THE SYSTEM SHALL output `<p class="bt-muted" role="img" aria-label="Rated N out of 5">` followed by the star characters, instead of an `aria-label` on a bare `<p>`.

5.9. WHEN a grid card or the product page shows a price THE SYSTEM SHALL output `formatUsd(priceUsd * 100)`, for example "$24.00" on the home grid and "$18.00" on the product page.

5.10. WHEN the shell is rendered THE SYSTEM SHALL list the navigation links in this order: Home `/boo-tique`, Cart `/boo-tique/cart`, Checkout `/boo-tique/checkout`, Club `/boo-tique/club`, Account `/boo-tique/account/subscription`, all as plain relative anchors.

5.11. WHEN the product page is rendered THE SYSTEM SHALL render its tile with the same `bt-tile bt-tile--candle` classes as the Ghost Pepper Candle card and keep the single `<h1>` "Ghost Pepper Candle".

## 6. Exit-intent modal closes (M3)

**User story:** As a visitor, I want "Not now" to close the newsletter modal and "Subscribe" to confirm and close it, so that the honest-looking decline does not look broken.

**Acceptance criteria:**

6.1. WHEN `lib/boo-tique/overlay.ts` is read THE SYSTEM SHALL export `EXIT_CONFIRM_DELAY_MS` equal to 1500 and `EXIT_CONFIRM_TEXT` equal to "Demo shop: nothing was sent".

6.2. WHEN `dialogClickAction(target)` is called with `null` or with an object whose `closest` returns `null` for both selectors THE SYSTEM SHALL return `"ignore"`.

6.3. WHEN `dialogClickAction` is called with an object whose `closest("[data-bt-confirm]")` returns a non-null value THE SYSTEM SHALL return `"confirm-then-close"`, even when `closest("[data-bt-close]")` also returns a non-null value.

6.4. WHEN `dialogClickAction` is called with an object whose `closest("[data-bt-close]")` returns a non-null value and whose `closest("[data-bt-confirm]")` returns `null` THE SYSTEM SHALL return `"close"`.

6.5. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL give the "Not now" button the attribute `data-bt-close` and no `data-bt-confirm`, and the "Subscribe" button both `data-bt-close` and `data-bt-confirm`.

6.6. WHEN the product page is rendered THE SYSTEM SHALL give the "Add crypt keeper bundle" button and the tiny "x" close button no `data-bt-close` and no `data-bt-confirm`. The tiny close stays as it is (it is the planted trick).

6.7. WHEN a visitor clicks "Not now" THE SYSTEM SHALL close the dialog at once and remove its backdrop; WHEN a visitor clicks "Subscribe" THE SYSTEM SHALL replace the dialog body with the text "Demo shop: nothing was sent" and close the dialog `EXIT_CONFIRM_DELAY_MS` later; WHEN Escape or the "×" button is used THE SYSTEM SHALL close the dialog at once as before. Browser behaviour is checked by the later capture spec.

6.8. WHEN `/boo-tique?modal=exit-intent` is rendered THE SYSTEM SHALL NOT contain "Demo shop: nothing was sent" in its markup, because the confirmation exists only after a click.

6.9. WHEN `components/boo-tique/overlay-dialog.tsx` and `components/boo-tique/exit-intent-modal.tsx` are read THE SYSTEM SHALL contain none of `fetch(`, `localStorage`, `sessionStorage`, `document.cookie`, `<form` and `XMLHttpRequest`, and `overlay-dialog.tsx` SHALL import `dialogClickAction` and `EXIT_CONFIRM_DELAY_MS` from `@/lib/boo-tique/overlay`.

## 7. One source for prices, lines and totals (M4, L8)

**User story:** As a maintainer, I want every price, line and total to come from one source, so that the cart and both checkout variants cannot drift apart.

**Acceptance criteria:**

7.1. WHEN `lib/boo-tique/cart.ts` is read THE SYSTEM SHALL export `formatUsd`, `CART`, `CART_OPTIONS`, `INSURANCE`, `DRIP_FEES`, `TAX_RATE_PERCENT`, `ACCOUNT_PLANS`, `addOnLabel`, `plainLabel`, `taxCents`, `summaryRows`, `cartTotals` and `checkoutTotals`, with the signatures in `design.md`.

7.2. WHEN `formatUsd` is called THE SYSTEM SHALL return "$18.00" for 1800, "$0.00" for 0, "$0.05" for 5, "$1234.56" for 123456 and "-$2.50" for -250, and SHALL throw a `RangeError` for a value that is not an integer.

7.3. WHEN `CART.lines` is read THE SYSTEM SHALL contain Ghost Pepper Candle at 1800 cents and Moon-Phase Mug at 2200 cents, taken from `PRODUCTS`, so the items total is 4000 cents.

7.4. WHEN `CART_OPTIONS` is read THE SYSTEM SHALL contain: protection "Add Raven Shipping Protection" 499; gift wrap "Gift wrap" 200; packaging "Priority coffin packaging" 250; warranty options "No warranty" 0, "Silver Curse Warranty" 300 and "Gold Extended Curse Warranty" 900; shipping options "Standard coffin post" 400, "Express bat post" 900 and "Overnight spirit post" 1500.

7.5. WHEN `CART.extras` is read THE SYSTEM SHALL contain exactly protection, the Gold warranty and packaging (the three preselected extras), so the extras total is 1649 cents, and `CART.shipping` SHALL be the Standard option (400 cents).

7.6. WHEN `INSURANCE` is read THE SYSTEM SHALL be named "Insurance" at 400 cents, and WHEN totals are computed THE SYSTEM SHALL include it in the cart total because it is a row in the cart.

7.7. WHEN `taxCents` is called THE SYSTEM SHALL return `Math.round(itemsCents * TAX_RATE_PERCENT / 100)` with `TAX_RATE_PERCENT` equal to 8, so `taxCents(4000)` is 320. Extras, shipping, insurance and fees are not taxed.

7.8. WHEN `DRIP_FEES` is read THE SYSTEM SHALL contain "Handling" at 699 cents and "Haunting fee" at 300 cents.

7.9. WHEN `summaryRows("cart")` is called THE SYSTEM SHALL return these rows in order, as key, label and cents: items "Items" 4000; extras "Extras" 1649; shipping "Shipping" 400; insurance "Insurance" 400; tax "Estimated tax" 320; total "Total" 6769.

7.10. WHEN `summaryRows("checkout-honest")` is called THE SYSTEM SHALL return the rows of 7.9 with the tax label "Tax"; WHEN `summaryRows("checkout-default")` is called THE SYSTEM SHALL return the rows of `"checkout-honest"` with two rows inserted before the total, handling "Handling" 699 and haunting "Haunting fee" 300, and the total "Total" 7768.

7.11. WHEN `addOnLabel` is called THE SYSTEM SHALL return "<name> +<price>" for a non-zero price and "<name> <price>" for a zero price; WHEN `plainLabel` is called THE SYSTEM SHALL return "<name> <price>". Results: "Add Raven Shipping Protection +$4.99", "Gift wrap +$2.00", "Priority coffin packaging +$2.50", "No warranty $0.00", "Silver Curse Warranty +$3.00", "Gold Extended Curse Warranty +$9.00", "Standard coffin post $4.00", "Express bat post $9.00", "Overnight spirit post $15.00".

7.12. WHEN the rows of any summary view are summed, excluding the total row, THE SYSTEM SHALL equal the total row; `cartTotals().totalCents` SHALL be 6769, `checkoutTotals("honest").totalCents` SHALL be 6769 and `checkoutTotals("default").totalCents` SHALL be 7768.

7.13. WHEN the `.tsx` files under `app/boo-tique/` and `components/boo-tique/` are read, with comments removed, THE SYSTEM SHALL contain no `$` immediately followed by a digit.

7.14. WHEN `ACCOUNT_PLANS` is read THE SYSTEM SHALL contain "Midnight Club Monthly" at 999 cents and "Moonlight Basic" at 499 cents, and the account page SHALL show them as "<name>, <formatUsd>/month".

## 8. Cart and checkout render from the shared source (M4, L9)

**User story:** As a detector author, I want the cart and both checkout variants to carry the same figures, so that a cart-to-checkout comparison sees only the planted fees.

**Acceptance criteria:**

8.1. WHEN the cart page is rendered THE SYSTEM SHALL list the three lines of 3.1 with the prices "$18.00", "$22.00" and "$4.00", and SHALL render the extras card from `CART_OPTIONS` with the labels of 7.11.

8.2. WHEN the cart page is rendered THE SYSTEM SHALL show a card headed "Summary" that holds `<dl class="bt-list" data-testid="bt-cart-summary">` with the rows of `summaryRows("cart")`, each rendered as the text "<label> <price>" (for example "Items $40.00", "Estimated tax $3.20", "Total $67.69").

8.3. WHEN the cart page is rendered THE SYSTEM SHALL show the text "Total $67.69".

8.4. WHEN the cart page is rendered THE SYSTEM SHALL show the link of 4.22 with the text "Checkout" inside the summary card, after the `<dl>`.

8.5. WHEN `/boo-tique/checkout?flow=honest` is rendered THE SYSTEM SHALL contain `checkout-consistent-shipping-tax` once, on a `<dl class="bt-list">` whose rows equal `summaryRows("checkout-honest")`, and every row except tax SHALL have the same label and the same price as the cart summary row with the same key.

8.6. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL contain `checkout-handling-fees-drip` once, on a `<dl class="bt-list">` whose rows equal `summaryRows("checkout-default")`, so removing the Handling and Haunting fee rows from it leaves the honest rows, and its total differs from the honest total by exactly 999 cents.

8.7. WHEN the checkout views are rendered THE SYSTEM SHALL show "Total $67.69" on the honest view and "Total $77.68" on the default view.

8.8. WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL keep the newsletter section with `checkout-newsletter-prechecked` (old 11.8), and WHEN `/boo-tique/checkout?flow=honest` is rendered THE SYSTEM SHALL contain no checked control and no input (old 11.11).

8.9. WHEN the cart page is rendered THE SYSTEM SHALL still show exactly four preselected controls: the protection checkbox, the Gold warranty radio, the packaging switch and the Standard shipping radio (old 11.7).

8.10. WHEN the cart page and `/boo-tique/checkout?flow=honest` are rendered THE SYSTEM SHALL contain none of the words handling, haunting and phone in the visible text, and WHEN `/boo-tique/checkout` is rendered THE SYSTEM SHALL contain none of them in the visible text outside the `checkout-handling-fees-drip` element. The word "insurance" is allowed in the cart line and in the summary row of the cart and both checkout views.

8.11. WHEN the cart or a checkout view is rendered THE SYSTEM SHALL render no `<form`, no text input and no card, payment or address field (old 3.5, 3.6, 1.8 hold).

8.12. WHEN a cart or checkout view is rendered twice THE SYSTEM SHALL output identical markup.

8.13. WHEN a cart or checkout view is rendered THE SYSTEM SHALL show every figure as `formatUsd` of the cents in the shared source, so the rendered text of each summary row equals "<label> <formatUsd(cents)>".

## 9. Choice rows and the packaging switch (L3, L7)

**User story:** As a visitor, I want each checkbox, radio and switch next to its label, and the packaging switch to turn off when I click it, so that the cart looks and feels real.

**Acceptance criteria:**

9.1. WHEN the cart extras card is rendered THE SYSTEM SHALL render each checkbox and radio row as `<label class="bt-choice-row">` with the `<input>` first and the label `<span>` after it.

9.2. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-choice-row` with `display: flex`, `align-items: center`, `justify-content: flex-start`, `gap: 12px`, `padding: 8px 12px`, `border: 1px solid var(--bt-line)` and `border-radius: 8px`, and `.bt-choice-row input` with `flex: none`, `width: 20px`, `height: 20px` and `margin: 0`.

9.3. WHEN the base rules are read THE SYSTEM SHALL declare `.bt-line-row` with `display: grid`, `grid-template-columns: minmax(0, 1fr) auto auto`, `align-items: center`, `gap: 12px`, `padding: 8px 12px`, `border: 1px solid var(--bt-line)` and `border-radius: 8px`.

9.4. WHEN the cart extras card is rendered THE SYSTEM SHALL render the packaging row as `<div class="bt-choice-row">` with the label `<span id="bt-cart-packaging-label">` first and the switch button after it.

9.5. WHEN the cart page is rendered THE SYSTEM SHALL contain `cart-packaging-switch-on` once, on `<button type="button" role="switch" aria-checked="true" aria-labelledby="bt-cart-packaging-label" class="bt-toggle">` with one `<span class="bt-toggle-knob">`, the same server markup as before.

9.6. WHEN a visitor clicks the packaging switch in a browser THE SYSTEM SHALL flip its `aria-checked` value and change no figure on the page, store nothing and send nothing.

9.7. WHEN the files under `components/boo-tique/` that start with `"use client"` are listed THE SYSTEM SHALL name exactly these six: `club-timer.tsx`, `cookie-banner.tsx`, `hero-countdown.tsx`, `overlay-dialog.tsx`, `sold-toast.tsx`, `toggle-switch.tsx`.

9.8. WHEN a cart add-on control (checkbox, radio or switch) is changed in a browser THE SYSTEM SHALL change no figure in the summary, because the cart shows fixed demo contents (old 1.6 holds). This inert effect is listed in the design's table of documented inert controls.

## 10. Account copy and the visible cancel button (M2, L9)

**User story:** As a visitor, I want the cancel section to read like a shop and the honest cancel button to be easy to see, so that the honest twin is not mistaken for a hidden control.

**Acceptance criteria:**

10.1. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL show the sentence "To cancel, call us during opening hours." in the cancel section, with no phone number and no digit.

10.2. WHEN `/boo-tique/account/subscription` is rendered THE SYSTEM SHALL show the plan "Midnight Club Monthly, $9.99/month" from `ACCOUNT_PLANS`.

10.3. WHEN `/boo-tique/account/subscription?plan=honest` is rendered THE SYSTEM SHALL show "Moonlight Basic, $4.99/month" from `ACCOUNT_PLANS` and the button of 4.20.

10.4. WHEN either account view is rendered THE SYSTEM SHALL contain none of the words insurance, handling, haunting and phone anywhere in its visible text.

10.5. WHEN `/boo-tique/account/subscription?plan=honest` is rendered THE SYSTEM SHALL contain none of "call us", "call the shop", "discount", "% off", "stay", "before you go" and "offer" in its visible text, matched case-insensitively, and no phone number.

10.6. WHEN `components/boo-tique/account-plans.tsx` is read THE SYSTEM SHALL contain no `$` immediately followed by a digit (7.13).

## 11. The per-load stock never equals the real inventory (decision 8a)

**User story:** As a detector author, I want the fake per-load stock value never to equal the honest twin's real "3 left", so that a value match across loads cannot confuse the two.

**Acceptance criteria:**

11.1. WHEN `lib/boo-tique/per-load.ts` is read THE SYSTEM SHALL export `STOCK_VALUES` equal to `[2, 4, 5, 6, 7, 8, 9]`, built as the integers 2 to 9 without `INVENTORY["travel-tin"]`.

11.2. WHEN `perLoadValues(random)` is called THE SYSTEM SHALL return `stockLeft` equal to `STOCK_VALUES[floor(draw * 7)]` for the first draw, and `viewers` equal to `8 + floor(draw * 41)` for the second draw.

11.3. WHEN `perLoadValues` is called with the draws `i / 10000` for i from 0 to 9999 and with 0.999999 THE SYSTEM SHALL never return a `stockLeft` equal to `INVENTORY["travel-tin"]` and SHALL return every value of `STOCK_VALUES` at least once.

11.4. WHEN `perLoadValues` is called with a draw of 0 THE SYSTEM SHALL return stock 2 and viewers 8, and with 0.999999 SHALL return stock 9 and viewers 48 (old 14.5 holds).

11.5. WHEN the product page is rendered THE SYSTEM SHALL keep "3 left" in the Travel tin row unchanged (old 10.5 holds), and SHALL show "Only N left!" with N from `STOCK_VALUES`.

## 12. Ground-truth documentation, the selling-fast text and the test-id rule (L6, L10, M1)

**User story:** As a detector author, I want each fixture entry to say which signal a detector may use and what caveat applies, so that the detector and eval specs score only what a snapshot can show.

**Acceptance criteria:**

12.1. WHEN `GroundTruthEntrySchema` in `lib/boo-tique/ground-truth.ts` parses an entry THE SYSTEM SHALL require `detectionSignals`, a non-empty array of unique values from `"text"`, `"attribute"`, `"style"`, `"reload-variance"`, `"timing"`, `"cross-page"` and `"not-static"`, and `detectionNote`, a string of at least 20 characters after trimming.

12.2. WHEN the fixture file is parsed THE SYSTEM SHALL give every one of the 30 entries a non-empty `detectionSignals` list and a `detectionNote`, with the values listed in `design.md`.

12.3. WHEN an entry has the signal `"not-static"` THE SYSTEM SHALL require that its signals are exactly `["not-static"]` and that its note starts with "Not scored:", and WHEN a note starts with "Not scored:" THE SYSTEM SHALL require the signals `["not-static"]`.

12.4. WHEN the fixture is read THE SYSTEM SHALL carry the signal `"not-static"` on exactly three entries: `cart-insurance-sneaked`, `checkout-handling-fees-drip` and `account-cancel-five-screens`.

12.5. WHEN the notes of those three entries are read THE SYSTEM SHALL name the later `boo-tique-flows` spec and state that one static snapshot cannot show the pattern.

12.6. WHEN the notes of `home-rolling-midnight-text`, `club-timer-session-restart`, `product-low-stock-random`, `product-viewers-random` and `product-real-inventory-3-left` are read THE SYSTEM SHALL record the review's caveats: no rolling inside a snapshot (wording only), restart only after 10 minutes or in a fresh context, at least 3 samples needed, and the stock value never equalling 3.

12.7. WHEN the derivation test runs THE SYSTEM SHALL compare only the shared fields of the research JSON and the fixture and fail on any drift in them, SHALL assert that the research JSON has neither `detectionSignals` nor `detectionNote`, and SHALL assert that the fixture keys minus those two equal the research keys; a mutated copy of an entry SHALL make the comparison fail.

12.8. WHEN the `element` text of `product-selling-fast-badge` is read in the research JSON and in the fixture THE SYSTEM SHALL equal "'Selling fast' badge on the product page, no number" in both files, and the derivation test SHALL pass. This is how L6 is fixed.

12.9. WHEN the home page is rendered THE SYSTEM SHALL contain no "Selling fast" text and no `bt-badge` element on any grid card, so no unlisted manipulative copy is added.

12.10. WHEN `docs/research/dark-patterns.md` is read THE SYSTEM SHALL still contain its original row `"Selling fast" badge on all products, no number` (no edit is authorised there beyond the date row of 1.7).

12.11. WHEN the source files under `lib/detectors/`, `lib/judge/` and `lib/capture/` (those that exist) are read THE SYSTEM SHALL contain neither `data-testid` nor `testid`, matched case-insensitively. Detectors and judges are forbidden from reading `data-testid`; it exists for the project's own tests only.

12.12. WHEN the visible text of any fixture route is read THE SYSTEM SHALL contain none of the nine canonical pattern ids, "dark pattern", "lookalike", "look-alike", "honest twin", "planted" and "not scored", matched case-insensitively.

## 13. Colours come from the palette (L8)

**User story:** As a maintainer, I want no hex colour literal in components, so that the palette stays the single source.

**Acceptance criteria:**

13.1. WHEN `components/boo-tique/product-grid.tsx` is read THE SYSTEM SHALL use `PALETTE.paper` for the SVG eye fill and contain no hex literal.

13.2. WHEN `components/boo-tique/overlay-dialog.tsx` is read THE SYSTEM SHALL use `PALETTE.ink` for the default close colour and contain no hex literal.

13.3. WHEN the `.tsx` files under `app/boo-tique/` and `components/boo-tique/` are read, with comments removed, THE SYSTEM SHALL contain no match of `#[0-9a-fA-F]{3,8}\b`.

## 14. Overscroll is not fixed (L4, decision 9)

**User story:** As the owner, I want the dark Trick or Trap root and the cream Boo-tique styles to stay separate, so that no Boo-tique rule leaks outside `.bt-root`.

**Acceptance criteria:**

14.1. WHEN `app/boo-tique/boo-tique.css` is read, with comments removed, THE SYSTEM SHALL contain no `body` selector and no `html` selector, matched as whole words, and no `:root` selector (old 2.3 holds).

14.2. WHEN `app/boo-tique/boo-tique.css` is read THE SYSTEM SHALL NOT contain `:has(`, so the review's rule `body:has(.bt-root) { background: #fbf3e4 }` is not present.

14.3. WHEN the spec is read THE SYSTEM SHALL record L4 as "not fixed, because of decision 9", with the review's rule as an option the owner can approve later. A later spec would then edit old 2.3.

## 15. Coverage wording (L5)

**User story:** As a maintainer, I want the coverage test and the requirement to say the same thing, so that the old 7.6 wording no longer contradicts the code.

**Acceptance criteria:**

15.1. WHEN `tests/boo-tique/coverage.test.ts` runs THE SYSTEM SHALL accept a fixture route that is in `PENDING_ROUTES` or is covered by a route-table entry.

15.2. WHEN `tests/boo-tique/coverage.test.ts` runs at the end THE SYSTEM SHALL assert that `PENDING_ROUTES` is empty and that every distinct fixture route is covered by a route-table entry.

15.3. WHEN this spec is implemented THE SYSTEM SHALL make no change to `tests/boo-tique/coverage.test.ts`, `tests/boo-tique/helpers/pending-routes.ts` or `tests/boo-tique/helpers/route-table.ts`, and the coverage test SHALL still pass for all 11 fixture routes.

## 16. Constraints

**User story:** As the owner, I want this spec to stay inside the installed toolchain and the agreed file scope, so that nothing needs a new approval.

**Acceptance criteria:**

16.1. WHEN the spec is implemented THE SYSTEM SHALL add no entry to `dependencies` or `devDependencies` in `package.json`. The reviewer checks this by reading `package.json`.

16.2. WHEN the spec is implemented THE SYSTEM SHALL leave `app/globals.css`, the root `app/layout.tsx` and `vitest.config.ts` unchanged, and `app/globals.css` SHALL still contain no `--bt-` declaration.

16.3. WHEN a test under `tests/boo-tique/` is read THE SYSTEM SHALL contain no JSX and SHALL build elements with `createElement` (old 16.2 holds).

16.4. WHEN `tests/boo-tique/spec-sync.test.ts` runs THE SYSTEM SHALL read `.kiro/specs/boo-tique-static/requirements.md`, `.kiro/specs/boo-tique-static/design.md` and `docs/research/dark-patterns.md` and check the text of 1.7 and 1.8.

16.5. WHEN any new `.tsx` file under `components/boo-tique/` is read THE SYSTEM SHALL contain no import from `next/link`, `next/image`, `next/navigation` or `next/font`, and every `<button>` it renders SHALL have `type="button"` (old 3.7 and 3.9 hold).
