---
inclusion: always
---

# Findings wording rules

These rules apply to every user-facing string produced by detectors, the judge, and the UI. They also govern any copy written for finding cards, tooltips, and summaries.

## Required wording

- Every finding title and description **must start with "Possible"** — for example, "Possible fake urgency" not "Fake urgency detected".
- Every finding must state the on-page evidence: quote or describe exactly what was observed (the text, the element, the measured numbers). Do not paraphrase beyond what the page shows.
- Every finding must include a confidence level — **high**, **medium**, or **low** — written out as a word, not a colour alone.
- Every result page must carry a date-stamp showing when the scan ran.

## What findings describe

- Describe what is on the screen. Do not assert intent or describe what the shop owner meant to do.
- Never use the words **illegal**, **scam**, or **fraud** in any user-facing text.
- Never state that a finding is definitely a dark pattern; always frame it as possible.

## Confidence rubric

| Level | When to use |
|---|---|
| **High** | At least two independent signal classes agree, and at least one is a measured or behavioural signal — reload variance, clock-forward result, computed contrast or area ratio, or a cart/price diff. Example: countdown text that restarts on reload. |
| **Medium** | One strong deterministic signal (a text pattern with supporting context, a preselected paid option), or an LLM classification plus one weak deterministic signal. Example: "Only 2 left" with no reload test run. |
| **Low** | Text-only or LLM-only match with no measured evidence. Example: a "Selling fast" badge. |

Additional confidence caps:

- Stock counts and activity claims ("N viewing", "N left") are capped at **medium** unless the number changes across two independent loads. Real inventory is not visible to the detector.
- Any finding where a look-alike rule matches — a fixed calendar deadline, equal-prominence buttons, a neutral cheapest-default selection — is capped at **low**.

## Other result-page rules

- Result pages must set `noindex` / `X-Robots-Tag: noindex`. They must not appear in search engine results.
- There are no shop rankings, scores, or league tables anywhere in the UI.
- Include a one-line disclaimer on every result: "Automated detection — may be wrong."
