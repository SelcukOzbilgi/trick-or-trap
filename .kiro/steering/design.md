---
inclusion: always
fileMatch:
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "components/**/*.tsx"
  - "components/**/*.css"
fileMatchPattern: "\\.(tsx|css)$"
---

# Design: Night Shift Field Guide

The UI reads like a monster field guide for consumer protection — dark, ink-violet, with pumpkin-orange calls to action and spectral-lilac accents. Headlines use a wonky serif; labels and evidence blocks use monospace. Cards look like specimen cards.

## Token sheet

```
colors:
  bg:          #13101E      # page background
  surface:     #1D1830      # card, panel
  surface-2:   #28213F      # elevated surface
  border:      #3A3158
  text:        #F4F0FF      # 16.7:1 on bg, 15.3:1 on surface
  muted:       #B9B0D1      # 8.3:1 on bg
  primary:     #FF9A3C      # 8.9:1 on bg; use on-primary for ink
  on-primary:  #1A0F05
  accent:      #B99BFF      # 7.5:1 on bg
  danger:      #FF6B8A      # 6.3:1 on bg
  focus:       #FFD84D      # 13.6:1 on bg
  success:     #7BE0A4

severity:
  high:    #FF9A3C   # always paired with a text label, never colour alone
  medium:  #B99BFF
  low:     #8C84A8

fonts:
  display: "Fraunces", serif
  body:    "Space Grotesk", system-ui, sans-serif
  mono:    "JetBrains Mono", ui-monospace, monospace

type scale (px / line-height):
  xs:   12 / 16
  sm:   14 / 20
  base: 16 / 24
  lg:   18 / 28
  xl:   22 / 30
  2xl:  30 / 36
  3xl:  40 / 44
  4xl:  56 / 60   # display — letter-spacing -0.02em

spacing (4 px base unit): 0 4 8 12 16 24 32 48 64 96

radii:
  sm:   6px
  md:   12px
  lg:   20px
  full: 999px

shadows:
  card:   0 8px 24px rgba(0,0,0,.35), inset 0 0 0 1px #3A3158
  marker: 0 4px 12px rgba(0,0,0,.5)
  glow:   0 0 24px rgba(185,155,255,.35)

motion:
  fast:   150ms
  base:   250ms
  slow:   400ms
  ease-out:    cubic-bezier(.2,.8,.2,1)
  ease-spring: cubic-bezier(.34,1.56,.64,1)
  reduced-motion: set all durations to 0.01ms; stop looping animations

z-index:
  base:             0
  screenshot:       1
  marker-cluster:  10
  marker:          20
  marker-selected: 30
  popover:         40
  sticky-header:   50
  sheet:           60
  modal:           70
  toast:           80
```

## Monster marker design

Each finding is pinned with a 44 px circular badge:

- **Glyph:** a game-icons.net SVG silhouette, white, centred inside the fill circle.
- **Fill colour:** severity — high `#FF9A3C`, medium `#B99BFF`, low `#8C84A8`.
- **Rings:** 3 px white inner ring, then 2 px `#13101E` outer ring (white-on-dark gives 18.7:1 contrast on any background).
- **Shadow:** `0 4px 12px rgba(0,0,0,.5)`.
- **Number chip:** small pill at top-right, matches the finding's index in the sidebar list.
- **Hover / selected state:** pulsing halo ring (disabled under `prefers-reduced-motion`).
- **Hit area:** at least 44 × 44 px on mobile, larger than the visible badge.
- Markers are real `<button>` elements with `aria-label` such as "Finding 3: Possible fake urgency, high confidence".

## Accessibility checklist

1. All body and card text meets WCAG AA (4.5:1). Text placed over the screenshot overlay uses a solid chip background — never raw text on an unknown image.
2. Every marker, button, and row has a visible focus ring: 3 px `#FFD84D` outline with 2 px offset, never removed.
3. Markers are keyboard-reachable via Tab (document order) and arrow keys within the findings list.
4. The sidebar list is the primary keyboard and screen-reader path; the screenshot overlay is a convenience layer. Both stay in sync.
5. Severity and confidence are never communicated by colour alone — always pair with an icon or written label.
6. Popovers and bottom sheets trap focus, close on Esc, and return focus to the marker that opened them.
7. `prefers-reduced-motion`: disable float, pulse, wobble, and the scanning scene animation; fall back to static text steps with `aria-live="polite"`.
8. Scan progress is announced via `aria-live="polite"`; errors use `role="alert"`.
9. Touch targets are at least 44 × 44 px.
10. The screenshot `<img>` has alt text summarising the page and finding count. Glyphs used purely as decoration are `aria-hidden` when a text label is present.
11. All finding copy uses "Possible" framing (see `findings-wording.md`).

## The Boo-tique theme

The Boo-tique uses a visibly different **light theme**: warm cream background, blood-red primary, Cormorant Garamond headings, Jost body. This contrast is intentional — viewers must immediately recognise they are on the demo target, not on the main Trick or Trap UI.

## Font and icon licensing

Font licenses and the icon set must be verified before use:

- Fraunces, Space Grotesk, and JetBrains Mono are listed as SIL OFL on Google Fonts. Confirm the OFL applies to Space Grotesk and JetBrains Mono by reading their individual Google Fonts pages before shipping.
- game-icons.net icons are CC BY 3.0. Attribution is required: add a credit in the footer, the README, and the demo video description.
- The spider icon specifically must be verified — search game-icons.net for "spider" or "web" before committing, as the expected slug returned a 404 during research.
- Do not use AI-generated raster images as marker glyphs. If a game-icons glyph is unsuitable, use a hand-built SVG instead (see `docs/research/design.md` option (c)).
