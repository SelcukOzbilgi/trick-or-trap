# Dark pattern taxonomy, detection signals and Boo-tique ground truth

Date: 2026-11-15

Research input prepared before implementation (not written by Kiro); items marked [M] are unverified.

Legend: [S] = read from the cited source in this session. [M] = from memory, not re-verified here. [I] = my inference or recommendation. About 20 searches and fetches were used. I did not find a documented list of Shopify-app class names (see B).

## A. Taxonomy grounding

| # | Pattern | Standard names (source) | One-sentence definition | URL |
|---|---|---|---|---|
| 1 | Fake urgency | "Countdown Timer" and "Limited-time Message" (Mathur); "Fake urgency" (deceptive.design); false urgency (FTC) | A deadline that is presented but not real: the timer resets, or the offer outlives it. Mathur calls a timer deceptive if it resets with the same offer valid, or expires while the offer is still valid [S]. | https://arxiv.org/html/1907.07032v2 ; https://deceptive.design/types/fake-urgency/ |
| 2 | Fake scarcity / activity | "Low-stock Message", "High-demand Message", "Activity Message" (Mathur); "Fake scarcity", "Fake social proof" (deceptive.design) | A fake indication of limited supply or popularity, including "N viewing" messages [S]. Mathur puts these under Scarcity and Social Proof; deceptive.design puts activity messages under fake social proof [S]. | https://webtransparency.cs.princeton.edu/dark-patterns/ ; https://deceptive.design/types/fake-scarcity/ |
| 3 | Confirmshaming | "Confirmshaming" (Brignull, Mathur, deceptive.design) | Language and emotion (shame) used to steer users away from a choice [S]. | https://deceptive.design/types/confirmshaming/ |
| 4 | Pre-checked / preselection | "Preselection" (deceptive.design); "Pressured Selling" or "Trick Questions" (Mathur); "Default" or "Preselection" (Gray, AidUI) | A default option already selected for the user to influence the decision [S]. Mathur folds pre-selecting more expensive variants into Pressured Selling [S]. | https://deceptive.design/types/preselection/ |
| 5 | Visual interference | "Visual interference" (Brignull, Mathur); "Interface interference" (Gray); EDPB "Stirring" and "Hindering" [M] | Information expected to be clear is hidden, obscured or disguised [S]. ICO says refusing consent must be as easy as accepting, with equally prominent accept-all and reject-all [S]. | https://deceptive.design/types/visual-interference/ ; https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/how-do-we-manage-consent-in-practice/ |
| 6 | Sneak into basket | "Sneak into Basket" (Mathur); "Sneaking" (Gray, deceptive.design, FTC) | Items are added to the basket without the user's action. For deceptive.design, Sneaking is the wider family where information is hidden or delayed [S]. | https://deceptive.design/types/sneaking/ |
| 7 | Drip pricing / hidden fees | "Hidden Costs" (Mathur, deceptive.design); "Drip pricing" (FTC, DSA-adjacent law) | Incomplete total cost is shown, and mandatory charges appear late in the buying process [S, FTC via NAAG summary]. | https://deceptive.design/types/hidden-costs/ ; https://www.naag.org/attorney-general-journal/shedding-light-on-dark-patterns-protecting-consumers-from-digital-deception/ |
| 8 | Roach motel | "Hard to Cancel" (Mathur, deceptive.design); "Roach motel" (Brignull); "Obstruction" (Gray) | Easy to subscribe, very hard to cancel [S]. | https://deceptive.design/types/hard-to-cancel/ |

Naming disagreements:

