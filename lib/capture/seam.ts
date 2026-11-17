/**
 * Interfaces of the browser seam. Interfaces only, no code. No type of any
 * browser-automation library appears here, so another implementation can be added
 * later without changing a signature.
 */
import type { CaptureError, CollectOptions, RawPageRead, UrlErrorCode } from "./types";

export type SessionRequest = {
  timeoutMinutes: number;
  proxy: "on" | "off";
  viewport: { width: number; height: number };
};

export interface BrowserProvider {
  readonly mode: string;
  /** Creates a billed session. Throws `CaptureFailure`. Nothing to stop if it throws. */
  createSession(request: SessionRequest): Promise<BrowserSessionHandle>;
}

export interface BrowserSessionHandle {
  /** Throws `CaptureFailure`. */
  connect(options: { timeoutMs: number }): Promise<CapturePage>;
  /** Disconnects (best effort) and stops billing. Rejects when stopping fails. */
  stop(): Promise<void>;
}

export type GuardEvent =
  | { kind: "request-blocked"; reason: UrlErrorCode }
  | { kind: "download-refused" }
  | { kind: "popup-closed" };

export interface PageGuards {
  allowNavigation(url: string): Promise<{ allowed: true } | { allowed: false; reason: UrlErrorCode }>;
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
