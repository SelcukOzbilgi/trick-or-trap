/**
 * Types of the request guard. Types only, no code. `seam.ts` and `request-guard.ts`
 * both import from here, so neither imports the other.
 */
import type { UrlErrorCode } from "./types";

export type GuardVerdict = { allowed: true } | { allowed: false; reason: UrlErrorCode };

export type RequestGuardEvent =
  /** A request was refused. `mainFrame` is true only for a document request of the main frame. */
  | { kind: "request-blocked"; reason: UrlErrorCode; mainFrame: boolean }
  /** A non-document request named a new host after `MAX_REQUEST_HOSTS` hosts had been seen. */
  | { kind: "request-host-limit" };

export interface RequestPolicy {
  /** Synchronous. Scheme, port, credentials, host name, IP literal, length. No DNS. */
  checkSyntax(url: string): GuardVerdict;
  /** Syntax plus DNS, with a per-capture verdict cache. */
  checkHost(url: string): Promise<GuardVerdict>;
  report(event: RequestGuardEvent): void;
}

/** Why the guard was given up: the guard session closed, the browser disconnected, or a heartbeat failed. */
export type GuardLossCause = "session-closed" | "disconnected" | "heartbeat";

/** The browser-target CDP session of the guard. `send` takes exactly two arguments. */
export interface GuardSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(handler: (event: { method: string; params: unknown }) => void | Promise<void>): void;
  onClose(handler: () => void): void;
}

/** The part of the browser connection the guard needs: one browser-target session and the disconnect signal. */
export interface GuardBrowser {
  /** `browser.newBrowserCDPSession()` on the real client. */
  openGuardSession(): Promise<GuardSession>;
  onDisconnected(handler: () => void): void;
}
