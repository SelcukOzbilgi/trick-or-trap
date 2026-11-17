/**
 * Remote implementation of the browser seam: a Browser Use Cloud browser driven over
 * CDP with `playwright-core`.
 *
 * This is the only file that talks to `playwright-core`, and it loads it with a lazy
 * `import()` on the first connect. No Playwright type leaves this file: the seam
 * interfaces describe everything the rest of `lib/capture` sees.
 *
 * Page text is untrusted input. It is never used here to build selectors, URLs or
 * shell input. Nothing in this file logs.
 */
import "server-only";
import type { Clock } from "./clock";
import type { CaptureConfig } from "./config";
import { createSession as createApiSession, stopSession, type CreatedSession } from "./browser-use-api";
import { collectInPage } from "./extractor";
import { toDetail } from "./redact";
import type {
  BrowserProvider,
  BrowserSessionHandle,
  CapturePage,
  NavigationOutcome,
  PageGuards,
  ScreenshotRequest,
  SessionRequest,
} from "./seam";
import { CaptureFailure } from "./types";
import type { CaptureErrorCode, CollectOptions, RawPageRead } from "./types";

/** Longest wait for the best-effort CDP disconnect before the stop request is sent. */
export const DISCONNECT_TIMEOUT_MS = 3_000;

export type RemoteBrowserDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Loads `playwright-core`. Tests inject a fake; the default is a lazy `import()`. */
  loadPlaywright?: () => Promise<unknown>;
};

// A small structural view of the Playwright objects used here. The one cast from the
// real module into these types is in `loadChromium`.
type PwFrame = { parentFrame(): unknown };
type PwRequest = { url(): string; isNavigationRequest(): boolean; frame(): PwFrame };
type PwRoute = { abort(errorCode?: string): Promise<void>; continue(): Promise<void> };
type PwDownload = { cancel(): Promise<void> };
type PwPage = {
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  reload(options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  evaluate(fn: unknown, arg?: unknown): Promise<unknown>;
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
  url(): string;
  on(event: "download", handler: (download: PwDownload) => unknown): unknown;
  close(): Promise<void>;
};
type PwContext = {
  pages(): PwPage[];
  newPage(): Promise<PwPage>;
  route(pattern: string, handler: (route: PwRoute, request: PwRequest) => unknown): Promise<void>;
  on(event: "page", handler: (page: PwPage) => unknown): unknown;
};
type PwBrowser = { contexts(): PwContext[]; close(): Promise<void> };
type PwChromium = { connectOverCDP(url: string, options: { timeout: number }): Promise<PwBrowser> };

function noop(): void {}

async function loadChromium(deps: RemoteBrowserDeps): Promise<PwChromium> {
  const loaded = deps.loadPlaywright ? await deps.loadPlaywright() : await import("playwright-core");
  const pw = loaded as unknown as { chromium?: PwChromium; default?: { chromium?: PwChromium } };
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium || typeof chromium.connectOverCDP !== "function") {
    throw new Error("The browser automation module has no chromium export.");
  }
  return chromium;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

/** Closes a page or download quietly; any failure is ignored. */
async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // best effort
  }
}

