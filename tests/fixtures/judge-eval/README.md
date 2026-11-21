# Judge evaluation set: dev split

`dev.json` holds 120 labelled cases for the six static patterns of Trick or Trap. It is the **dev** half of a 240-case set. The other half (the **sealed** split, 120 cases) is kept outside the repository, is never shown to Kiro, and is used only by reviewers. Recall and false-positive figures for the model judge are quoted from the sealed split only.

## Provenance

- Written on 2026-11-21 by an independent Claude agent. Not written by Kiro, and not by the author of the detectors' word lists.
- Written before reading the detectors' word lists, the phrase corpus fixture or the hold-out fixture. Inputs were the prose of the two detector reviews (for the kinds of gaps to probe, not their wording) and the `ElementSnapshot` type.
- Text is original, modelled on how shops commonly write in English and Turkish. No real brand, shop or person is named, and no text is copied from a real site or from the demo shop.
- Frozen at creation. Do not edit cases to fit a detector or a prompt. Corrections go in a new version with a changelog line and a new hash.

## Split

The 240 cases were split by a seeded shuffle, stratified by pattern × language × expected (5 per cell per split) and balanced by structure tag (split text, toasts, checkbox labels, dark banners, tolerated-low cases). No case id and no normalised text longer than 12 characters appears in both splits.

| | flag | clean |
|---|---|---|
| per pattern, per language | 5 | 5 |
| per pattern | 10 | 10 |
| total | 60 | 60 |

## Schema

```jsonc
{
  "meta": { "name": "judge-eval-dev", "version": 1, "created": "2026-11-21", "author": "…", "caseCount": 120 },
  "cases": [
    {
      "id": "fs-en-f-02",                 // unique across both splits
      "lang": "en",                       // "en" | "tr"
      "pattern": "fake-scarcity",         // one of the six static PatternIds
      "expected": "flag",                 // "flag" | "clean"
      "elements": [ /* ElementSnapshot subset, see below */ ],
      "evidenceElementId": "el-0-2-3",    // flag cases only: the element that carries the claim
      "relatedElementIds": ["el-0-2-3-0"],// optional, flag cases only: other parts of a split claim, the paired control, or the label
      "tolerateLow": true,                // optional, clean cases only: a low finding is tolerated (see scoring)
      "why": "one line",
      "tags": ["split"]                   // optional: split, toast, badge, checkbox-label, dark-banner, inflection, number-words, hard-negative, hard-positive
    }
  ]
}
```

Element records use the real field names of `ElementSnapshot` (`lib/types`), and only fields the judge's candidate builder would read: `id`, `tag`, `role`, `text`, `boundingBox`, `color`, `backgroundColor`, `fontSize`, `opacity`, `position`, `checked`, `selected`, `attributes` (only `type`, `name`, `disabled` and `aria-*`). To run the **rules** on a case, the harness builds a `PageSnapshot` with these exact defaults (the judge receives none of them):

- Snapshot: `url: "https://shop.example.test/p"`, `capturedAt: "2026-11-21T12:00:00.000Z"`, `viewportWidth: 1280`, `viewportHeight: 800`, `fullWidth: 1280`, `fullHeight: 3000`.
- Missing element fields:
  - `color: "rgb(0, 0, 0)"`, `backgroundColor: "rgba(0, 0, 0, 0)"`, `fontSize: "16px"`, `opacity: "1"`;
  - `display: "block"`, `visibility: "visible"`, `position: "static"`;
  - `checked: false`, `selected: false`;
  - `boundingBox: { x: 40, y: 100 + 40 × index, width: 400, height: 24 }`, where `index` is the element's position in the case's array.
- Every `a` element gets `attributes.href = "/x"`, merged into its attributes. The real extractor captures `href`, and the rules treat a link as a control only when it has one.

`judge-eval-dev-baseline.json` holds the rules-only outcome of every dev case under these defaults, at commit `f1253c8`.

Element shapes follow the extractor:

- Ids are `el-<path>` in pre-order; a parent's id is a prefix of its children's ids.
- Controls, `label`, `a[href]`, `summary` and `[role]` elements carry their whole `innerText`. A `role="dialog"` container therefore repeats its buttons' text.
- Other elements carry their own text only. A split claim such as `<p>Only <span>2</span> left — order soon</p>` appears as the parent `"Only left — order soon"` and the child `"2"`.
- Labels are linked to inputs by nesting or sibling order, not by `for`.

## Labelling rubric

Every case is decidable from one sample's text, structure and computed styles. No reload data, no ground truth.

| Pattern | flag | clean (honest look-alike) |
|---|---|---|
| fake-urgency | A time limit on an offer, price or purchase that is undated, rolling ("today only", "ends tonight"), personal ("held for you for 10 minutes") or pressured ("hurry", "last chance") | Deadlines true by nature (shipping cut-off, opening hours, session timeout), calendar-dated sales, holiday countdowns without an offer deadline, durations that are not deadlines (video length, battery, cooking time, return window) |
| fake-scarcity | A low-stock or limited-availability claim that is vague ("almost sold out") or carries pressure ("order soon", "!", "hurry") | Neutral stock facts (a bare count, a plain "only N left" with no pressure), sold-out notices, stated edition sizes, purchase limits, restock and pre-order dates |
| fake-activity | Live or recent activity of other shoppers: viewers now, baskets now, "X from Y just bought", counts in the last hour or day | Cumulative ratings and review counts, dated reviews, lifetime totals, the user's own order status or history, helpfulness votes, rankings |
| confirmshaming | A decline or opt-out option worded to shame, guilt or mock the user | Neutral declines (postponing, shopping without an account, plain consequences), shaming-like words that are not a decline (review text, information) |
| preselection | A pre-ticked or pre-selected option that adds cost, a recurring charge, marketing or data sharing | Required terms or age boxes, free or cheapest defaults, neutral conveniences, unticked opt-ins, free transactional options |
| visual-interference | In a choice, the user-serving option (reject, decline, close, the free option) is much harder to see or hit: tiny, or contrast below about 2:1, while the alternative is prominent | Comparable prominence, differing styles that stay readable, small elements that are not part of a choice, disabled buttons |

## Scoring

Run the judge (or rules, or both) on each case's elements as one page. Then, for findings whose `patternId` equals the case's `pattern`:

- **Flag case hit:** at least one finding, at any confidence, whose `elementIds` include `evidenceElementId` or any of `relatedElementIds`. A finding of the right pattern on another element is a **misplaced hit** and counts as a miss.
- **Clean case false positive:** any finding of the case's pattern. When `tolerateLow` is true, a **low** finding is reported as "tolerated low" and not counted as a false positive; medium or high still is.
- Report false positives at **any confidence** and at **medium or high** separately.
- Findings in a review result's `setAside` list are not counted.
- Findings of other patterns are reported as **off-pattern** findings, separately. Cases were written to hold only their own pattern; an off-pattern finding on a clean case deserves a look but is not scored.

Report recall and false positives per pattern and per language, plus the totals. Keep rules-only, judge-only and rules+judge in separate columns.

## Hash

The sha256 of `dev.json` at creation is recorded in the design note (`model-judge-design.md`, section 7). Recompute it before quoting a figure.
