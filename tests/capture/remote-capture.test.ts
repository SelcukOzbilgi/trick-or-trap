// Opt-in live test: captures real pages through Browser Use Cloud. It checks what unit
// tests cannot: the request guard against a real redirect and iframe, the alignment of
// boxes and image, and that the session of a capture ends up stopped at the vendor.
//
// Variables:
//   RUN_REMOTE_CAPTURE=1       required, or the whole file is skipped
//   BROWSER_USE_API_KEY        required
//   NEXT_PUBLIC_APP_URL        required, the public origin of a running Boo-tique
//   LIVE_IFRAME_TEST_URL       optional, a public page the owner hosts that embeds an
//                              iframe to a blocked address; without it that case is skipped
//
// The owner runs it with:
//   RUN_REMOTE_CAPTURE=1 npx vitest run tests/capture/remote-capture.test.ts --maxWorkers=2
//
// Each case opens its own billed session. The test never prints the API key, cdpUrl,
// liveUrl or a session id, and no assertion message contains them. Assertions compare
// only booleans, numbers, closed error codes and the status word of the vendor.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBrowser } from "@/lib/capture/browser";
import { capturePage } from "@/lib/capture/capture";
import { createSystemClock } from "@/lib/capture/clock";
import { getCaptureConfig, type CaptureConfig } from "@/lib/capture/config";
import { MAX_BASE64_LENGTH } from "@/lib/capture/constants";
import { PageSnapshotSchema } from "@/lib/types";
import { TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

/** The whole `capturePage` call that ends in a blocked redirect must finish within this. */
const LIVE_BLOCK_MAX_MS = 5_000;
const CASE_TIMEOUT_MS = 60_000;
/** Largest distance, in CSS px, between the centre of a box and the middle of the image. */
const ALIGNMENT_TOLERANCE_PX = 2;
/** The vendor needs a moment to report `stopped` after the stop request. */
const STATUS_POLL_ATTEMPTS = 5;
const STATUS_POLL_INTERVAL_MS = 1_000;

const API_BASE_URL = "https://api.browser-use.com/api/v4/browsers";
const API_KEY_HEADER = "X-Browser-Use-API-Key";
const REDIRECT_TO_BLOCKED_PORT_URL = "https://httpbingo.org/redirect-to?url=http%3A%2F%2Fexample.com%3A8080%2F";

const enabled = Boolean(
  process.env.RUN_REMOTE_CAPTURE === "1" &&
    process.env.BROWSER_USE_API_KEY &&
    process.env.NEXT_PUBLIC_APP_URL,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only the closed error code goes into the message, never a detail or a URL. */
function loadConfig(): CaptureConfig {
  const loaded = getCaptureConfig();
  if (!loaded.ok) throw new Error(`capture configuration is invalid (${loaded.error.code})`);
  return loaded.config;
}

/**
 * A `fetch` that passes everything through and notes the `id` of a created session in
 * `sink`. The id stays in that local object; nothing prints it.
 */
function createRecordingFetch(sink: { sessionId?: string }): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (typeof input === "string" && input === API_BASE_URL && init?.method === "POST") {
      try {
        const body: unknown = await response.clone().json();
        if (isRecord(body) && typeof body.id === "string" && body.id.length > 0) sink.sessionId = body.id;
      } catch {
        // An unreadable body leaves the id unset; the stop check then reports that.
      }
    }
    return response;
  };
}

/** Captures `url` with a browser whose create response the test can see. */
async function captureRecorded(url: string): Promise<{ result: Awaited<ReturnType<typeof capturePage>>; sessionId?: string }> {
  const sink: { sessionId?: string } = {};
  const clock = createSystemClock();
  const recordingFetch = createRecordingFetch(sink);
  const config = loadConfig();
  const result = await capturePage(url, {
    config,
    clock,
    getBrowser: (c) => getBrowser(c, { fetch: recordingFetch, clock }),
  });
  return { result, sessionId: sink.sessionId };
}

