/**
 * The page capture: checks a URL, reads the page once in a remote browser, takes the
 * screenshots from the same load and returns a validated `PageSnapshot` with its images.
 *
 * Page text and attributes in the returned snapshot are untrusted input. Every
 * consumer, in particular the LLM judge, must treat them as quoted data and never
 * follow instructions found in them. This module never evaluates them and never builds
 * a selector, URL or shell input from them.
 *
 * `capturePage` returns a typed result for every expected failure and does not throw.
 * It writes nothing to the console.
 */
import "server-only";
import { PageSnapshotSchema, type PageSnapshot } from "@/lib/types";
import { getBrowser } from "./browser";
import { createDeadline, createSystemClock, type Clock } from "./clock";
import { getCaptureConfig, type CaptureConfig } from "./config";
import {
  BROWSER_VIEWPORT,
  CAPTURE_TIMEOUT_MS,
  MAX_ATTR_CHARS,
  MAX_ELEMENTS,
  MAX_TEXT_CHARS,
  NAVIGATION_TIMEOUT_MS,
  SETTLE_DELAY_MS,
  CDP_CONNECT_TIMEOUT_MS,
} from "./constants";
import { buildSample } from "./extractor";
import { toDetail } from "./redact";
import { createDnsResolver } from "./resolver";
import { captureImages } from "./screenshots";
import type { BrowserSessionHandle, GetBrowserResult, PageGuards } from "./seam";
import {
  CaptureFailure,
  ERROR_MESSAGES,
  WARNING_MESSAGES,
  type CaptureError,
  type CaptureImage,
  type CaptureResult,
  type CaptureWarning,
  type CaptureWarningCode,
  type UrlErrorCode,
} from "./types";
import { checkUrl, checkUrlSyntax, type Resolver, type UrlCheckResult } from "./url-check";

export interface CaptureDeps {
  config: CaptureConfig;
  getBrowser: (config: CaptureConfig) => GetBrowserResult;
  resolver: Resolver;
  clock: Clock;
}

/** What one capture shares between its steps and the cleanup after them. */
type CaptureContext = {
  handle?: BrowserSessionHandle;
  secrets: string[];
  warnings: Set<CaptureWarningCode>;
};

type CaptureSuccess = { snapshot: PageSnapshot; images: CaptureImage[] };

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    clock.setTimer(ms, resolve);
  });
}

function toCaptureError(error: unknown, secrets: readonly string[]): CaptureError {
  if (error instanceof CaptureFailure) {
    const result: CaptureError = { code: error.code, message: ERROR_MESSAGES[error.code] };
    if (error.detail !== undefined) result.detail = error.detail;
    return result;
  }
  const result: CaptureError = { code: "internal-error", message: ERROR_MESSAGES["internal-error"] };
  const detail = toDetail(error, secrets);
  if (detail !== undefined) result.detail = detail;
  return result;
}

