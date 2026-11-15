# Design direction

Date: 2026-11-15

Research input prepared before implementation (not written by Kiro). Items marked unverified or "from memory" must be checked before use (font licenses, emoji coverage, the game-icons spider glyph).

Facts marked [read] come from a fetched page. Everything else is my recommendation (rec) or recall (unverified). Caveat: Mobbin and 21st.dev were not queried; the 15-call budget went to web sources.

## 1. Kiro / Kiroween visual context
- [read] https://kiroween.devpost.com/: this is a stock Devpost page. It uses the Circular font, a blue primary (#1F78D1), a pale grey-blue background (#EDF1F2), dark teal text (#003E54) and 2px radii. Tagline: "Build something wicked and git commit to the darkness." Deadline Dec 4, 2026, 2:00 PM PT. Costume Contest brief: "a haunting user interface that's polished and unforgettable... spooky design elements that enhance your app's function." Rules to design around:
  - The repo must be public with an open-source license and a `/.kiro` directory.
  - The demo video must be under 3 minutes and public on YouTube. Avoid third-party trademarks and copyrighted music in it.
  - The Design criterion reads "complete, coherent product experience... intuitive, polished, intentional." That means coherence matters more than spookiness.
- [read] https://kiro.dev/: dark theme, black background (#000), near-white text (#FAFAFA), signature violet (#9147FF), input surfaces (#211D25) with borders (#352F3D), 8px radii, 4px base unit, shadcn/Tailwind. Type is "AWS Diatype" with a rounded semi-mono for headings, which is proprietary. Buttons are square violet and pill-outline white.
- The ghost mascot is mentioned at https://www.geekwire.com/2025/amazons-surprise-indie-hit-kiro-launches-broadly-in-bid-to-reshape-ai-powered-software-development/. I did not read its exact shape.
- Rec, on-brand without imitation: a dark, violet-tinted night palette, a mono accent font for labels and evidence, and a spectral feel. Do not draw a generic cute ghost that reads as the Kiro ghost. Make our ghost distinct (a crowd of several ghosts, tilted, with an unlike silhouette). Do not use the Kiro logo, wordmark or purple-on-black gradient lockup.

## 2. Visual directions
**A. "Night Shift Field Guide" (recommended).** A dark, ink-violet UI with pumpkin-orange calls to action and a spectral-lilac accent. It reads like a monster field guide for consumer protection. Labels are mono-style, headlines use a wonky serif, and cards look like specimen cards.
- Palette: background `#13101E`, surface `#1D1830`, text `#F4F0FF` (16.7:1 on bg, 15.3:1 on surface), muted `#B9B0D1` (8.3:1), primary `#FF9A3C` (8.9:1 on bg, with `#1A0F05` ink text on it 8.9:1), accent `#B99BFF` (7.5:1), danger `#FF6B8A` (6.3:1), focus `#FFD84D` (13.6:1).
- Fonts (rec): Fraunces for display and Space Grotesk for body, with JetBrains Mono for evidence. All are Google Fonts under the SIL OFL. I read the Fraunces page at https://fonts.google.com/specimen/Fraunces and the Google Fonts statement that all fonts are open-source licensed (https://developers.google.com/fonts). The OFL attributions for Space Grotesk and JetBrains Mono are from memory (unverified).
- Radius 12px on cards and 999px on badges. Shadows are soft, glow-tinted, with a 1px violet hairline border. Motion is gentle float and wobble at 200-400ms.

**B. "Parchment Bestiary."** A light cream paper background (`#F7F0E3`), ink text `#201A33` (14.7:1), plum primary `#5B2A9E` (white text on it 9.3:1), pumpkin text `#B84A00` (5.1:1 on `#FFFBF3`) and danger `#B3261E` (6.3:1). Fonts: Fraunces with Inter. Thick outlines, a sticker-like offset shadow, and a stamp-in motion. It is charming, but the screenshots then sit on a light page. That lowers drama in the video and makes it blend with light shop screenshots.

**C. "Arcade Goth."** A near-black background with acid green and magenta, a pixel display font, and scanline effects. It is flashy but harder to keep AA-legible. It also hurts the credibility the tool needs, and the style fights the "polished" brief.

**Recommendation: A.**
- It maps to Design (coherent, tokenised, dark theme with real contrast numbers, which suits a tool that measures contrast).
- It also suits Presentation: dark UI with glowing markers is strong on video, and the Boo-tique (light) is instantly distinguishable.
- It is cheap: tokens plus shadcn theming, and no illustration work beyond monster badges.