- Mathur has 15 types in 7 categories. Gray has 5 (Nagging, Obstruction, Sneaking, Interface Interference, Forced Action). deceptive.design currently has about 19 types, and "Fake urgency", "Fake scarcity" and "Fake social proof" are separate types there [S]. This is a different split from Mathur's Urgency / Scarcity / Social Proof.
- The FTC report groups by consumer harm, not by pattern. The four groups are false beliefs, hidden material information, unauthorised charges, and privacy subversion. I read the first two in the sources; the last two are from memory [M]. Source: https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf
- The EDPB uses Overloading, Skipping, Stirring, Hindering, Fickle and Left in the dark. It covers data protection only, and I saw five of the six names in a secondary source [S: Clifford Chance, https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2023/03/deceptive-design-patterns-and-where-to-find-them-edpb.html]. Primary: https://www.edpb.europa.eu/documents/guideline/guidelines-032022-on-deceptive-design-patterns-in-social-media-platform_en
- The OECD working definition says practices "subvert or impair consumer autonomy, decision-making or choice" [S: https://www.oecd.org/en/publications/dark-commercial-patterns_44f5e846-en.html]. It is a definition, not a pattern list.
- DSA Art. 25 [M, not re-verified]: it bans interfaces that deceive or manipulate or materially distort free and informed choice. Para. 3 gives example areas: prominence of choices, repeated requests, and cancelling being harder than subscribing. I could not extract the article text in this session, so check it at https://eur-lex.europa.eu/eli/reg/2022/2065/oj before quoting it in the app.
- CNIL: I did not reach a primary CNIL page. A secondary source says CNIL sanctioned Google and Meta in December 2021 for no "reject" button on the same layer as "accept" [S: https://arxiv.org/html/2606.31485v2]. Treat the CNIL parity rule as [M] until you read the CNIL page itself.

## B. Detection signals (phase 1)

Tiers: **D** = deterministic rule, **L** = needs a language model, **R** = needs a second load or interaction.

### 1. Fake urgency

- D: elements whose text matches `\b\d{1,2}:\d{2}(:\d{2})?\b` or `(ends|expires|offer ends|sale ends|hurry|last chance|today only)\b`, plus `\d+\s*(h|hrs?|hours?|m|min|mins|s|sec)\b` in a short element (80 characters or fewer).
- D: the text changes at an interval of about 1 second under a MutationObserver or clock-forwarding (Playwright `page.clock`).
- D: `<time>` or `datetime`, or class and ID names matching `countdown|timer|ticker|hurry`.
- D: the deadline comes from `Date.now() + constant`, from `localStorage`/`sessionStorage`/cookie, or has no server-supplied timestamp.
- R: reload, or open a fresh context. A timer that restarts at about the same duration is the strongest signal. This mirrors Mathur's revisit method, which re-crawled every 4 hours for 5 days [S].
- R: advance the clock past zero. The offer or price is unchanged, or the timer restarts.
- L: judging whether the wording is a pressure claim ("Offer ends soon!") with no date.
- Third-party fingerprint: Mathur names Beeketing, Fomo, Hurrify, Booster, Yieldify, Taggstar, Fresh Relevance, Convertize, Proof, Fera, WooCommerce Notification and others, identified by script domains (e.g. boostertheme.com, boostplugin.com) [S]. I found no public list of CSS class names. [I] Build your own fingerprint list from `<script src>` and network hostnames, and from Mathur's `analysis/` notebooks.
- False-positive traps: a real sale with a fixed calendar date; a cart-hold timer that really holds stock; a shipping cutoff ("order within 2h for next-day"); a countdown to a product launch. Avoid overclaiming by flagging only "restarts on reload" or "no server deadline" as the fake signal. Flag a timer that merely exists as low confidence and word it as "possible urgency pressure".

### 2. Fake scarcity and activity

- D: `\b(only|just)\s+\d+\s+(left|remaining|in stock)\b`; `\b\d+\s+(people|others|customers|shoppers)\s+(are\s+)?(viewing|looking|watching|have this in (their )?cart)`; `(\d+ )?(sold|bought)\s+(in the last|today|recently)`; `selling fast|almost gone|low stock|high demand|limited (stock|quantity)|going fast`; `\b[A-Z][a-z]+ from [A-Z][a-z]+ (just )?(bought|purchased)`.
- D: a number in the message is not present in any JSON or inline data (`inventory_quantity`, a `stock` field).
- R: reload N times. The number changes at random, or jumps more than any real sales would produce. Mathur found 16 of 17 deceptive low-stock cases decremented on a schedule and one randomised on load [S].
- R: add to cart or select a quantity larger than the claim. A real counter limits the quantity.
- R: crawl 5 to 10 product pages. The same "low stock" claim on nearly all of them (Mathur saw this on 6pm.com and orthofeet.com [S]).
- L: whether "popular" or "trending" wording is a real claim.
- False-positive traps: genuine low inventory; "N in cart" tied to a real hold; review counts. Avoid overclaiming by flagging the claim only as a **possible** pattern, since a detector cannot see real inventory. Raise confidence only on reload variance or cross-product repetition.

### 3. Confirmshaming

- D: decline element (button, link, secondary action) in a modal or banner with text matching `no,? (thanks|thank you),? i (don'?t|do not|hate|prefer|like|would rather|am not)`, `i('ll| will) (pay full price|miss out|stay (uninformed|boring))`, `maybe later,? i don'?t`, `i don'?t want (to )?(save|a discount|free|protection)`, or the first-person-negative pattern `\bi (don'?t|do not|hate|prefer|enjoy|like) .*(saving|discount|deal|savings|money|help|protect)`.
- D: a pair of choices where the accept text is positive and the decline text is first-person and negative.
- L: borderline guilt or shame ("I'm fine with missing out") and sarcasm.
- Reusable data: the Mathur and yamanalab text segments (see D).
- False-positive traps: plain "No thanks" or "Not now"; negative wording that is neutral ("I don't need a bag"). Avoid overclaiming by requiring emotional or self-deprecating framing, not just a first-person "I don't".

### 4. Pre-checked / preselected

- D: `input[type=checkbox]:checked` or `[aria-checked=true]` / `role=switch`, or `<option selected>` or a `checked` radio, that adds money or consent (an add-on, newsletter, warranty, insurance, donation) and that the user did not toggle.
- D: the label or the adjacent text (within about 3 nodes) matches `protection|insurance|warranty|donat|newsletter|marketing|subscribe|gift|priority|express|premium|add`; or the price delta is non-zero.
- D: the preselected variant is not the cheapest.
- R: submit with defaults and diff the cart or total. Run the same on a second load to check the default persists.
- L: whether an unlabelled option is an add-on or just a required choice.
- False-positive traps: required radios (shipping, size) must have a default; "remember me"; terms checkboxes unchecked; a cheapest-default select. Avoid overclaiming by flagging only a preselected option that costs money or grants marketing or data consent, and is not the cheapest or neutral default.

### 5. Visual interference (cookie banners, upsell modals)

- D: find banners and modals (`position:fixed|sticky`, a high z-index, text matching `cookie|consent|privacy|tracking|partners|preferences`, or known CMP roots such as `#onetrust-banner-sdk`, `#CybotCookiebotDialog`, `.cmp`, `#usercentrics-root`).
- D (computed style): the accept button area divided by the decline button area is greater than 2; font-size ratio greater than 1.4; the contrast ratio (WCAG) of the decline text on its background is less than 3:1 while the accept is at least 4.5:1; the decline is a link (`<a>`) or plain text while the accept is a filled `<button>`; opacity of the decline is less than 0.7; font size under 12px.
- D: no reject-like control on the first layer (`reject|decline|refuse|deny|only necessary|essential only`) while an accept control exists.
- D: a close "x" under 16 by 16px or with a contrast under 3:1 in an upsell modal.
- R: click "manage" and count clicks to refuse. This is the CNIL and ICO equal-effort test [S for ICO].
- L: classifying a control's role from its label when the label is unusual; judging colour salience.
- False-positive traps: brand-styled but equal buttons; a text "Reject" next to an "Accept" that is a bit larger. Avoid overclaiming by using the thresholds above together (at least 2 measures) and reporting the measured numbers as evidence.

The thresholds in this section are [I]; none are from a regulator.

## C. Phase 2 signals (agent flows)

| Pattern | Agent must | Observable proof |
|---|---|---|
| Sneak into basket | Snapshot the cart (line items, count, subtotal) before and after only "add the one product", with no clicks on add-ons; then at the cart page. | A line item or quantity appears that the agent never added (cart diff), usually via a preselected add-on, an upsell, or a JS add on load. |
| Drip pricing | Record the displayed price on the listing, product, cart, and each checkout step (shipping, taxes, "handling", "service", "processing"). Stop before paying. | A mandatory fee line that was absent at earlier steps; the total at the last step exceeds the earlier total by more than shipping and tax disclosed up front. Report each step's price breakdown as evidence. |
| Hard to cancel | Subscribe with test data on a demo, then find the cancel route; count clicks, screens and form fields to subscribe versus to cancel. | The cancel path needs more steps than sign-up, or needs a phone call or email, or is behind retention screens. Report both counts. |

[I] Use test data only, and never pay on real sites.

## D. Prior art

| Item | What it does | Method and accuracy | License | URL |
|---|---|---|---|---|
| Mathur et al. 2019 | 15 types on about 11K shopping sites; 1,818 instances | Text-segment clustering plus manual review; revisit method for timers | Repo is GPL-3.0 [S]; paper text on arXiv | https://github.com/aruneshmathur/dark-patterns |
| yamanalab ec-darkpattern (Yada et al.) | 2,356 text segments (1,178 positive, 1,178 negative), from Mathur | RoBERTa-large was best; my extraction of the exact accuracy was inconsistent, so check the paper [S, partial] | License not stated on the page I read | https://github.com/yamanalab/ec-darkpattern ; https://arxiv.org/html/2211.06543v2 |
| AidUI (ICSE 2023) | 10 target patterns from screenshots; dataset ContextDP: 162 web and 339 mobile screenshots, 301 DP and 243 non-DP | Object detection, OCR, text pattern matching, colour and spatial analysis | The page shows "MIT" with an Apache link badge, which is inconsistent; check the LICENSE file | https://github.com/SageSELab/AidUI |
| UIGuard (UIST 2023) | Mobile app dark patterns | Icon, status and template rules | Apache-2.0 [S]; dataset on Zenodo | https://github.com/chenjshnn/UIST23-UIGuard |
| AutoBot (arXiv 2411.07441) | Static patterns incl. confirmshaming, fake scarcity or urgency, preselection, visual interference, hidden costs | YOLOv10 UI elements plus OCR plus LLM. Reported F1 0.93 end to end with Gemini, 0.84 Qwen, 0.82 T5 [S] | Paper CC BY-NC-ND 4.0; no code repo or licence found | https://arxiv.org/html/2411.07441v3 |
| Insite Chrome extension | Reads text on shopping product pages and highlights dark patterns | Text classifier | Not checked | https://github.com/NicholasTung/dark-patterns-recognition |
| PETS 2026, LLM agents for audits | LLM browser agent over data-broker right-of-access flows (100 brokers) | High precision on immediately observable patterns (precision 95.2%, recall 90.9% for one group); recall as low as 40.5% on multi-page ones [S] | CC BY 4.0 paper | https://petsymposium.org/popets/2026/popets-2026-0152.pdf |
| TrickyArena / LiteAgent (IEEE S&P 2026) | A test site with toggleable dark patterns, used to test agents; agents fell for a single pattern 41% of the time [S] | Controlled React sites | Not checked | https://arxiv.org/html/2510.18113v1 |

Directly reusable [I]: the Mathur and yamanalab text segments as phrase seeds, the Mathur third-party script-domain list, and the AidUI ContextDP screenshots as a sanity test. Mind the GPL-3.0 of the Mathur repo if you copy code. I found no clean permissively licensed phrase list. I did not find DAPDE.

## E. Ground-truth plan for The Boo-tique

Seven pages. Verdict: **FLAG** or **NO FLAG** (honest look-alike). Difficulty: E easy, M medium, S subtle. The machine-readable version of this table is `boo-tique-ground-truth.json` in this folder (30 entries).

| Page | Element | Pattern | Diff. | Verdict |
|---|---|---|---|---|
| 1 Home (/) | Hero banner "Boo-nanza ends in 04:59:59" restarting on reload | Urgency | E | FLAG |
| 1 Home | "Black Friday of the Dead ends at midnight", rolling to the next midnight daily, text only | Urgency | S | FLAG |
| 1 Home | "Winter sale ends 28 Feb 2027, 23:59 UTC", fixed date, same on reload | none | look-alike | NO FLAG |
| 1 Home | Cookie banner: big filled "Accept all", 11px grey link "options", no reject on layer 1 | Visual interference | E | FLAG |
| 1 Home | Cookie banner variant (use a second route): "Reject" as a ghost button, contrast about 2:1, 60% opacity | Visual interference | M | FLAG |
| 1 Home | Cookie banner variant: equal-size Accept and Reject, same style | none | look-alike | NO FLAG |
| 2 Product | "Only 2 left!" random on reload | Scarcity | E | FLAG |
| 2 Product | "14 people are viewing this" random | Activity | E | FLAG |
| 2 Product | "Selling fast" badge on all products, no number | Scarcity | M | FLAG |
| 2 Product | Tiny grey "Almost gone" in a `data-` driven span, 10px | Scarcity | S | FLAG |
| 2 Product | "3 left", from a real inventory field that drops when added to cart | none | look-alike | NO FLAG |
| 2 Product | Rotating toast "Morgan from Ohio just bought..." | Activity | M | FLAG |
| 2 Product | Upsell modal: large "Add crypt keeper bundle", close "x" 8px pale grey | Visual interference | M | FLAG |
| 3 Cart | Pre-checked "Add Raven Shipping Protection +$4.99" | Preselection | E | FLAG |
| 3 Cart | Pre-selected "Gold Extended Curse Warranty" in a radio group, not the cheapest | Preselection | M | FLAG |
| 3 Cart | `role=switch` "Priority coffin packaging" on by default, styled like a toggle | Preselection | S | FLAG |
| 3 Cart | Unchecked optional "Gift wrap +$2" | none | look-alike | NO FLAG |
| 3 Cart | Cheapest shipping radio preselected | none | look-alike | NO FLAG |
| 3 Cart | "Insurance" line item appears after only "add to cart" | Sneak into basket | E (phase 2) | FLAG |
| 4 Checkout | Newsletter box pre-checked | Preselection | E | FLAG |
| 4 Checkout | Step 1 total $40; step 3 adds "handling $6.99" and "haunting fee $3" | Drip pricing | E (phase 2) | FLAG |
| 4 Checkout | Shipping and tax shown from the cart and unchanged | none | look-alike | NO FLAG |
| 5 Club (/club) | Offer modal: "Yes, give me 20% off!" vs "No thanks, I hate saving money" | Confirmshaming | E | FLAG |
| 5 Club | "I'll pay full price like a mortal" | Confirmshaming | M | FLAG |
| 5 Club | "Maybe later, I don't need protection" in an insurance upsell | Confirmshaming | S | FLAG |
| 5 Club | Plain "No thanks" / "Not now" | none | look-alike | NO FLAG |
| 5 Club | Timer "Join in 09:59 for 20% off" in sessionStorage, restarts after zero with the same offer | Urgency | M | FLAG |
| 6 Account / Cancel | Subscribe is 1 click; cancel needs 5 screens, retention offers, then a phone call | Roach motel | E (phase 2) | FLAG |
| 6 Account / Cancel | A second plan with a 1-click cancel | none | look-alike | NO FLAG |
| 7 Newsletter modal (exit-intent) | Same pattern family as 5, one preselected "partners" checkbox | Preselection | M | FLAG |

[I] Give each element a stable `data-gt-id`, and keep the expected verdict in a JSON file next to the pages (not in the DOM that the detector reads). Keep the honest look-alikes as first-class tests, since precision matters most.

## F. Confidence rubric [I]

| Level | Rule | Example |
|---|---|---|
| High | At least 2 independent signal classes agree, and at least one is a measured or behavioural signal (reload variance, clock-forward, computed contrast or area ratio, cart or price diff). | Countdown text plus restart on reload. |
| Medium | One strong deterministic signal (a text pattern with context, a preselected paid option), or an LLM plus one weak deterministic signal. | "Only 2 left" with no reload test done. |
| Low | Text-only or LLM-only match with no measured evidence. | "Selling fast" badge. |

Rules: never go above Medium for stock or activity claims unless the number changes across loads, because real inventory is not visible. Every finding on a real site is worded as "possible", and cites the evidence and the measured numbers. Cap confidence at Low if any look-alike rule matches (fixed calendar date, equal buttons, neutral default).
