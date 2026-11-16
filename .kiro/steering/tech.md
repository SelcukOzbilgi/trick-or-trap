---
inclusion: always
---

# Tech stack and architecture

## Core stack

- **Next.js App Router** with TypeScript strict mode throughout.
- **Tailwind CSS** with **shadcn/ui** components. Tailwind uses CSS-first configuration: `app/globals.css` imports `tailwindcss` and declares design tokens in an `@theme` block; PostCSS uses the `@tailwindcss/postcss` plugin; there is no `tailwind.config.ts` unless the installed version requires one.
- **Vitest** for unit and integration tests.
- **Playwright** for browser capture and flow walking.
- **Supabase** Postgres for scan results and Storage for screenshots.
- **Zod** for all runtime validation of external and internal data shapes.

## Browser seam

All browser access goes through a single `getBrowser()` function. It has three modes, selected by environment:

1. **Local Chromium** — used in tests and local development; launches a local Playwright browser.
2. **Remote browser over CDP** — used in production; connects to a Browser Use Cloud browser endpoint via CDP.
3. **Bundled Chromium fallback** — `@sparticuz/chromium-min` on Vercel, used when the CDP endpoint is unavailable.

No code outside `lib/capture` calls Playwright directly. This seam makes the detectors fully testable without a live browser.

## Detectors

Detectors are pure TypeScript functions. Each detector receives a `PageSnapshot` (DOM text, computed styles, element boxes, checkbox states, reload samples) and returns an array of `Finding` objects. `Finding` and `PageSnapshot` are defined in `lib/types` and validated with Zod. Detectors have no side effects and no network calls.

## LLM judge

One small language model (default: Claude Haiku 5.5; fallback: Gemini 2.5 Flash-Lite) is used for confirmshaming classification and borderline visual-interference cases. It sits behind a `Judge` interface so tests can inject a mock that returns deterministic results without any network call.

## Flow walker (phase 2)

The phase-2 walker navigates multi-step Boo-tique flows using Playwright. Navigation decisions go through a `Decider` interface with two implementations:

- **Model Decider** — sends the current control table to the LLM and receives a control index to click.
- **Fallback Decider** — a scripted fallback for when the model is unavailable or during tests.

After each step the walker takes a `PageSnapshot` and diffs cart line items and displayed totals. Findings come from those diffs, not from agent claims.

## External interfaces

Every external dependency — the browser endpoint, the LLM judge, Supabase — sits behind a TypeScript interface. Tests inject in-memory fakes. No test ever makes a real network call.

## Secrets and environment variables

Secrets live only in environment variables. They are never committed to the repository. `.env.example` lists the required variable names with empty values (`NAME=`) and a one-line comment each, with no placeholder values, and is the only `.env*` file in version control. **The agent must not read or write `.env` files** — only `.env.example`.

## Data model (Supabase)

- `scans` table: `id`, URL hash, status, `result` as jsonb, `screenshot_path`, IP hash, `created_at`.
- Screenshots go to Supabase Storage; API responses return a URL to avoid the 4.5 MB Vercel response-body limit.
- Results are cached for 24 hours by normalised URL.
- A Vercel cron (once daily) keeps the Supabase free project awake during the judging period.

## Abuse protections

- SSRF checks on every browser navigation and redirect: allow only HTTP/HTTPS on ports 80 and 443; resolve DNS and block private, loopback, link-local, and metadata ranges.
- Per-IP rate limiting: 5 scans per 10 minutes, 20 per day.
- Hard timeouts: navigation 15 s, total scan 45 s.
- Global daily scan cap and per-provider spend caps.
- Phase 2 is allowed only on allowlisted hosts (The Boo-tique). The walker never clicks pay, place-order, or confirm.