function createCapturePage(page: PwPage, context: PwContext, secrets: readonly string[]): CapturePage {
  const fail = (code: CaptureErrorCode, error: unknown) => new CaptureFailure(code, toDetail(error, secrets));

  const finish = async (
    action: () => Promise<unknown>,
    timeoutCode: CaptureErrorCode,
  ): Promise<NavigationOutcome> => {
    try {
      await action();
      return { finalUrl: page.url() };
    } catch (error) {
      throw fail(isTimeoutError(error) ? timeoutCode : "navigation-failed", error);
    }
  };

  return {
    async installGuards(guards: PageGuards): Promise<void> {
      await context.route("**/*", async (route, request) => {
        // Only main-frame navigations are checked, each redirect hop included.
        // Sub-resource requests and sub-frame navigations pass through untouched.
        if (!request.isNavigationRequest() || request.frame().parentFrame() !== null) {
          await quietly(() => route.continue());
          return;
        }
        let verdict: Awaited<ReturnType<PageGuards["allowNavigation"]>>;
        try {
          verdict = await guards.allowNavigation(request.url());
        } catch {
          verdict = { allowed: false, reason: "url-invalid" };
        }
        if (verdict.allowed) {
          await quietly(() => route.continue());
          return;
        }
        guards.report({ kind: "request-blocked", reason: verdict.reason });
        await quietly(() => route.abort("blockedbyclient"));
      });

      page.on("download", async (download) => {
        guards.report({ kind: "download-refused" });
        await quietly(() => download.cancel());
      });

      context.on("page", async (opened) => {
        if (opened === page) return;
        guards.report({ kind: "popup-closed" });
        await quietly(() => opened.close());
      });
    },

    goto(url: string, options: { timeoutMs: number }): Promise<NavigationOutcome> {
      return finish(() => page.goto(url, { timeout: options.timeoutMs, waitUntil: "load" }), "navigation-timeout");
    },

    reload(options: { timeoutMs: number }): Promise<NavigationOutcome> {
      return finish(() => page.reload({ timeout: options.timeoutMs, waitUntil: "load" }), "navigation-timeout");
    },

    async collect(options: CollectOptions): Promise<RawPageRead> {
      try {
        // One evaluation reads every element and the page metrics.
        return (await page.evaluate(collectInPage, options)) as RawPageRead;
      } catch (error) {
        throw fail("page-read-failed", error);
      }
    },

    async scrollTo(y: number): Promise<number> {
      try {
        const real = await page.evaluate(
          (target: number) =>
            new Promise<number>((resolve) => {
              window.scrollTo(0, target);
              // One animation frame lets the scroll settle; the timer is the fallback
              // for a page that does not paint. The second resolve call has no effect.
              // No named inner function: this code is serialised into the page.
              requestAnimationFrame(() => resolve(window.scrollY));
              setTimeout(() => resolve(window.scrollY), 250);
            }),
          y,
        );
        return typeof real === "number" && Number.isFinite(real) ? real : 0;
      } catch (error) {
        throw fail("screenshot-failed", error);
      }
    },

    async screenshot(request: ScreenshotRequest): Promise<Uint8Array> {
      const base = { type: "jpeg", quality: request.quality, scale: "css" } as const;
      try {
        return request.kind === "clip"
          ? await page.screenshot({ ...base, fullPage: true, clip: request.clip })
          : await page.screenshot({ ...base, fullPage: false });
      } catch (error) {
        throw fail("screenshot-failed", error);
      }
    },
  };
}

function createHandle(session: CreatedSession, config: CaptureConfig, deps: RemoteBrowserDeps): BrowserSessionHandle {
  const apiKey = config.apiKey as string;
  // Everything that must never appear in an error text, known only after the create call.
  const secrets = [apiKey, session.id, session.cdpUrl, session.liveUrl ?? ""];
  const state: { browser?: PwBrowser; stopped: boolean } = { stopped: false };

  /** Best-effort CDP disconnect, bounded so it can never hold back the stop request. */
  async function disconnect(browser: PwBrowser): Promise<void> {
    let cancel: () => void = noop;
    const timedOut = new Promise<void>((resolve) => {
      cancel = deps.clock.setTimer(DISCONNECT_TIMEOUT_MS, resolve);
    });
    let closing: Promise<void>;
    try {
      closing = Promise.resolve(browser.close()).then(noop, noop);
    } catch {
      cancel();
      return;
    }
    await Promise.race([closing, timedOut]);
    cancel();
  }

  return {
    async connect(options: { timeoutMs: number }): Promise<CapturePage> {
      try {
        const chromium = await loadChromium(deps);
        const browser = await chromium.connectOverCDP(session.cdpUrl, { timeout: options.timeoutMs });
        state.browser = browser;
        // The connection can finish after the capture gave up and stopped the session.
        if (state.stopped) await disconnect(browser);
        const context = browser.contexts()[0];
        if (!context) throw new CaptureFailure("connect-failed");
        const page = context.pages()[0] ?? (await context.newPage());
        return createCapturePage(page, context, secrets);
      } catch (error) {
        if (error instanceof CaptureFailure) throw error;
        throw new CaptureFailure("connect-failed", toDetail(error, secrets));
      }
    },

    async stop(): Promise<void> {
      state.stopped = true;
      if (state.browser) await disconnect(state.browser);
      try {
        await stopSession({ fetch: deps.fetch, clock: deps.clock, apiKey }, session.id);
      } catch (error) {
        // Re-redacted with the full secret list before it reaches the caller.
        throw new Error(toDetail(error, secrets) ?? "Stopping the session failed.");
      }
    },
  };
}

/** The Browser Use Cloud implementation of `BrowserProvider`. */
export function createRemoteBrowser(config: CaptureConfig, deps: RemoteBrowserDeps): BrowserProvider {
  return {
    mode: "remote",
    async createSession(request: SessionRequest): Promise<BrowserSessionHandle> {
      if (config.apiKey === null) throw new CaptureFailure("config-invalid");
      const session = await createApiSession({ fetch: deps.fetch, clock: deps.clock, apiKey: config.apiKey }, request);
      return createHandle(session, config, deps);
    },
  };
}
