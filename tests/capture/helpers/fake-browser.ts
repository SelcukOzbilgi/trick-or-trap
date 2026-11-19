import { CaptureFailure } from "@/lib/capture/types";
import type { CollectOptions, RawPageRead } from "@/lib/capture/types";
import type {
  BrowserProvider,
  BrowserSessionHandle,
  CapturePage,
  GuardEvent,
  NavigationOutcome,
  PageGuards,
  ScreenshotRequest,
  SessionRequest,
} from "@/lib/capture/seam";

type Outcome<T> = T | Error | "hang";

/**
 * What one seam method does. A plain value succeeds, an `Error` (also a
 * `CaptureFailure`) is thrown, `"hang"` never settles, and a function chooses per call
 * (`callNumber` starts at 1 for each method). `undefined` means the default.
 */
export type FakeStep<T, A extends unknown[] = []> = Outcome<T> | ((callNumber: number, ...args: A) => Outcome<T>);

export type FakeScript = {
  createSession?: FakeStep<undefined, [SessionRequest]>;
  connect?: FakeStep<undefined, [{ timeoutMs: number }]>;
  /** Default: the last entry of `hops`, else the requested URL. */
  goto?: FakeStep<NavigationOutcome, [string, { timeoutMs: number }]>;
  /** Default: the last entry of `hops`, else the URL of the last goto. */
  reload?: FakeStep<NavigationOutcome, [{ timeoutMs: number }]>;
  collect?: FakeStep<RawPageRead, [CollectOptions]>;
  /** The real `scrollY` read back. Default: the requested `y`, limited by `maxScrollY`. */
  scrollTo?: FakeStep<number, [number]>;
  /** Default: a few JPEG marker bytes. */
  screenshot?: FakeStep<Uint8Array, [ScreenshotRequest]>;
  stop?: FakeStep<undefined, []>;
  /** The secrets `handle.secrets()` returns. Default: none. */
  secrets?: readonly string[];
  /** URLs checked by every `goto` and `reload` with `guards.checkSyntax` and then `guards.checkHost`, in order. */
  hops?: readonly string[];
  /** Largest `scrollY` the fake page can reach; the default `scrollTo` clamps to it. */
  maxScrollY?: number;
};

export type FakeLogEntry = { kind: "scrollTo"; y: number } | { kind: "screenshot"; request: ScreenshotRequest };

export interface FakeBrowser {
  readonly provider: BrowserProvider;
  createCalls: number;
  connectCalls: number;
  stopCalls: number;
  /** Method names in call order. */
  readonly calls: string[];
  /** Every scrollTo and screenshot call, in one ordered log. */
  readonly log: FakeLogEntry[];
  readonly screenshotRequests: ScreenshotRequest[];
  readonly scrollRequests: number[];
  readonly sessionRequests: SessionRequest[];
  readonly collectOptions: CollectOptions[];
  readonly gotoUrls: string[];
  /** The guards passed to `installGuards`, if any. */
  guards: PageGuards | undefined;
  /** Sends a guard event to the installed guards. */
  emit(event: GuardEvent): void;
}

export function createRawPageRead(overrides: Partial<RawPageRead> = {}): RawPageRead {
  return {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    scrollWidth: 1280,
    scrollHeight: 800,
    eligibleCount: 0,
    elements: [],
    ...overrides,
  };
}

async function runStep<T, A extends unknown[]>(
  step: FakeStep<T, A> | undefined,
  fallback: () => T,
  callNumber: number,
  args: A,
): Promise<T> {
  const outcome = typeof step === "function" ? (step as (n: number, ...a: A) => Outcome<T>)(callNumber, ...args) : step;
  if (outcome === "hang") return new Promise<T>(() => {});
  if (outcome instanceof Error) throw outcome;
  if (outcome === undefined) return fallback();
  return outcome as T;
}

export function createFakeBrowser(script: FakeScript = {}): FakeBrowser {
  const counts: Record<string, number> = {};
  const next = (method: string): number => {
    counts[method] = (counts[method] ?? 0) + 1;
    fake.calls.push(method);
    return counts[method];
  };
  let currentUrl = "about:blank";

  const followHops = async (): Promise<void> => {
    const guards = fake.guards;
    if (!guards) return;
    for (const hop of script.hops ?? []) {
      // The same two calls the real request guard makes for a main-frame document request.
      const syntax = guards.checkSyntax(hop);
      const verdict = syntax.allowed ? await guards.checkHost(hop) : syntax;
      if (!verdict.allowed) {
        guards.report({ kind: "request-blocked", reason: verdict.reason, mainFrame: true });
        throw new CaptureFailure("navigation-failed");
      }
    }
  };
  const lastHop = (): string | undefined => script.hops?.[script.hops.length - 1];

  const page: CapturePage = {
    async installGuards(guards) {
      next("installGuards");
      fake.guards = guards;
    },
    async goto(url, options) {
      const n = next("goto");
      fake.gotoUrls.push(url);
      await followHops();
      return runStep(
        script.goto,
        () => {
          currentUrl = lastHop() ?? url;
          return { finalUrl: currentUrl };
        },
        n,
        [url, options],
      );
    },
    async reload(options) {
      const n = next("reload");
      await followHops();
      return runStep(script.reload, () => ({ finalUrl: lastHop() ?? currentUrl }), n, [options]);
    },
    async collect(options) {
      const n = next("collect");
      fake.collectOptions.push(options);
      return runStep(script.collect, () => createRawPageRead(), n, [options]);
    },
    async scrollTo(y) {
      const n = next("scrollTo");
      fake.scrollRequests.push(y);
      fake.log.push({ kind: "scrollTo", y });
      return runStep(
        script.scrollTo,
        () => (script.maxScrollY === undefined ? y : Math.min(y, script.maxScrollY)),
        n,
        [y],
      );
    },
    async screenshot(request) {
      const n = next("screenshot");
      fake.screenshotRequests.push(request);
      fake.log.push({ kind: "screenshot", request });
      return runStep(script.screenshot, () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), n, [request]);
    },
  };

  const handle: BrowserSessionHandle = {
    async connect(options) {
      const n = next("connect");
      fake.connectCalls += 1;
      await runStep(script.connect, () => undefined, n, [options]);
      return page;
    },
    async stop() {
      const n = next("stop");
      fake.stopCalls += 1;
      await runStep(script.stop, () => undefined, n, []);
    },
    secrets() {
      return script.secrets ?? [];
    },
  };

  const provider: BrowserProvider = {
    mode: "fake",
    async createSession(request) {
      const n = next("createSession");
      fake.createCalls += 1;
      fake.sessionRequests.push(request);
      await runStep(script.createSession, () => undefined, n, [request]);
      return handle;
    },
  };

  const fake: FakeBrowser = {
    provider,
    createCalls: 0,
    connectCalls: 0,
    stopCalls: 0,
    calls: [],
    log: [],
    screenshotRequests: [],
    scrollRequests: [],
    sessionRequests: [],
    collectOptions: [],
    gotoUrls: [],
    guards: undefined,
    emit(event) {
      fake.guards?.report(event);
    },
  };
  return fake;
}
