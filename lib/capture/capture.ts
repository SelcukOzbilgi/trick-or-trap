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
import { BaseSnapshotSchema, PageSnapshotSchema, type BaseSnapshot, type PageSnapshot } from "@/lib/types";
import { getBrowser } from "./browser";
import { createDeadline, createSystemClock, withTimeout, type Clock, type StageLimit } from "./clock";
import { getCaptureConfig, type CaptureConfig } from "./config";
import {
  API_FETCH_TIMEOUT_MS,
  BROWSER_VIEWPORT,
  CAPTURE_TIMEOUT_MS,
  COLLECT_LIMITS,
  MAX_ATTR_CHARS,
  MAX_ELEMENTS,
  MAX_ELEMENTS_LIGHT,
  MAX_TEXT_CHARS,
  MAX_TEXT_CHARS_LIGHT,
  NAVIGATION_TIMEOUT_MS,
  RELOAD_MIN_REMAINING_MS,
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
  type CaptureErrorCode,
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
  /** Makes the random id of one capture. Default: `crypto.randomUUID()`. Never derived from the URL or the key. */
  newCaptureId: () => string;
}

/** What one capture shares between its steps and the cleanup after them. */
type CaptureContext = {
  handle?: BrowserSessionHandle;
  secrets: string[];
  warnings: Set<CaptureWarningCode>;
  /** Set when a guard refused a main-frame navigation request. */
  navigationBlocked: boolean;
};

type CaptureSuccess = { snapshot: PageSnapshot; images: CaptureImage[] };

/** Attributes of the light reload sample. */
const LIGHT_ATTRIBUTE_NAMES: readonly string[] = ["type", "name", "disabled"];

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    clock.setTimer(ms, resolve);
  });
}

function ignore(): void {}

function toCaptureError(error: unknown, secrets: readonly string[]): CaptureError {
  if (error instanceof CaptureFailure) {
    const result: CaptureError = { code: error.code, message: ERROR_MESSAGES[error.code] };
    // The detail is redacted where it is made; redacting again costs nothing.
    const detail = toDetail(error.detail, secrets);
    if (detail !== undefined) result.detail = detail;
    return result;
  }
  const result: CaptureError = { code: "internal-error", message: ERROR_MESSAGES["internal-error"] };
  const detail = toDetail(error, secrets);
  if (detail !== undefined) result.detail = detail;
  return result;
}

/**
 * Gives an error from one stage the code of that stage. A `CaptureFailure` keeps its
 * own code; anything else becomes `code` with a redacted `detail`. The raw text never
 * reaches `message`.
 */
function asStageFailure(error: unknown, code: CaptureErrorCode, secrets: readonly string[]): CaptureFailure {
  if (error instanceof CaptureFailure) return error;
  return new CaptureFailure(code, toDetail(error, secrets));
}

/**
 * Stops a session with its own deadline, apart from the whole-capture budget. A failure
 * or a timeout becomes the warning `session-stop-failed`; it never throws.
 */
async function stopSafely(handle: BrowserSessionHandle, clock: Clock, warnings: Set<CaptureWarningCode>): Promise<void> {
  try {
    // The code of the rejection never leaves this function: every failure is the warning.
    await withTimeout(clock, API_FETCH_TIMEOUT_MS, (async () => handle.stop())(), "capture-timeout");
  } catch {
    warnings.add("session-stop-failed");
  }
}