/** The `status` word of a session at the vendor, or `"unknown"` for any other answer. */
async function readSessionStatus(sessionId: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: { [API_KEY_HEADER]: process.env.BROWSER_USE_API_KEY as string },
    });
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.status === "string" ? body.status : "unknown";
  } catch {
    return "unknown";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!enabled)("remote capture (live)", () => {
  it(
    "captures the Boo-tique home page with the default dependencies",
    async () => {
      const result = await capturePage(`${process.env.NEXT_PUBLIC_APP_URL}/boo-tique`);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        // Only the closed error code is shown, never detail or any URL.
        throw new Error(`capture failed with code ${result.error.code}`);
      }

      expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);

      expect(result.images.length).toBeGreaterThanOrEqual(1);
      const first = result.images[0];
      expect(first.bytes[0]).toBe(0xff);
      expect(first.bytes[1]).toBe(0xd8);
      expect(result.images.every((image) => image.width >= 1)).toBe(true);
      const base64Sum = result.images.reduce((sum, image) => sum + image.base64Length, 0);
      expect(base64Sum).toBeLessThanOrEqual(MAX_BASE64_LENGTH);

      const warningCodes = result.warnings.map((warning) => warning.code);
      const reloadOutcomeKnown =
        result.snapshot.afterReload !== undefined ||
        warningCodes.includes("reload-skipped") ||
        warningCodes.includes("reload-failed");
      expect(reloadOutcomeKnown).toBe(true);

      expect(warningCodes.includes("session-stop-failed")).toBe(false);

      // No element of either sample carries the test-id attribute (14.8).
      const sampled = [...result.snapshot.elements, ...(result.snapshot.afterReload?.elements ?? [])];
      const carriers = sampled.filter((element) =>
        Object.prototype.hasOwnProperty.call(element.attributes ?? {}, TEST_ID_ATTRIBUTE),
      );
      expect(carriers.length).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "refuses a public redirect to a blocked port within the block limit",
    async () => {
      const started = performance.now();
      const result = await capturePage(REDIRECT_TO_BLOCKED_PORT_URL);
      const elapsedMs = performance.now() - started;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("the capture of a redirect to a blocked port succeeded");
      expect(result.error.code).toBe("navigation-blocked");
      expect(result.warnings.some((warning) => warning.code === "request-blocked")).toBe(true);
      expect(elapsedMs).toBeLessThanOrEqual(LIVE_BLOCK_MAX_MS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "places the box of the link on example.com at the middle of the first image",
    async () => {
      const result = await capturePage("https://example.com");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`capture failed with code ${result.error.code}`);

      const link = result.snapshot.elements.find((element) => element.tag === "a");
      expect(link).toBeDefined();
      if (!link) return;
      const centre = link.boundingBox.x + link.boundingBox.width / 2;
      const middle = result.images[0].width / 2;
      expect(Math.abs(centre - middle)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    },
    CASE_TIMEOUT_MS,
  );

  it.skipIf(!process.env.LIVE_IFRAME_TEST_URL)(
    "continues past an iframe to a blocked address and reports it",
    async () => {
      const result = await capturePage(process.env.LIVE_IFRAME_TEST_URL as string);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`capture failed with code ${result.error.code}`);
      const blocked = result.warnings.find((warning) => warning.code === "request-blocked");
      expect(blocked).toBeDefined();
      expect(blocked?.count ?? 0).toBeGreaterThanOrEqual(1);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "leaves the session of a finished capture stopped at the vendor",
    async () => {
      const { result, sessionId } = await captureRecorded(`${process.env.NEXT_PUBLIC_APP_URL}/boo-tique`);

      expect(result.ok).toBe(true);
      expect(sessionId).toBeDefined();
      if (sessionId === undefined) return;

      let status = "unknown";
      for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
        status = await readSessionStatus(sessionId);
        if (status === "stopped") break;
        await wait(STATUS_POLL_INTERVAL_MS);
      }
      // `status` is a short word from the vendor, never the id, key or an address.
      expect(status).toBe("stopped");
    },
    CASE_TIMEOUT_MS,
  );
});
