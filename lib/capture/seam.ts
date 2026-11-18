/**
 * Interfaces of the browser seam. Interfaces only, no code. No type of any
 * browser-automation library appears here, so another implementation can be added
 * later without changing a signature.
 */
import type { GuardVerdict, RequestGuardEvent } from "./guard-types";
import type { CaptureError, CollectOptions, RawPageRead } from "./types";

export type { GuardVerdict, RequestGuardEvent };

export type SessionRequest = {
  timeoutMinutes: number;
  proxy: "on" | "off";
  viewport: { width: number; height: number };
  /** Random id of this capture. Sent as session metadata so a leftover session can be found. */
  captureId: string;
};

export interface BrowserProvider {
  readonly mode: string;
  /** Creates a billed session. Throws `CaptureFailure`. Nothing to stop if it throws. */
  createSession(request: SessionRequest): Promise<BrowserSessionHandle>;
  /**
   * Optional. One best-effort clean-up after a create call that may have left a session
   * behind. Never rejects.
   */
  reclaim?(captureId: string): Promise<void>;
}

export interface BrowserSessionHandle {
  /** Throws `CaptureFailure`. */
  connect(options: { timeoutMs: number }): Promise<CapturePage>;
  /** Disconnects (best effort) and stops billing. Rejects when stopping fails. */
  stop(): Promise<void>;
  /** API key, session id, cdpUrl, liveUrl. For redaction only; never serialise or log them. */
  secrets(): readonly string[];
}

export type GuardEvent = RequestGuardEvent | { kind: "download-refused" } | { kind: "popup-closed" };

/** Assignable to `RequestPolicy`: the request guard takes it as its policy. */
export interface PageGuards {
  /** Synchronous. Scheme, port, credentials, host name, IP literal, length. No DNS. */
  checkSyntax(url: string): GuardVerdict;
  /** Syntax plus DNS, with the per-capture verdict cache. */
  checkHost(url: string): Promise<GuardVerdict>;
  report(event: GuardEvent): void;
}

export type NavigationOutcome = { finalUrl: string };

export type ScreenshotRequest =
  | { kind: "clip"; clip: { x: 0; y: 0; width: number; height: number }; quality: number } // single mode
  | { kind: "viewport"; quality: number }; // tiled mode: current viewport only

export interface CapturePage {
  installGuards(guards: PageGuards): Promise<void>;
  goto(url: string, options: { timeoutMs: number }): Promise<NavigationOutcome>;
  reload(options: { timeoutMs: number }): Promise<NavigationOutcome>;
  collect(options: CollectOptions): Promise<RawPageRead>;
  /** Scrolls the document to `y` and resolves with the `scrollY` read back from the page (the browser may clamp). */
  scrollTo(y: number): Promise<number>;
  screenshot(request: ScreenshotRequest): Promise<Uint8Array>;
}

export type GetBrowserResult = { ok: true; browser: BrowserProvider } | { ok: false; error: CaptureError };
