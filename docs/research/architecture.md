# Architecture recommendation

Date: 2026-11-15

Research input prepared before implementation (not written by Kiro). Items marked [E] are estimates or inferences, and items marked [CNV] could not be verified.

Tags: **[R url]** means read on that page on 2026-11-15. **[E]** means own estimate or inference. **[CNV]** means could not verify.

## 0. Correct this first: Browser Use's "ultrafast" is not Jev

- The hosted `bu-ultrafast` runs on GPT-6 Luna, not Jev. The docs say it "runs Browser Use Pi in ultrafast mode on GPT-6 Luna with low reasoning and OpenAI's priority tier" and is available on every plan, including free [R https://docs.browser-use.com/cloud/agent/ultrafast].
- The open-source `Agent(task, mode='ultrafast')` is not Jev either. Its own example passes `ChatOpenAI('gpt-6-luna')`. "Ultrafast" names the numbered-element action style, not the model [R https://docs.browser-use.com/open-source/ultrafast].
- Real Jev exists only in the original `browser-use/jev-ultrafast` Python repo, now labelled "the original experiment". It needs a `TYPESAFE_API_KEY` plus an OpenRouter text-model key, and it drives Chrome through Browser Harness [R https://github.com/browser-use/jev-ultrafast].
  - The reported limits are correct for that agent loop. Its README excludes shadow roots, frames, canvas, uploads, pop-up tabs and nested scrolling, and says a `DONE` still needs independent outcome checking.
- Jev the model now accepts images (Jev 1.14 post, Oct 14) [R https://typesafe.ai/blog/jev-1-14]. So "DOM-only" describes the agent loop, not the model.
- Price: $0.042 per million input tokens; output is free [R https://docs.typesafe.ai/models].
- Access: early access off a waitlist as of Sept 15 [R https://typesafe.ai/blog/introducing-system-one-models-and-jev]. Whether that is still true: [CNV].
- **The choice:** real Jev (a key that may not arrive within 19 days) or `bu-ultrafast` (the same numbered-element idea, usable today). The design below lets Jev plug in later without depending on it.

The "Python vs Next.js" problem mostly goes away. There is a TypeScript SDK (`browser-use-sdk/v4`) and a plain `POST /api/v4/runs` endpoint [R https://docs.browser-use.com/cloud/agent/ultrafast]. A v4 run accepts `outputSchema` and `maxCostUsd` and returns an `eventsUrl` [R https://docs.browser-use.com/cloud/api-v4/runs/create-run]. Whether it gives per-step screenshots: [CNV].

## 1. Where the phase-1 browser runs

| Option | Full-page screenshot + DOM boxes and computed styles in the same load? | Cold start / scan | Free tier | Per 1,000 scans | Hard limits | Setup pain |
|---|---|---|---|---|---|---|
| Playwright/Puppeteer + `@sparticuz/chromium-min` in a Vercel function | Yes, any `page.evaluate` | ~5–10 s cold, 8–20 s per scan [E] | Hobby: 4 h Active CPU, 360 GB-h, 1M invocations [R https://vercel.com/pricing]; ~1.5–3k scans a month [E] | ~$0 inside free; Pro $20/mo + $0.128/CPU-h [R https://vercel.com/pricing] | 250 MB bundle, 300 s max on Hobby, 2 GB, **4.5 MB response body** [R https://vercel.com/docs/functions/limitations]. The template README's "10 s" is stale. | Medium. Official guide exists, but Chromium and puppeteer-core versions must be pinned together [R https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel] |
| Vercel Sandbox | Yes, presumably (full VM) [CNV] | Slower, browser install per sandbox [E] | 5 CPU-h, 420 GB-h, 5k creations [R https://vercel.com/pricing] | ~$0.5 [E] | [CNV] | High |
| Cloudflare Browser Run (renamed from Browser Rendering) | Yes, through the Workers Puppeteer/Playwright binding. REST endpoint list [CNV] | 2–5 s [E] | Free: 10 browser-min a day, 3 concurrent, 1 new browser per 20 s [R https://developers.cloudflare.com/browser-run/pricing/, https://developers.cloudflare.com/browser-run/limits/] | Paid: 10 h/mo, then $0.09/h → ~$0.5 [E] | 60 s idle timeout [R https://developers.cloudflare.com/browser-run/limits/] | Medium–high: separate Worker/Wrangler project and runtime |
| Browserbase | Yes (CDP) | 1–3 s [E] | 1 browser-hour, 3 concurrent, 15 min sessions [R https://www.browserbase.com/pricing] | Developer $20/mo for 100 h, $0.12/h overage [R https://www.browserbase.com/pricing] | Low free tier | Low |
| Browser Use Cloud browser over CDP | Yes; docs say it is driven over CDP with Playwright [R https://docs.browser-use.com] | 2–5 s [E] | $1 one-time credit; 10 concurrent at $0 paid [R https://browser-use.com/pricing] | $0.06/h billed per minute (1-min minimum) ≈ $1, plus ~$1 traffic at $0.20/GB direct → **~$2** [E] | Third-party sites quoting $0.02/h are outdated; the official page says $0.06 [R https://browser-use.com/pricing] | Low; same vendor as phase 2 |
| Always-on container (Fly) | Yes | No cold start; 5–15 s per scan [E] | None for new accounts (third-party: https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/) | shared-cpu 2 GB ≈ $12.70/mo flat [R https://fly.io/learn/paas-pricing-compared/] | Render's free tier sleeps after 15 min with ~1 min cold start (same source) | Medium: Dockerfile, second deploy, auth between services |
| Firecrawl | Partly: `screenshot{fullPage}` and `executeJavascript` actions; returns come back in `actions.javascriptReturns` [R https://docs.firecrawl.dev/advanced-scraping-guide] | 5–15 s [E] | 1,000 credits a month; Hobby $19 for 5k [R https://www.firecrawl.dev/pricing] | 1 credit per page base; extra credits for actions/screenshot [CNV] | Black box; the reload comparison costs a second scrape | Low |

## 2. Phase 2 options

| Option | What you get back | Cost per flow |
|---|---|---|
| A. Hosted `bu-ultrafast` from a Next.js route (TypeScript SDK) | `result`, an `output` checked against your schema, `eventsUrl`. In v3: last screenshot and recording URLs [R https://docs.browser-use.com/cloud/api-v3/sessions/get-session]. Per-step evidence [CNV]. Findings rest on what the agent says about itself. | $0.006 median task [R https://browser-use.com/pricing] + browser minutes ≈ $0.01 [E] |
| B. Real Jev Python repo | The richest decision trace, but it needs a Python host (Fly or Sandbox) and a way to attach it to a remote browser [CNV]. Needs a TypeSafe key. | ~$0.0001 model cost [E] |
| **C. Own TypeScript walker (recommended)** | Playwright on the same CDP browser. It reuses the phase-1 extractor to build the numbered control table and calls a `Decider` interface: Jev over TypeSafe HTTP if a key arrives (up to 255 choices [R https://typesafe.ai/blog/introducing-system-one-models-and-jev]), otherwise Claude Haiku 5.5 picking an index. At each step it records cart lines, totals and a screenshot with coordinates. Sneak-into-basket and drip pricing then come from **deterministic diffs**, not from agent claims. | ~8 steps × 3k tokens on Haiku ≈ $0.003 + browser ≈ **$0.005** [E] |

One backend then serves both phases, all in TypeScript. Keep A as the fallback.

## 3. Detection per pattern

| Pattern | Deterministic rules | Language model | Vision model |
|---|---|---|---|
| Fake urgency | Time-like text sampled twice 2 s apart (is it counting down?) plus a reload (does it reset?). The reset is strong evidence. | No | No |
| Fake scarcity | Regexes like "only N left", "N viewing", "N in carts"; a number that changes across two loads | Optional, for other languages | Only if the claim is rendered as an image |
| Confirmshaming | Find decline-style controls near modals or forms | **Yes**: classify guilt wording | No |
| Pre-checked boxes | `:checked` on load plus label text | Light: is it an add-on, insurance or newsletter, or harmless "remember me"? | No |
| Visual interference | Pair accept/decline in the same container; compare WCAG contrast ratio, font size, box area, opacity | No | Optional second opinion on a crop |

**Model:** use `claude-haiku-5-5` at $0.10 / $0.50 per million tokens (prompts up to 100k), vision supported [R https://platform.claude.com/docs/en/about-claude/pricing, https://platform.claude.com/docs/en/about-claude/models/overview].
- Cheap alternative: `gemini-2.5-flash-lite` at $0.10 / $0.40, with a free tier [R https://ai.google.dev/gemini-api/docs/pricing].
- Avoid `gemini-3.6/3.8-flash`. They cost $0.75 / $3.75 and **double to $1.50 / $7.50 on 2027-01-01, inside the judging period** [R https://ai.google.dev/gemini-api/docs/pricing].
- Sonnet 5.5 ($2 / $10) only for offline evaluation.

**Token assumptions** for one call per scan: rubric 1,500 + 25 candidates × 80 = 2,000 + optional crop ~1,300 ≈ 5,000 input and ~700 output [E].
- Haiku 5.5: ≈ $0.0009 per scan (~$0.9 per 1,000).
- Gemini 2.5 Flash-Lite: ≈ $0.0008.
- Sonnet 5.5: ≈ $0.017.
- **Whole stack: about $3 per 1,000 uncached scans** [E].

## 4. Data and state

Yes, a little is needed. Use **Supabase Postgres + Storage**:
- `scans` table: id, URL hash, status, result as jsonb, screenshot path, IP hash, created time.
- 24 h cache by normalized URL; `/r/[id]` share links; rate limits and the daily budget as count queries.
- Screenshots go to Storage and the API returns a URL, because of the 4.5 MB body limit.
- **Supabase pauses free projects after one week of low activity** [R https://supabase.com/pricing], and judging runs 2026-12-16 to 2027-01-29 [R https://kiroween.devpost.com/rules]. Add a Vercel cron; Hobby allows once a day [R https://vercel.com/docs/cron-jobs/usage-and-pricing].
- Commit a "golden" Boo-tique result as static JSON, as a last-resort fallback for the demo.

## 5. Abuse protections worth building, in priority order

1. A kill switch and a global daily scan cap, plus spend caps at each provider (prepaid Browser Use credit, `maxCostUsd` per run, an Anthropic spend limit).
2. SSRF checks on **every browser request and redirect**, not only the input URL:
   - in `page.route`, allow only http/https on ports 80/443;
   - resolve DNS and reject private, loopback, link-local, metadata and IPv6 equivalents;
   - block downloads and pop-ups.

   A remote browser takes most of this risk off our own network [E].
3. Per-IP rate limit, for example 5 scans per 10 min and 20 per day.
4. Hard timeouts: navigation 15 s, total 45 s, screenshot capped at about 6,000 px, JPEG.
5. The URL cache.
6. **Phase 2 only on allowlisted hosts (the Boo-tique)**, and never click pay, place-order or confirm.
7. No stealth or home-IP proxies (also $5/GB). Show a friendly "this site blocked us" result.
8. Cloudflare Turnstile behind a feature flag (free, no login).

## 6. Recommendation

**Next.js on Vercel. Playwright-core connects over CDP to a Browser Use Cloud browser behind a `getBrowser()` seam. Detectors are pure TypeScript rules plus a Haiku 5.5 judge. Supabase stores results. Phase 2 is our own TypeScript walker with a pluggable Decider (Haiku now, Jev if access arrives).**

Why: it stays inside the known stack and one a mid-tier Kiro agent can implement. Our server never hosts Chromium or Python. One vendor at about $0.002 per scan covers both phases. Locally, the same code runs on a local Chromium against the Boo-tique, so Kiro hooks can test the detectors for free. Evidence comes from code we own, so the fake shop gives repeatable, testable results.

**Components:**
- Next.js UI: scan form, screenshot overlay with monsters, finding card.
- `/api/scan` route on the Node runtime, `maxDuration` 60.
- `getBrowser()` with three modes: local, Browser Use CDP, and Sparticuz as fallback.
- Extractor script.
- Five detectors.
- LLM judge.
- Flow walker plus Decider.
- Supabase table and bucket.
- Daily cron.
- Boo-tique pages with a ground-truth manifest.

**Risks:**
1. **The browser vendor fails or credit runs out before 2027-01-29.** Fallback: switch `getBrowser()` to `@sparticuz/chromium-min` on Vercel (same Playwright code) and keep the golden Boo-tique result. Top up $10 once [E].
2. **The phase-2 walker is flaky, or no Jev key arrives.** Fallback: use the Haiku Decider. If it is still flaky, run a scripted Playwright walk of the Boo-tique flows (the diff detectors stay the same, and the UI says it is scripted), or hosted `bu-ultrafast` with `outputSchema`.

**Cut first:** the hard-to-cancel flow, then phase 2 on any site other than the Boo-tique, then the vision tier, then Turnstile, then the Jev Decider.

**Other things from the rules:**
- Request the **4,000 Kiro credits by Dec 1, 12:00 PT** [R https://kiroween.devpost.com/rules]. Which models they unlock: [CNV].
- The video may not show third-party trademarks, so demo on the Boo-tique.
- One app with a `/boo-tique` route group is simplest. The Skeleton Crew category would require two app folders.
- The repo needs a root `/.kiro` folder and an open-source license.
- Turkey is not on the excluded-countries list [R https://kiroween.devpost.com/rules].
- Vercel Hobby's commercial-use terms: [CNV].
- `/Users/efe/EFE/trick-or-trap` was empty at research time, so nothing constrained the layout.

## 7. Kiro specs, in order

1. **foundation-and-steering**: the app, the shared `Finding`/`PageSnapshot` zod types, a steering note on "possible" wording, and the test hook.
2. **boo-tique-static**: fake shop pages with the 5 phase-1 patterns and a `ground-truth.json` with selectors.
3. **page-capture**: `getBrowser()`, two samples, a reload, the extractor (boxes, styles, text, checkbox state), full-page JPEG.
4. **results-overlay**: monsters at box positions and the finding popover, fed from a fixture. Demoable early.
5. **detector-fake-scarcity**: the easiest one; gives an end-to-end check.
6. **scan-api-and-storage**: the route, Supabase, cache, `/r/[id]`, golden result. **First live demo.**
7. **detector-fake-urgency**: tick check and reload-reset check.
8. **detector-preselected-checkbox**.
9. **detector-visual-interference**: contrast, size and opacity pairing.
10. **llm-judge-and-confirmshaming**: Haiku with a JSON schema and confidence; mocked in tests.
11. **abuse-guards**: SSRF on every request, rate limits, budget, timeouts, kill switch. **Go public only after this spec.**
12. **boo-tique-flows**: sneak-into-basket, drip-pricing checkout, cancel maze, with ground truth.
13. **flow-walker**: control table, Decider interface (Haiku, optional Jev), per-step snapshots, diff detectors.
14. **polish-and-ops**: landing page and theme, error and "blocked" states, keep-alive cron, README and Kiro write-up.