## 3. Monster asset strategy
- **(a) Emoji:** Unicode has skull, ghost, mage, spider, vampire and zombie emoji, but there is no mummy or werewolf emoji (from memory, unverified). They also render differently per OS, which hurts video consistency. Twemoji graphics are CC-BY 4.0 (https://github.com/twitter/twemoji, license per search excerpts). Not suitable as the main asset.
- **(b) game-icons.net:** single-colour SVG silhouettes, license CC BY 3.0 (https://game-icons.net/), 4180 icons, usable in open-source and commercial work with attribution. All eight creatures are covered:
  - skeleton: https://game-icons.net/1x1/skoll/skeleton.html
  - ghost: https://game-icons.net/1x1/lorc/ghost.html (also delapouite/floating-ghost)
  - witch: https://game-icons.net/1x1/cathelineau/witch-face.html (also lorc/witch-flight)
  - spider: delapouite/spider-eye (read in the creature list, but it is an eye, not a full spider). I could not confirm a full-spider or web icon; my guessed `lorc/spider-alt` returned 404. Search the site for "spider" or "web" before committing.
  - mummy: https://game-icons.net/1x1/delapouite/mummy-head.html
  - werewolf: https://game-icons.net/1x1/lorc/werewolf.html
  - vampire: https://game-icons.net/1x1/delapouite/vampire-dracula.html
  - zombie: https://game-icons.net/1x1/delapouite/shambling-zombie.html

  Authors are mixed (Lorc, Delapouite, Skoll, Cathelineau), so the stroke weight is only moderately consistent. A shared badge container hides most of that. The skeleton "with a clock" idea would need a small clock glyph composed on top.
- **(c) Code-drawn SVG characters** from circles, rounded rects and a few paths (simple blob monsters with eyes, plus one prop each). An AI agent can do this reliably if given a shared base body, fixed eyes and 8 prop snippets. Distinctiveness and unified style are the strongest of the three, but quality varies per character.
- **(d) AI-generated images:** consistency across eight characters is hard, raster assets resist theming and scaling, and provenance and licensing must be documented per image. Higher time cost and risk. Skip for markers; at most use one generated hero image on the landing page.
- **Recommendation: primary = (b) game-icons.net glyphs inside a custom badge,** with the CC BY 3.0 credit in the footer, in the README and in the video description. **Fallback = (c)** hand-built SVG, if the spider/skeleton glyphs look off or attribution is a burden. An easy hybrid is the (b) glyph in the badge plus a small (c) prop corner icon.
- **Marker design (rec):** a 44px circle badge. The glyph is white-on-coloured-fill, and the fill is by severity (orange = high, lilac = medium, grey-violet = low). Rings: 3px white inner ring, then 2px `#13101E` outer ring, then a 0 4px 12px rgba(0,0,0,.5) drop shadow. The white and dark rings give the marker contrast on any background (white ring vs `#13101E` is 18.7:1). Add a small number chip (1..n) at the top-right that matches the sidebar list. On hover and select, add a pulsing halo ring.

## 4. Results-screen layout
- Two columns on desktop: the screenshot in a scroll container (fixed height = viewport minus header) at about 62%, and a sticky summary and findings sidebar at about 38%.
- The screenshot is rendered at container width. Markers are positioned in percent coordinates, so they stay aligned at any zoom. Provide zoom (fit width, 100%) and a slim minimap strip to the left of the scroll area. The minimap shows a tall thumbnail with dots for findings and a viewport rectangle.
- Selecting a marker or a list row scrolls the other into view with `scrollIntoView({block:'center'})` and highlights both. Overlapping markers within 40px cluster into a numbered group that expands on click.
- **Finding card** (popover on desktop, bottom sheet on mobile). Top to bottom:
  - monster badge and the pattern name
  - confidence chip ("Possible · high confidence")
  - an on-page evidence block in mono with a cropped screenshot snippet, plus the highlight rectangle on the screenshot
  - a "Why it matters" paragraph
  - Prev / Next buttons and a Close button
- **Summary sidebar:** the scanned domain, a count of findings by severity, a legend row of the eight monsters with counts (filter toggles), then the ordered finding list with number chips. Add a one-line disclaimer ("Automated, may be wrong").
- **Mobile:** the screenshot goes full width and scrolls vertically. Marker taps open a bottom sheet (snap points 40% and 85%). The list lives in a "Findings (n)" tab or sheet, and the minimap collapses into a floating "jump to next finding" control.
- **Comparable products and what to borrow:**
  - WAVE injects numbered/colour-coded icons into the page and mirrors them in a sidebar summary and details list, with click-to-highlight and per-category toggles (https://wave.webaim.org/help, https://itsaccessibility.syr.edu/accessible-websites/wave-evaluation-tool/). Borrow the icon-and-sidebar sync, the category filters and the collapsible sidebar.
  - BugHerd pins a marker to a page element and keeps the pin until resolved (https://bugherd.com/feature/easy-website-annotations). Borrow the pin metaphor and the sidebar overlay that highlights a section.
  - Hotjar and Microsoft Clarity heatmaps (from memory, not fetched) show a long full-page screenshot with an overlay. Borrow the full-page scroll and the sticky overview.

## 5. Waiting scene (CSS/SVG, cheap)
A "Haunted house x-ray" scene. A line-drawn house silhouette (one SVG) sits centred with a lantern light that sweeps across it. A progress rail below shows three honest steps, advanced only by real server events (SSE or polling):
1. "Opening the page" (the screenshot is being taken).
2. "Measuring" (extracting DOM, text and prices).
3. "Judging" (the AI's detection).

Each step has a label, a spinner and a check-mark when done. Eight tiny monster silhouettes peek from windows and light up as the detector finds each type (real counts). Only transform and opacity animate. Under `prefers-reduced-motion`, show a static house and the text steps with an `aria-live="polite"` region. No fake percentage. If a step takes longer than expected, show elapsed seconds.

## 6. The Boo-tique art direction
- Should look unmistakably like a different site: a light, warm cream and blood-red storefront, Cormorant Garamond headings with Jost body (Google Fonts, OFL, from memory), a wide hero banner, a product grid, and a standard header with a top announcement bar. In contrast, Trick or Trap is dark with the Fraunces and mono look.
- Name and products: "The Boo-tique: Gothic goods for living ghouls". Products such as the "Cursed Candle Set," "Phantom Hoodie," "Moon-Phase Mug," "Crypt Keeper Tote," "Raven Feather Quill Pen," each with a price, a star rating and a "was/now" price.
- Imagery: CSS/SVG product tiles (a coloured rounded square with a simple icon or pattern, a subtle gradient and a drop-shadow), not photos. No stock-license risk, and the look is consistent. If photos are wanted, only use CC0 sources (Unsplash-style licenses have restrictions; Pexels and Pixabay allow free use but need a per-image check, from memory, unverified).
- Dark patterns to include, mapped to the monsters: a countdown timer (skeleton); "Only 2 left!" and "17 people are viewing this" (ghost); "No thanks, I hate saving money" (witch); pre-checked "Add insurance" and newsletter boxes (spider); low-contrast, tiny "Decline" link (mummy); an extra item that shows up in the basket (werewolf); shipping and "handling fee" added at the last step (vampire); a subscription that is easy to start and requires a phone call to cancel (zombie).

## 7. Token sheet (Direction A)
```
colors:
  bg: #13101E        surface: #1D1830      surface-2: #28213F
  border: #3A3158    text: #F4F0FF         muted: #B9B0D1
  primary: #FF9A3C   on-primary: #1A0F05   accent: #B99BFF
  danger: #FF6B8A    focus: #FFD84D        success: #7BE0A4
severity: high #FF9A3C / medium #B99BFF / low #8C84A8  (always paired with a text label)
fonts:
  display: "Fraunces", serif
  body: "Space Grotesk", system-ui, sans-serif
  mono: "JetBrains Mono", ui-monospace, monospace
type scale (px/line-height): xs 12/16, sm 14/20, base 16/24, lg 18/28,
  xl 22/30, 2xl 30/36, 3xl 40/44, 4xl 56/60 (display, tracking -0.02em)
spacing (4px base): 0 4 8 12 16 24 32 48 64 96
radii: sm 6, md 12, lg 20, full 999
shadows:
  card: 0 8px 24px rgba(0,0,0,.35), inset 0 0 0 1px #3A3158
  marker: 0 4px 12px rgba(0,0,0,.5)
  glow: 0 0 24px rgba(185,155,255,.35)
motion:
  fast 150ms, base 250ms, slow 400ms
  ease-out: cubic-bezier(.2,.8,.2,1)
  ease-spring: cubic-bezier(.34,1.56,.64,1)
  reduced-motion: set all durations to 0.01ms and stop looping animations
z-index: base 0, screenshot 1, marker-cluster 10, marker 20, marker-selected 30,
  popover 40, sticky-header 50, sheet 60, modal 70, toast 80
```

## 8. Accessibility checklist
1. All body and card text meets AA (4.5:1) in the token sheet above; check any text placed on the screenshot overlay with a solid chip, never raw.
2. Visible focus ring on every marker, button and row: 3px `#FFD84D` outline with 2px offset, not removed anywhere.
3. Markers are real `<button>`s with an `aria-label` such as "Finding 3: Fake urgency, possible, high confidence", reachable via Tab in document order and via arrow keys in the findings list.
4. The sidebar list is the keyboard and screen-reader primary path; the overlay is a convenience layer, and both stay in sync.
5. Never rely on colour alone: severity uses an icon or text label, and confidence is written out ("Possible · medium").
6. The popover and bottom sheet trap focus, close on Esc, and return focus to the marker that opened them.
7. `prefers-reduced-motion` disables float, pulse, wobble and the scene animation; the scanning scene falls back to static text steps.
8. The scan progress is announced through `aria-live="polite"` with the real step names; errors use `role="alert"`.
9. Touch targets are at least 44x44px on mobile, including the markers (larger hit area than the visible badge).
10. The screenshot has alt text summarising the page and finding count; every glyph is `aria-hidden` when a text label is present; wording stays "possible" to avoid overclaiming.
11. Also add the CC BY 3.0 credit for game-icons.net and the font licenses (OFL) in the footer and README.
