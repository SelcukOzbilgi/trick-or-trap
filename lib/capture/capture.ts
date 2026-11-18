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
  MAX_HOP_URL_LENGTH,
  MAX_SNAPSHOT_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_CHARS_LIGHT,
  NAVIGATION_TIMEOUT_MS,
  RELOAD_MIN_REMAINING_MS,
  SETTLE_DELAY_MS,
  STOP_TIMEOUT_MS,
  TILE_MIN_REMAINING_MS,
  CDP_CONNECT_TIMEOUT_MS,
  LAYOUT_DRIFT_PX,
} from "./constants";
import { buildSample, snapshotBytes } from "./extractor";
import { maxBoxDrift } from "./geometry";
import { createGuardPolicy } from "./guard-policy";
import { redactText, toDetail } from "./redact";
import { createDnsResolver } from "./resolver";
import { captureImages } from "./screenshots";
import type { BrowserProvider, BrowserSessionHandle, GetBrowserResult } from "./seam";
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
  type CollectOptions,
  type GuardReasonCode,
} from "./types";
import type { Resolver } from "./url-check";

export interface CaptureDeps {
  config: CaptureConfig;
  getBrowser: (config: CaptureConfig) => GetBrowserResult;
  resolver: Resolver;
  clock: Clock;
  /** Makes the random id of one capture. Default: `crypto.randomUUID()`. Never derived from the URL or the key. */
  newCaptureId: () => string;
  /**
   * Hands cleanup that must outlive the response to the platform (for example `after()`
   * or `waitUntil`). It receives the stop of a session that arrives after the whole
   * deadline, the stop call and the create clean-up. The promises it receives never
   * reject. An exception thrown by it is ignored.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** What one capture shares between its steps and the cleanup after them. */
type CaptureContext = {
  handle?: BrowserSessionHandle;
  /** The API key, and the secrets of the session once it exists. Redacted from every text. */
  secrets: string[];
  warnings: Set<CaptureWarningCode>;
  /** Set when a guard refused a main-frame navigation request. */
  navigationBlocked: boolean;
  /** Refused requests of this capture: how many, and the reason of the first. */
  blocked: { count: number; reason?: GuardReasonCode };
  /** Set when the guard was lost while the capture ran. From then on nothing is used and the capture fails. */
  lost: boolean;
  /** Rejects with `guard-lost` at the moment of the loss. Every stage races against it. */
  whenLost: Promise<never>;
  rejectLost: (error: CaptureFailure) => void;
  /** The one stop of this capture, once it has started (by a loss or by the clean-up). */
  stopping?: Promise<void>;
};

type CaptureSuccess = { snapshot: PageSnapshot; images: CaptureImage[] };

type CaptureOutcome = { ok: true; success: CaptureSuccess } | { ok: false; error: unknown };

/** Attributes of the light reload sample. */
const LIGHT_ATTRIBUTE_NAMES: readonly string[] = ["type", "name", "disabled"];

/** Options of the light reads: the layout drift re-read and the reload sample. */
const LIGHT_COLLECT_OPTIONS: CollectOptions = {
  maxElements: MAX_ELEMENTS_LIGHT,
  maxTextChars: MAX_TEXT_CHARS_LIGHT,
  maxAttrChars: MAX_ATTR_CHARS,
  attributeNames: LIGHT_ATTRIBUTE_NAMES,
  limits: COLLECT_LIMITS,
};

function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    clock.setTimer(ms, resolve);
  });
}

function ignore(): void {}

/** Passes a promise to `deps.waitUntil`. A missing or throwing `waitUntil` changes nothing. */
function handOff(deps: Partial<CaptureDeps>, promise: Promise<unknown>): void {
  try {
    deps.waitUntil?.(promise);
  } catch {
    // The platform hook failed; the cleanup still runs in this process.
  }
}

/** The secrets of a session handle. A handle that throws or returns junk gives none. */
function secretsOf(handle: BrowserSessionHandle): string[] {
  try {
    return Array.from(handle.secrets()).filter((secret): secret is string => typeof secret === "string");
  } catch {
    return [];
  }
}

