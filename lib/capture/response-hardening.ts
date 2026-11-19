/**
 * WebSocket hardening at the response stage of the request guard.
 *
 * The request guard cannot see WebSocket connections. With hardening on, every document
 * and every JavaScript response is read and served again with the extra header
 * `Content-Security-Policy: connect-src http: https: data: blob:`, which blocks `ws:` and
 * `wss:` in the page and in the workers that script creates (verified live on Chrome 156,
 * see `browser-guard.ts`).
 *
 * The policy header must go out with `Fetch.fulfillRequest`. A header-only
 * `Fetch.continueResponse` had no effect in Chrome 156, so it is never used here.
 *
 * Header values, status text and bodies are untrusted page data: they are copied, never
 * interpreted, and never put in an event or an error.
 */
import { HARDENING_CSP } from "./constants";
import type { GuardSession, GuardVerdict } from "./guard-types";
import type { GuardReasonCode } from "./types";

export type HeaderEntry = { name: string; value: string };

/** The fields of a `Fetch.requestPaused` event that this module reads, taken from a response-stage event. */
export type PausedResponse = {
  requestId: string;
  resourceType: string;
  frameId?: string;
  responseStatusCode?: number;
  responseStatusText?: string;
  responseErrorReason?: string;
  responseHeaders?: HeaderEntry[];
};

const ALLOW: GuardVerdict = { allowed: true };
/** Headers that no longer describe the body once it is served again, decoded, with new headers. */
const DROPPED_HEADERS: ReadonlySet<string> = new Set(["content-encoding", "content-length"]);

function refuse(reason: GuardReasonCode): GuardVerdict {
  return { allowed: false, reason };
}

function headerValues(headers: readonly HeaderEntry[], lowerName: string): string[] {
  return headers.filter((entry) => entry.name.toLowerCase() === lowerName).map((entry) => entry.value);
}

/**
 * The headers of the re-served response: every header except `Content-Encoding` and
 * `Content-Length` (any case), in order, with repeated names such as `Set-Cookie` kept,
 * plus the hardening policy. A policy the page sent itself stays; both apply.
 */
export function hardenedHeaders(headers: readonly HeaderEntry[]): HeaderEntry[] {
  const kept = headers
    .filter((entry) => !DROPPED_HEADERS.has(entry.name.toLowerCase()))
    .map((entry) => ({ name: entry.name, value: entry.value }));
  kept.push({ name: "Content-Security-Policy", value: HARDENING_CSP });
  return kept;
}

/** True for a `Document`, and for an `Other` response whose `Content-Type` is a JavaScript type. */
export function needsRewrite(resourceType: string, headers: readonly HeaderEntry[]): boolean {
  if (resourceType === "Document") return true;
  if (resourceType !== "Other") return false;
  return headerValues(headers, "content-type").some((value) => {
    const lower = value.toLowerCase();
    return lower.includes("javascript") || lower.includes("ecmascript");
  });
}

/** The largest well-formed `Content-Length` value, or `undefined` when there is none. */
function declaredLength(headers: readonly HeaderEntry[]): number | undefined {
  let largest: number | undefined;
  for (const value of headerValues(headers, "content-length")) {
    const text = value.trim();
    if (!/^\d{1,15}$/.test(text)) continue;
    const length = Number(text);
    if (largest === undefined || length > largest) largest = length;
  }
  return largest;
}

function isRedirect(status: number | undefined): boolean {
  return status !== undefined && status >= 300 && status <= 399;
}

/**
 * Answers one response-stage pause.
 *
 * - A redirect (300 to 399), a response with an error reason, and a response that needs no
 *   rewrite are continued unchanged with `Fetch.continueRequest`. If that call rejects, so
 *   does this function, and the guard must fail the request.
 * - Any other response is read with `Fetch.getResponseBody` and answered with
 *   `Fetch.fulfillRequest`, with the original status and the hardened headers. This is
 *   done here, and `{ allowed: true }` is returned.
 * - A response that is too large, or whose read or fulfil fails, is not answered here. The
 *   function returns a refusal and the guard sends `Fetch.failRequest`. A response is never
 *   passed on unrewritten after a failed rewrite.
 *
 * The deadline for the whole answer is the guard's, not this function's.
 */
export async function answerResponse(
  session: GuardSession,
  paused: PausedResponse,
  limits: { maxBodyBytes: number },
): Promise<GuardVerdict> {
  const { requestId } = paused;
  const headers = paused.responseHeaders ?? [];
  const status = paused.responseStatusCode;

  if (paused.responseErrorReason !== undefined || isRedirect(status) || !needsRewrite(paused.resourceType, headers)) {
    await session.send("Fetch.continueRequest", { requestId });
    return ALLOW;
  }
  if (status === undefined) return refuse("response-rewrite-failed");

  const declared = declaredLength(headers);
  if (declared !== undefined && declared > limits.maxBodyBytes) return refuse("response-too-large");

  let body: string;
  try {
    const answer = await session.send("Fetch.getResponseBody", { requestId });
    const fields = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>) : undefined;
    const text = fields?.body;
    if (typeof text !== "string") return refuse("response-rewrite-failed");
    if (fields?.base64Encoded === true) {
      if (Buffer.byteLength(text, "base64") > limits.maxBodyBytes) return refuse("response-too-large");
      body = text;
    } else {
      if (Buffer.byteLength(text, "utf8") > limits.maxBodyBytes) return refuse("response-too-large");
      body = Buffer.from(text, "utf8").toString("base64");
    }
  } catch {
    return refuse("response-rewrite-failed");
  }

  const fulfil: Record<string, unknown> = {
    requestId,
    responseCode: status,
    responseHeaders: hardenedHeaders(headers),
    body,
  };
  if (paused.responseStatusText !== undefined && paused.responseStatusText.length > 0) {
    fulfil.responsePhrase = paused.responseStatusText;
  }
  try {
    await session.send("Fetch.fulfillRequest", fulfil);
  } catch {
    return refuse("response-rewrite-failed");
  }
  return ALLOW;
}