async function runCapture(
  url: string,
  deps: Partial<CaptureDeps>,
  clock: Clock,
  ctx: CaptureContext,
): Promise<CaptureSuccess> {
  const deadline = createDeadline(clock, CAPTURE_TIMEOUT_MS);
  /**
   * Runs one step inside the whole-capture budget, or inside `limit` when that is
   * shorter. A synchronous throw becomes a rejection. An error that is not a
   * `CaptureFailure` gets `code`; without a `code` it stays as it is and ends up as
   * `internal-error`.
   */
  const step = async <T>(call: () => Promise<T>, code?: CaptureErrorCode, limit?: StageLimit): Promise<T> => {
    try {
      return await deadline.run((async () => call())(), limit);
    } catch (error) {
      if (code === undefined) throw error;
      throw asStageFailure(error, code, ctx.secrets);
    }
  };

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
  const urlOptions = { resolver };

  // Verdict per origin, so each redirect hop on the same origin does not repeat the DNS
  // lookup. The syntax checks run on every URL; the key is the origin and not the host
  // because the checks depend on scheme and port.
  const verdicts = new Map<string, Promise<UrlErrorCode | null>>();
  const inspect = async (candidate: string): Promise<UrlCheckResult> => {
    const syntax = checkUrlSyntax(candidate);
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

  // 3. Session. If the whole budget ends while the creation is still pending, the
  // session that arrives later is stopped, because nobody else knows about it.
  const creation = (async () =>
    browserResult.browser.createSession({
      timeoutMinutes: config.sessionTimeoutMinutes,
      proxy: config.proxy,
      viewport: { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height },
      captureId: (deps.newCaptureId ?? (() => globalThis.crypto.randomUUID()))(),
    }))();
  try {
    ctx.handle = await step(() => creation, "session-create-failed", {
      ms: API_FETCH_TIMEOUT_MS,
      code: "session-create-timeout",
    });
  } catch (error) {
    if (error instanceof CaptureFailure && error.code === "capture-timeout") {
      // The result is already gone, so a failing stop has nobody to warn: its warnings
      // go to a set that is thrown away.
      creation.then((late) => stopSafely(late, clock, new Set<CaptureWarningCode>()), ignore);
    }
    throw error;
  }
  const handle = ctx.handle;

  // 4. Connection and guards.
  const page = await step(() => handle.connect({ timeoutMs: CDP_CONNECT_TIMEOUT_MS }), "connect-failed", {
    ms: CDP_CONNECT_TIMEOUT_MS,
    code: "connect-timeout",
  });
  const guards: PageGuards = {
    async allowNavigation(candidate) {
      const verdict = await inspect(candidate);
      return verdict.ok ? { allowed: true } : { allowed: false, reason: verdict.code };
    },
    report(event) {
      if (event.kind === "request-blocked") ctx.navigationBlocked = true;
      ctx.warnings.add(event.kind);
    },
  };
  await step(() => page.installGuards(guards), "connect-failed");

  // 5. Navigation, then the same checks on where the browser ended up.
  let navigation: { finalUrl: string };
  try {
    navigation = await step(() => page.goto(requested.url, { timeoutMs: NAVIGATION_TIMEOUT_MS }), "navigation-failed", {
      ms: NAVIGATION_TIMEOUT_MS,
      code: "navigation-timeout",
    });
  } catch (error) {
    // A guard that aborted the request makes the browser fail the navigation.
    if (ctx.navigationBlocked) throw new CaptureFailure("navigation-blocked");
    throw error;
  }
  const landed = await step(() => inspect(navigation.finalUrl));
  if (!landed.ok) throw new CaptureFailure("navigation-blocked");
  if (landed.url !== requested.url) ctx.warnings.add("redirected");

  // 6. Settle, 7. one read of the page.
  await step(() => sleep(clock, SETTLE_DELAY_MS));
  const raw = await step(
    () =>
      page.collect({
        maxElements: MAX_ELEMENTS,
        maxTextChars: MAX_TEXT_CHARS,
        maxAttrChars: MAX_ATTR_CHARS,
        attributeNames: "full",
        limits: COLLECT_LIMITS,
      }),
    "page-read-failed",
  );
  const capturedAt = new Date(clock.now()).toISOString();

  // 8. Screenshots from the same load. The sample is built afterwards because it needs
  // the image boxes to flag elements outside every image.
  let shots: Awaited<ReturnType<typeof captureImages>>;
  try {
    shots = await captureImages(page, raw, deadline);
  } catch (error) {
    throw asStageFailure(error, "screenshot-failed", ctx.secrets);
  }
  for (const code of shots.warnings) ctx.warnings.add(code);

  /**
   * Reloads the page in the same session and reads it again with the light options.
   * Every failure, including a block, a timeout and an invalid sample, becomes the
   * warning `reload-failed`; the result is then `undefined`.
   */
  const takeReloadSample = async (): Promise<BaseSnapshot | undefined> => {
    const remaining = deadline.remainingMs();
    if (remaining < RELOAD_MIN_REMAINING_MS) {
      ctx.warnings.add("reload-skipped");
      return undefined;
    }
    try {
      const navigationMs = Math.min(NAVIGATION_TIMEOUT_MS, remaining);
      const reloaded = await step(() => page.reload({ timeoutMs: navigationMs }), undefined, {
        ms: navigationMs,
        code: "navigation-timeout",
      });
      const reloadedAt = await step(() => inspect(reloaded.finalUrl));
      if (!reloadedAt.ok) throw new CaptureFailure("navigation-blocked");
      await step(() => sleep(clock, SETTLE_DELAY_MS));
      const reloadRaw = await step(() =>
        page.collect({
          maxElements: MAX_ELEMENTS_LIGHT,
          maxTextChars: MAX_TEXT_CHARS_LIGHT,
          maxAttrChars: MAX_ATTR_CHARS,
          attributeNames: LIGHT_ATTRIBUTE_NAMES,
          limits: COLLECT_LIMITS,
        }),
      );
      const second = buildSample(reloadRaw, {
        light: true,
        url: reloadedAt.url,
        capturedAt: new Date(clock.now()).toISOString(),
      });
      const checked = BaseSnapshotSchema.safeParse(second);
      if (!checked.success) throw new CaptureFailure("snapshot-invalid");
      return checked.data;
    } catch {
      ctx.warnings.add("reload-failed");
      return undefined;
    }
  };
  const sample = buildSample(raw, { light: false, url: landed.url, capturedAt, images: shots.meta });
  if (sample.capture?.elementsTruncated) ctx.warnings.add("elements-truncated");

  // 9. Second sample after a reload. Never throws and never changes the first capture.
  const afterReload = await takeReloadSample();
  const assembled = afterReload ? { ...sample, afterReload } : sample;

  // 10. Validation.
  const parsed = PageSnapshotSchema.safeParse(assembled);
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
  const ctx: CaptureContext = { secrets: [], warnings: new Set<CaptureWarningCode>(), navigationBlocked: false };

  let outcome: { ok: true; success: CaptureSuccess } | { ok: false; error: CaptureError };
  try {
    outcome = { ok: true, success: await runCapture(url, deps, clock, ctx) };
  } catch (error) {
    outcome = { ok: false, error: toCaptureError(error, ctx.secrets) };
  } finally {
    // Stop the session exactly once on every path, with its own deadline.
    if (ctx.handle) await stopSafely(ctx.handle, clock, ctx.warnings);
  }

  const warnings: CaptureWarning[] = Array.from(ctx.warnings, (code) => ({
    code,
    message: WARNING_MESSAGES[code],
  }));
  return outcome.ok
    ? { ok: true, snapshot: outcome.success.snapshot, images: outcome.success.images, warnings }
    : { ok: false, error: outcome.error, warnings };
}