function toCaptureError(error: unknown, secrets: readonly string[]): CaptureError {
  if (error instanceof CaptureFailure) {
    const result: CaptureError = { code: error.code, message: ERROR_MESSAGES[error.code] };
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
 * Builds the result of a capture. The only place that does it: every `error.detail` and
 * every text of every warning passes through `redactText` with the full secret list of
 * the capture here, whatever stage the text came from.
 */
function finalise(outcome: CaptureOutcome, ctx: CaptureContext): CaptureResult {
  const secrets = [...ctx.secrets, ...(ctx.handle ? secretsOf(ctx.handle) : [])];
  const warnings: CaptureWarning[] = Array.from(ctx.warnings, (code) => {
    const warning: CaptureWarning = { code, message: redactText(WARNING_MESSAGES[code], secrets) };
    if (code === "request-blocked" && ctx.blocked.reason !== undefined) {
      warning.reason = ctx.blocked.reason;
      warning.count = ctx.blocked.count;
    }
    return warning;
  });
  if (outcome.ok) {
    return { ok: true, snapshot: outcome.success.snapshot, images: outcome.success.images, warnings };
  }
  return { ok: false, error: toCaptureError(outcome.error, secrets), warnings };
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
 * Stops a session with its own deadline of `STOP_TIMEOUT_MS`, apart from the
 * whole-capture budget. A failure or a timeout becomes the warning
 * `session-stop-failed`; it never throws.
 */
async function stopSafely(handle: BrowserSessionHandle, clock: Clock, warnings: Set<CaptureWarningCode>): Promise<void> {
  try {
    // The code of the rejection never leaves this function: every failure is the warning.
    await withTimeout(clock, STOP_TIMEOUT_MS, (async () => handle.stop())(), "capture-timeout");
  } catch {
    warnings.add("session-stop-failed");
  }
}

/**
 * Starts the one stop of the capture, or returns the stop already running. The promise
 * goes to the platform as well, so a frozen function still finishes the stop. Without a
 * session handle there is nothing to stop and the result is `undefined`.
 */
function startStop(ctx: CaptureContext, clock: Clock, deps: Partial<CaptureDeps>): Promise<void> | undefined {
  if (ctx.stopping) return ctx.stopping;
  if (!ctx.handle) return undefined;
  ctx.stopping = stopSafely(ctx.handle, clock, ctx.warnings);
  handOff(deps, ctx.stopping);
  return ctx.stopping;
}

/**
 * One clean-up attempt after a create call that may have left a session behind. It is
 * bounded by `STOP_TIMEOUT_MS`, handed to `waitUntil` and never throws; a failure or a
 * timeout changes nothing in the result.
 */
async function reclaimOnce(
  provider: BrowserProvider,
  captureId: string,
  clock: Clock,
  deps: Partial<CaptureDeps>,
): Promise<void> {
  if (typeof provider.reclaim !== "function") return;
  const attempt = withTimeout(clock, STOP_TIMEOUT_MS, (async () => provider.reclaim?.(captureId))(), "capture-timeout").then(
    ignore,
    ignore,
  );
  handOff(deps, attempt);
  await attempt;
}

async function runCapture(
  url: string,
  deps: Partial<CaptureDeps>,
  clock: Clock,
  ctx: CaptureContext,
): Promise<CaptureSuccess> {
  const deadline = createDeadline(clock, CAPTURE_TIMEOUT_MS);
  /** Fails with `guard-lost` once the guard is lost. A shared constructor so every path gives the same error. */
  const lostFailure = (): CaptureFailure => new CaptureFailure("guard-lost");
  /**
   * Races `op` against the loss of the guard. When the guard is lost, `op` is not
   * waited for: its later outcome is absorbed. A result that arrives at the moment of
   * the loss is not used either.
   */
  const guarded = async <T>(op: Promise<T>): Promise<T> => {
    if (ctx.lost) {
      op.then(ignore, ignore);
      throw lostFailure();
    }
    const value = await Promise.race([op, ctx.whenLost]);
    if (ctx.lost) throw lostFailure();
    return value;
  };
  /**
   * Runs one step inside the whole-capture budget, or inside `limit` when that is
   * shorter. A synchronous throw becomes a rejection. An error that is not a
   * `CaptureFailure` gets `code`; without a `code` it stays as it is and ends up as
   * `internal-error`. A lost guard ends the step at once with `guard-lost`.
   */
  const step = async <T>(call: () => Promise<T>, code?: CaptureErrorCode, limit?: StageLimit): Promise<T> => {
    if (ctx.lost) throw lostFailure();
    try {
      return await guarded(deadline.run((async () => call())(), limit));
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

  // One policy for the whole capture: the input URL, every request of the guard and both
  // final-URL checks use its syntax checks and its one capped verdict cache.
  const policy = createGuardPolicy({
    resolver,
    report(event) {
      if (event.kind === "guard-lost") {
        // Not a warning: the capture ends. Start the stop now, reject the running stage,
        // and ignore a loss that arrives once the stop has begun (the capture's own stop).
        if (ctx.lost || ctx.stopping) return;
        ctx.lost = true;
        ctx.rejectLost(lostFailure());
        void startStop(ctx, clock, deps);
        return;
      }
      if (event.kind === "request-blocked") {
        // Only a refused main-frame request can fail the navigation as a block. The
        // warning carries the count and the first reason, never a URL or a host.
        if (event.mainFrame) ctx.navigationBlocked = true;
        ctx.blocked.count += 1;
        ctx.blocked.reason ??= event.reason;
      }
      ctx.warnings.add(event.kind);
    },
  });
  const inspect = policy.inspect;

  const requested = await step(() => inspect(url));
  if (!requested.ok) {
    // The input URL is checked first, so it always fits in the cache; the cap is not reachable here.
    throw new CaptureFailure(requested.code === "host-limit-reached" ? "internal-error" : requested.code);
  }

  // 2. Browser.
  const getBrowserFor = deps.getBrowser ?? ((c: CaptureConfig) => getBrowser(c, { fetch, clock }));
  const browserResult = getBrowserFor(config);
  if (!browserResult.ok) throw new CaptureFailure(browserResult.error.code);
  const provider = browserResult.browser;

  // 3. Session. If the whole budget ends while the creation is still pending, the
  // session that arrives later is stopped, because nobody else knows about it.
  const captureId = (deps.newCaptureId ?? (() => globalThis.crypto.randomUUID()))();
  const creation = (async () =>
    provider.createSession({
      timeoutMinutes: config.sessionTimeoutMinutes,
      proxy: config.proxy,
      viewport: { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height },
      captureId,
    }))();
  try {
    ctx.handle = await step(() => creation, "session-create-failed", {
      ms: API_FETCH_TIMEOUT_MS,
      code: "session-create-timeout",
    });
  } catch (error) {
    if (error instanceof CaptureFailure && error.code === "capture-timeout") {
      // The result is already gone, so a failing stop has nobody to warn: its warnings
      // go to a set that is thrown away. The promise goes to the platform so that a
      // frozen function still finishes the stop.
      handOff(
        deps,
        creation.then((late) => stopSafely(late, clock, new Set<CaptureWarningCode>()), ignore),
      );
    }
    // An aborted create, or one with no HTTP answer, may have left a session: one clean-up.
    if (error instanceof CaptureFailure && error.reclaim) await reclaimOnce(provider, captureId, clock, deps);
    throw error;
  }
  const handle = ctx.handle;
  ctx.secrets.push(...secretsOf(handle));

  // 4. Connection and guards.
  const page = await step(() => handle.connect({ timeoutMs: CDP_CONNECT_TIMEOUT_MS }), "connect-failed", {
    ms: CDP_CONNECT_TIMEOUT_MS,
    code: "connect-timeout",
  });
  await step(() => page.installGuards(policy), "connect-failed");

  // 5. Navigation, then the same checks on where the browser ended up.
  let navigation: { finalUrl: string };
  try {
    navigation = await step(() => page.goto(requested.url, { timeoutMs: NAVIGATION_TIMEOUT_MS }), "navigation-failed", {
      ms: NAVIGATION_TIMEOUT_MS,
      code: "navigation-timeout",
    });
  } catch (error) {
    // A guard that aborted the request makes the browser fail the navigation.
    if (ctx.navigationBlocked && !ctx.lost) throw new CaptureFailure("navigation-blocked");
    throw error;
  }
  const landed = await step(() => inspect(navigation.finalUrl, MAX_HOP_URL_LENGTH));
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
    // The screenshot calls count against the whole budget inside `captureImages`; the
    // race here only adds the loss of the guard.
    shots = await guarded(captureImages(page, raw, deadline));
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
      const reloadedAt = await step(() => inspect(reloaded.finalUrl, MAX_HOP_URL_LENGTH));
      if (!reloadedAt.ok) throw new CaptureFailure("navigation-blocked");
      await step(() => sleep(clock, SETTLE_DELAY_MS));
      const reloadRaw = await step(() => page.collect(LIGHT_COLLECT_OPTIONS));
      const second = buildSample(reloadRaw, {
        light: true,
        url: reloadedAt.url,
        capturedAt: new Date(clock.now()).toISOString(),
      });
      const checked = BaseSnapshotSchema.safeParse(second);
      if (!checked.success) throw new CaptureFailure("snapshot-invalid");
      return checked.data;
    } catch {
      // A lost guard is not a failed reload: the capture ends.
      if (ctx.lost) throw lostFailure();
      ctx.warnings.add("reload-failed");
      return undefined;
    }
  };
  const sample = buildSample(raw, { light: false, url: landed.url, capturedAt, images: shots.meta });
  if (sample.capture?.elementsTruncated) ctx.warnings.add("elements-truncated");

  /**
   * Reads the page again with the light options and compares the boxes with those of
   * the first read. Boxes that moved by more than `LAYOUT_DRIFT_PX` give the warning
   * `layout-shifted`. The second read is not stored. A failed, timed-out or invalid
   * read, or too little time, skips the check without an error and without a warning.
   */
  const checkLayoutDrift = async (): Promise<void> => {
    if (deadline.remainingMs() < TILE_MIN_REMAINING_MS) return;
    try {
      // A read that hangs must not use up the budget of the reload sample.
      const again = await step(() => page.collect(LIGHT_COLLECT_OPTIONS), undefined, {
        ms: TILE_MIN_REMAINING_MS,
        code: "capture-timeout",
      });
      const second = buildSample(again, { light: true, url: landed.url, capturedAt });
      if (maxBoxDrift(sample.elements, second.elements) > LAYOUT_DRIFT_PX) ctx.warnings.add("layout-shifted");
    } catch {
      // The check is optional, but a lost guard is not: the capture ends.
      if (ctx.lost) throw lostFailure();
    }
  };
  await checkLayoutDrift();

  // 9. Second sample after a reload. Never throws and never changes the first capture.
  const afterReload = await takeReloadSample();
  let assembled = afterReload ? { ...sample, afterReload } : sample;

  // 10. Size, then validation. The size is measured first, so a huge value is never validated.
  if (snapshotBytes(assembled) > MAX_SNAPSHOT_BYTES && afterReload) {
    assembled = sample;
    ctx.warnings.add("reload-failed");
  }
  if (snapshotBytes(assembled) > MAX_SNAPSHOT_BYTES) throw new CaptureFailure("snapshot-too-large");
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
 *
 * `error.detail` (and every other text of the result) is redacted, but it may still
 * contain text controlled by the page or by target URLs.
 * `detail` is for server logs only and must never be shown to a user. Show `code` and
 * the fixed `message` instead.
 */
export async function capturePage(url: string, deps: Partial<CaptureDeps> = {}): Promise<CaptureResult> {
  const clock = deps.clock ?? createSystemClock();
  let rejectLost: (error: CaptureFailure) => void = ignore;
  const whenLost = new Promise<never>((_resolve, reject) => {
    rejectLost = reject;
  });
  // Nothing may wait on it for a rejection to be handled: a capture that never loses the guard never settles it.
  whenLost.catch(ignore);
  const ctx: CaptureContext = {
    secrets: [],
    warnings: new Set<CaptureWarningCode>(),
    navigationBlocked: false,
    blocked: { count: 0 },
    lost: false,
    whenLost,
    rejectLost,
  };

  let outcome: CaptureOutcome;
  try {
    const success = await runCapture(url, deps, clock, ctx);
    // A guard lost after the last stage still ends the capture: nothing read since is used.
    if (ctx.lost) throw new CaptureFailure("guard-lost");
    outcome = { ok: true, success };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    // Stop the session exactly once on every path, with its own deadline. A loss of the
    // guard has already started the stop; this reuses it. The promise goes to the
    // platform as well, so a frozen function still finishes the stop.
    await startStop(ctx, clock, deps);
  }

  return finalise(outcome, ctx);
}
