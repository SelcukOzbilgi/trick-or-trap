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
import { hideScrollbars, readMainFrameId, readPageMetrics, runInIsolatedWorld, scrollInPage, type CdpSession } from "./cdp";
import type { CaptureConfig } from "./config";
import {
  createSession as createApiSession,
  reclaimSession,
  stopSession,
  type CreatedSession,
} from "./browser-use-api";
import { installBrowserGuard, type BrowserGuard } from "./browser-guard";
import { STOP_TIMEOUT_MS } from "./constants";
import { collectInPage } from "./extractor";
import { sanitiseMetrics } from "./geometry";
import type { GuardBrowser, GuardSession } from "./guard-types";
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
import type { CaptureErrorCode, CollectOptions, RawCollection, RawPageRead } from "./types";

/** Longest wait for the best-effort CDP disconnect after the stop request was sent. */
export const DISCONNECT_TIMEOUT_MS = 3_000;

export type RemoteBrowserDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Loads `playwright-core`. Tests inject a fake; the default is a lazy `import()`. */
  loadPlaywright?: () => Promise<unknown>;
};

// A small structural view of the Playwright objects used here. The one cast from the
// real module into these types is in `loadChromium`.
type PwDownload = { cancel(): Promise<void> };
/** The CDP session of the page. `send` takes two arguments; the session has no child sessions. */
type PwPageCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};
/** The browser-target CDP session of `browser.newBrowserCDPSession()`; events are subscribed by name. */
type PwBrowserCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => unknown): unknown;
};
type PwPage = {
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  reload(options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
  url(): string;
  on(event: "download", handler: (download: PwDownload) => unknown): unknown;
  close(): Promise<void>;
};
type PwContext = {
  pages(): PwPage[];
  newPage(): Promise<PwPage>;
  newCDPSession(page: PwPage): Promise<PwPageCdpSession>;
  on(event: "page", handler: (page: PwPage) => unknown): unknown;
};
type PwBrowser = {
  contexts(): PwContext[];
  newBrowserCDPSession(): Promise<PwBrowserCdpSession>;
  on(event: "disconnected", handler: () => unknown): unknown;
  close(): Promise<void>;
};
type PwChromium = { connectOverCDP(url: string, options: { timeout: number }): Promise<PwBrowser> };

/** What the page needs from the session handle: the browser to guard, and the stop state. */
type SessionLinks = {
  browser: PwBrowser;
  /** True from the moment `stop()` is called. A loss signal after that is not a guard loss. */
  isStopping(): boolean;
  /** Hands over the running guard, so `stop()` can stop its loss reporting first. */
  setGuard(guard: BrowserGuard): void;
};

function noop(): void {}

/** Views a Playwright CDP session of the page as the structural `CdpSession` that `lib/capture` uses. */
function toCdpSession(session: PwPageCdpSession): CdpSession {
  return {
    send: (method, params) => session.send(method, params),
  };
}

/** Views the Playwright browser as the `GuardBrowser` of the browser-level request guard. */
function toGuardBrowser(browser: PwBrowser): GuardBrowser {
  return {
    async openGuardSession(): Promise<GuardSession> {
      const session = await browser.newBrowserCDPSession();
      return {
        send: (method, params) => session.send(method, params),
        onEvent(handler) {
          session.on("Fetch.requestPaused", (params) => handler({ method: "Fetch.requestPaused", params }));
        },
        onClose(handler) {
          session.on("close", () => handler());
        },
      };
    },
    onDisconnected(handler) {
      browser.on("disconnected", () => handler());
    },
  };
}

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

function createCapturePage(
  page: PwPage,
  context: PwContext,
  cdp: CdpSession,
  secrets: readonly string[],
  clock: Clock,
  links: SessionLinks,
): CapturePage {
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
      try {
        // The main frame id comes from the page session. It must be read before the guard
        // session opens, so the guard can tell a main-frame document from any other.
        const mainFrameId = await readMainFrameId(cdp);
        // One browser-level session sees the requests of every target (page, frames, workers,
        // popups). The promise resolves only after `Fetch.enable` did, so no navigation can
        // start unguarded.
        const guard = await installBrowserGuard(toGuardBrowser(links.browser), guards, {
          clock,
          mainFrameId,
          onLost: () => {
            // The capture's own stop closes the connection too; that is never a loss.
            if (links.isStopping()) return;
            guards.report({ kind: "guard-lost" });
          },
        });
        links.setGuard(guard);
      } catch (error) {
        throw fail("connect-failed", error);
      }

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
        // Elements and the pixel ratio come from the collector in an isolated world. Sizes,
        // scroll position and layout width come from CDP, so a page script cannot set them.
        const collected: unknown = await runInIsolatedWorld(cdp, collectInPage, options);
        if (
          typeof collected !== "object" ||
          collected === null ||
          !Array.isArray((collected as { elements?: unknown }).elements)
        ) {
          throw new Error("The collector returned no element list.");
        }
        const { devicePixelRatio, eligibleCount, elements } = collected as RawCollection;
        const metrics = sanitiseMetrics({ ...(await readPageMetrics(cdp)), devicePixelRatio });
        return {
          innerWidth: metrics.innerWidth,
          innerHeight: metrics.innerHeight,
          devicePixelRatio: metrics.devicePixelRatio,
          scrollX: metrics.scrollX,
          scrollY: metrics.scrollY,
          scrollWidth: metrics.scrollWidth,
          scrollHeight: metrics.scrollHeight,
          layoutWidth: metrics.layoutWidth,
          eligibleCount,
          elements,
        };
      } catch (error) {
        throw fail("page-read-failed", error);
      }
    },

    async scrollTo(y: number): Promise<number> {
      try {
        const real: unknown = await runInIsolatedWorld(cdp, scrollInPage, y);
        return typeof real === "number" && Number.isFinite(real) ? real : 0;
      } catch (error) {
        throw fail("screenshot-failed", error);
      }
    },

    async screenshot(request: ScreenshotRequest): Promise<Uint8Array> {
      const base = { type: "jpeg", quality: request.quality, scale: "css", animations: "disabled" } as const;
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
  const state: { browser?: PwBrowser; stopped: boolean; guard?: BrowserGuard } = { stopped: false };

  /**
   * Best-effort CDP disconnect, bounded by `budgetMs`. A failure or a hang never
   * propagates. With no budget left the close is started and not awaited.
   */
  async function disconnect(browser: PwBrowser, budgetMs: number): Promise<void> {
    let closing: Promise<void>;
    try {
      closing = Promise.resolve(browser.close()).then(noop, noop);
    } catch {
      return;
    }
    if (budgetMs <= 0) return;
    let cancel: () => void = noop;
    const timedOut = new Promise<void>((resolve) => {
      cancel = deps.clock.setTimer(budgetMs, resolve);
    });
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
        if (state.stopped) await disconnect(browser, DISCONNECT_TIMEOUT_MS);
        const context = browser.contexts()[0];
        if (!context) throw new CaptureFailure("connect-failed");
        const page = context.pages()[0] ?? (await context.newPage());
        // One CDP session serves the scrollbar setting and every read of the page. The guard
        // has its own browser-level session, opened in `installGuards`.
        // The scrollbars are hidden before the page is returned, so before any read.
        const cdp = toCdpSession(await context.newCDPSession(page));
        await hideScrollbars(cdp);
        return createCapturePage(page, context, cdp, secrets, deps.clock, {
          browser,
          isStopping: () => state.stopped,
          setGuard: (guard) => {
            state.guard = guard;
            // The stop may have started while the guard was being installed.
            if (state.stopped) guard.stopWatching();
          },
        });
      } catch (error) {
        if (error instanceof CaptureFailure) throw error;
        throw new CaptureFailure("connect-failed", toDetail(error, secrets));
      }
    },

    async stop(): Promise<void> {
      state.stopped = true;
      // Our own teardown closes the connection. Loss reporting stops first, so that is never
      // read as a guard loss. The guard session is never detached: the stop request ends the
      // browser, then `browser.close()` closes the connection.
      state.guard?.stopWatching();
      const startedAt = deps.clock.now();
      // The stop request comes first: it ends the billing. The disconnect then gets what
      // is left of the stop budget, and a failed request does not skip it.
      let failure: unknown;
      let failed = false;
      try {
        await stopSession({ fetch: deps.fetch, clock: deps.clock, apiKey }, session.id);
      } catch (error) {
        failed = true;
        failure = error;
      }
      if (state.browser) {
        const left = STOP_TIMEOUT_MS - (deps.clock.now() - startedAt);
        await disconnect(state.browser, Math.min(DISCONNECT_TIMEOUT_MS, left));
      }
      // Re-redacted with the full secret list before it reaches the caller.
      if (failed) throw new Error(toDetail(failure, secrets) ?? "Stopping the session failed.");
    },

    secrets(): readonly string[] {
      return secrets.filter((secret) => secret.length > 0);
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
    async reclaim(captureId: string): Promise<void> {
      if (config.apiKey === null) return;
      await reclaimSession({ fetch: deps.fetch, clock: deps.clock, apiKey: config.apiKey }, captureId);
    },
  };
}