async function runCapture(
  url: string,
  deps: Partial<CaptureDeps>,
  clock: Clock,
  ctx: CaptureContext,
): Promise<CaptureSuccess> {
  const deadline = createDeadline(clock, CAPTURE_TIMEOUT_MS);
  /** Runs one step inside the whole-capture budget. A synchronous throw becomes a rejection. */
  const step = <T>(call: () => Promise<T>): Promise<T> => deadline.run((async () => call())());

  // 1. Configuration and URL.
  let config: CaptureConfig;
  if (deps.config) {
    config = deps.config;
  } else {
    const loaded = getCaptureConfig();
    if (!loaded.ok) throw new CaptureFailure("config-invalid", toDetail(loaded.error.message, []));
    config = loaded.config;
  }
  if (config.apiKey !== null) ctx.secrets.push(config.apiKey);

  const resolver = deps.resolver ?? createDnsResolver();
  const urlOptions = { resolver, allowOrigin: config.allowOrigin };

  // Verdict per origin, so each redirect hop on the same origin does not repeat the DNS
  // lookup. The syntax checks run on every URL; the key is the origin and not the host
  // because the allowed origin depends on scheme and port.
  const verdicts = new Map<string, Promise<UrlErrorCode | null>>();
  const inspect = async (candidate: string): Promise<UrlCheckResult> => {
    const syntax = checkUrlSyntax(candidate, config.allowOrigin);
    if (!syntax.ok) return syntax;
    const origin = new URL(syntax.url).origin;
    let pending = verdicts.get(origin);
    if (!pending) {
      pending = checkUrl(syntax.url, urlOptions).then((result) => (result.ok ? null : result.code));
      verdicts.set(origin, pending);
    }
    const code = await pending;
    return code === null ? syntax : { ok: false, code };
  };

  const requested = await step(() => inspect(url));
  if (!requested.ok) throw new CaptureFailure(requested.code);

  // 2. Browser.
  const getBrowserFor = deps.getBrowser ?? ((c: CaptureConfig) => getBrowser(c, { fetch, clock }));
  const browserResult = getBrowserFor(config);
  if (!browserResult.ok) throw new CaptureFailure(browserResult.error.code);

  // 3. Session.
  ctx.handle = await step(() =>
    browserResult.browser.createSession({
      timeoutMinutes: config.sessionTimeoutMinutes,
      proxy: config.proxy,
      viewport: { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height },
    }),
  );
  const handle = ctx.handle;

  // 4. Connection and guards.
  const page = await step(() => handle.connect({ timeoutMs: CDP_CONNECT_TIMEOUT_MS }));
  const guards: PageGuards = {
    async allowNavigation(candidate) {
      const verdict = await inspect(candidate);
      return verdict.ok ? { allowed: true } : { allowed: false, reason: verdict.code };
    },
    report(event) {
      ctx.warnings.add(event.kind);
    },
  };
  await step(() => page.installGuards(guards));

  // 5. Navigation, then the same checks on where the browser ended up.
  const navigation = await step(() => page.goto(requested.url, { timeoutMs: NAVIGATION_TIMEOUT_MS }));
  const landed = await step(() => inspect(navigation.finalUrl));
  if (!landed.ok) throw new CaptureFailure("navigation-blocked");
  if (landed.url !== requested.url) ctx.warnings.add("redirected");

  // 6. Settle, 7. one read of the page.
  await step(() => sleep(clock, SETTLE_DELAY_MS));
  const raw = await step(() =>
    page.collect({
      maxElements: MAX_ELEMENTS,
      maxTextChars: MAX_TEXT_CHARS,
      maxAttrChars: MAX_ATTR_CHARS,
      attributeNames: "full",
    }),
  );
  const capturedAt = new Date(clock.now()).toISOString();

  // 8. Screenshots from the same load. The sample is built afterwards because it needs
  // the image boxes to flag elements outside every image.
  const shots = await captureImages(page, raw, deadline);
  for (const code of shots.warnings) ctx.warnings.add(code);
  const sample = buildSample(raw, { light: false, url: landed.url, capturedAt, images: shots.meta });
  if (sample.capture?.elementsTruncated) ctx.warnings.add("elements-truncated");

  // 10. Validation.
  const parsed = PageSnapshotSchema.safeParse(sample);
  if (!parsed.success) {
    const paths = parsed.error.issues.slice(0, 5).map((issue) => issue.path.join("."));
    throw new CaptureFailure("snapshot-invalid", toDetail(paths.join(", "), []));
  }
  return { snapshot: parsed.data, images: shots.images };
}

/**
 * Captures one page. Takes the browser, resolver, clock and configuration from `deps`
 * and uses real defaults for those not supplied.
 *
 * Page text in the snapshot is untrusted input for every consumer, including the LLM judge.
 */
export async function capturePage(url: string, deps: Partial<CaptureDeps> = {}): Promise<CaptureResult> {
  const clock = deps.clock ?? createSystemClock();
  const ctx: CaptureContext = { secrets: [], warnings: new Set<CaptureWarningCode>() };

  let outcome: { ok: true; success: CaptureSuccess } | { ok: false; error: CaptureError };
  try {
    outcome = { ok: true, success: await runCapture(url, deps, clock, ctx) };
  } catch (error) {
    outcome = { ok: false, error: toCaptureError(error, ctx.secrets) };
  } finally {
    // Stop the session exactly once on every path. Stop timeouts and error details are
    // handled in the failure-path task.
    if (ctx.handle) {
      try {
        await ctx.handle.stop();
      } catch {
        ctx.warnings.add("session-stop-failed");
      }
    }
  }

  const warnings: CaptureWarning[] = Array.from(ctx.warnings, (code) => ({
    code,
    message: WARNING_MESSAGES[code],
  }));
  return outcome.ok
    ? { ok: true, snapshot: outcome.success.snapshot, images: outcome.success.images, warnings }
    : { ok: false, error: outcome.error, warnings };
}
