// Opt-in live test: captures real pages through Browser Use Cloud. It checks what unit
// tests cannot: the browser-level request guard against every request source of the
// fixture page, a real redirect, the alignment of boxes and image pixels, the collector
// against DOM clobbering, and that the session of a capture ends up stopped at the vendor.
//
// This file is written to be run by the owner only. It is never run by CI or by an agent.
//
// Variables. Every case has its own gate; a missing variable skips only the cases that need it.
//   RUN_REMOTE_CAPTURE=1       required with the next one, or the whole file is skipped
//   BROWSER_USE_API_KEY        required
//                              These two enable the public cases: the redirect to a blocked
//                              port and the check that a finished capture is stopped and not
//                              listed as active.
//   NEXT_PUBLIC_APP_URL        optional, the public origin of a running Boo-tique; without it
//                              only the Boo-tique case is skipped
//   LIVE_FIXTURE_BASE_URL      optional, the origin of a deployment that serves the fixture
//                              routes (CAPTURE_FIXTURE_ROUTES=on there); without it every
//                              fixture case is skipped
//   LIVE_FIXTURE_ALT_BASE_URL  optional, a second origin of the same deployment on another
//                              site (an https origin). Set it only when the deployment's
//                              CAPTURE_FIXTURE_ALT_ORIGIN names that origin, so the fixture
//                              page embeds the cross-site frame; without it only the
//                              cross-site case is skipped
//   CAPTURE_WEBSOCKET_HARDENING (read by the capture configuration) when `off`, the
//                              WebSocket assertions are left out; the default is `on`
//
// The owner runs it with:
//   RUN_REMOTE_CAPTURE=1 npx vitest run tests/capture/remote-capture.test.ts --maxWorkers=2
//
// Each case opens its own billed session and stops it in a `finally` block. The test never
// prints the API key, cdpUrl, liveUrl or a session id, and no assertion message contains
// them. Assertions compare only booleans, numbers, closed error codes, fixture tag names
// and the status word of the vendor.
import { describe, expect, it, vi } from "vitest";
import { decode } from "jpeg-js";

vi.mock("server-only", () => ({}));

import { getBrowser } from "@/lib/capture/browser";
import { activeSessionsUrl, reclaimSession } from "@/lib/capture/browser-use-api";
import { capturePage } from "@/lib/capture/capture";
import { createSystemClock } from "@/lib/capture/clock";
import { getCaptureConfig, type CaptureConfig } from "@/lib/capture/config";
import {
  BROWSER_VIEWPORT,
  CDP_CONNECT_TIMEOUT_MS,
  COLLECT_LIMITS,
  MAX_ATTR_CHARS,
  MAX_BASE64_LENGTH,
  MAX_ELEMENTS,
  MAX_TEXT_CHARS,
  NAVIGATION_TIMEOUT_MS,
} from "@/lib/capture/constants";
import { createGuardPolicy } from "@/lib/capture/guard-policy";
import { createRemoteBrowser, type PageGestureControl } from "@/lib/capture/remote-browser";
import { createDnsResolver } from "@/lib/capture/resolver";
import type { CapturePage, GuardEvent, PageGuards } from "@/lib/capture/seam";
import type { CaptureResult } from "@/lib/capture/types";
import {
  FIXTURE_ALIGNMENT,
  FIXTURE_CLOBBER_NAMES,
  FIXTURE_CLOBBER_TEXT,
  FIXTURE_FORBIDDEN_ORIGIN,
  FIXTURE_RESULTS,
  FIXTURE_TAGS,
  type FixtureTagCase,
} from "@/lib/capture-fixture/pages";
import { PageSnapshotSchema } from "@/lib/types";
import { TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

/** The whole `capturePage` call that ends in a blocked redirect must finish within this. */
const LIVE_BLOCK_MAX_MS = 5_000;
const CASE_TIMEOUT_MS = 60_000;
/** Cases that drive the fixture page by hand wait for the page to settle, so they get more. */
const GUARD_CASE_TIMEOUT_MS = 90_000;
/** Largest distance, in CSS px, between an edge of the marker box and the red pixels of its image. */
const ALIGNMENT_TOLERANCE_PX = 2;
/** Rows above and below the marker box that are scanned for red pixels. */
const ALIGNMENT_SCAN_MARGIN_PX = 20;
/** A pixel counts as marker red when it is this close to `rgb(255, 0, 0)` after JPEG compression. */
const RED_MIN_CHANNEL = 200;
const RED_MAX_OTHER_CHANNEL = 70;
/** The vendor needs a moment to report `stopped` after the stop request. */
const STATUS_POLL_ATTEMPTS = 5;
const STATUS_POLL_INTERVAL_MS = 1_000;
/** Longest wait for the fixture page's scripts to write their results. */
const SETTLE_MAX_MS = 12_000;
/** Longest wait for the popups to be reported and refused after the gesture call. */
const POPUP_WAIT_MS = 8_000;
const POLL_INTERVAL_MS = 500;

const API_BASE_URL = "https://api.browser-use.com/api/v4/browsers";
const API_KEY_HEADER = "X-Browser-Use-API-Key";
const REDIRECT_TO_BLOCKED_PORT_URL = "https://httpbingo.org/redirect-to?url=http%3A%2F%2Fexample.com%3A8080%2F";
const PUBLIC_PAGE_URL = "https://example.com";
const FIXTURE_PATH = "/capture-fixture";

const baseEnabled = process.env.RUN_REMOTE_CAPTURE === "1" && Boolean(process.env.BROWSER_USE_API_KEY);
const booTiqueEnabled = baseEnabled && Boolean(process.env.NEXT_PUBLIC_APP_URL);
const fixtureBaseUrl = (process.env.LIVE_FIXTURE_BASE_URL ?? "").replace(/\/+$/, "");
const fixtureAltBaseUrl = (process.env.LIVE_FIXTURE_ALT_BASE_URL ?? "").replace(/\/+$/, "");
const fixtureEnabled = baseEnabled && fixtureBaseUrl !== "";
const crossSiteEnabled = fixtureEnabled && fixtureAltBaseUrl !== "";

function tagsOfCase(tagCase: FixtureTagCase): readonly string[] {
  return FIXTURE_TAGS.filter((entry) => entry.case === tagCase).map((entry) => entry.tag);
}

const SAME_SITE_TAGS = tagsOfCase("same-site");
const CROSS_SITE_TAGS = tagsOfCase("cross-site");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixtureUrl(path: string): string {
  return `${fixtureBaseUrl}${FIXTURE_PATH}${path}`;
}

function newCaptureId(): string {
  return globalThis.crypto.randomUUID();
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

/**
 * Runs a live case and, in a `finally` block, stops every active session tagged with its
 * capture id. `reclaimSession` never rejects. A capture stops its own session, so this is
 * the safety net for a case that failed half way.
 */
async function withReclaim<T>(captureId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await reclaimSession(
      { fetch, clock: createSystemClock(), apiKey: process.env.BROWSER_USE_API_KEY as string },
      captureId,
    );
  }
}

/** Captures `url` with the default dependencies and a known capture id. */
async function captureLive(url: string): Promise<CaptureResult> {
  const captureId = newCaptureId();
  return withReclaim(captureId, () => capturePage(url, { newCaptureId: () => captureId }));
}

/** Captures `url` with a browser whose create response the test can see. */
async function captureRecorded(url: string, captureId: string): Promise<{ result: CaptureResult; sessionId?: string }> {
  const sink: { sessionId?: string } = {};
  const clock = createSystemClock();
  const recordingFetch = createRecordingFetch(sink);
  const config = loadConfig();
  const result = await capturePage(url, {
    config,
    clock,
    newCaptureId: () => captureId,
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

/**
 * How many active sessions the vendor lists for `captureId` with `filterBy=active`, or -1
 * when the list cannot be read. -1 never equals the expected 0, so an unreadable list fails.
 */
async function countActiveSessions(captureId: string): Promise<number> {
  try {
    const response = await fetch(activeSessionsUrl(1, captureId), {
      method: "GET",
      headers: { [API_KEY_HEADER]: process.env.BROWSER_USE_API_KEY as string },
    });
    if (!response.ok) return -1;
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.items)) return -1;
    return body.items.length;
  } catch {
    return -1;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Calls `check` until it is true or `timeoutMs` has passed. Returns the last answer. */
async function pollUntil(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await wait(POLL_INTERVAL_MS);
  }
}

/** The tag name of a forbidden fixture URL (`<origin>/ff/<tag>`), or `undefined` for any other URL. */
function forbiddenTagOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== FIXTURE_FORBIDDEN_ORIGIN || !parsed.pathname.startsWith("/ff/")) return undefined;
    return parsed.pathname.slice("/ff/".length);
  } catch {
    return undefined;
  }
}

/**
 * The page guards the live test hands to the adapter: the real policy (real syntax checks
 * and real DNS) wrapped so the test can see which URLs the guard refused and which events
 * it reported. The guard itself is the production one; only the policy is observed.
 */
type PolicyRecorder = {
  guards: PageGuards;
  events: GuardEvent[];
  /** The distinct tags of forbidden fixture URLs that the policy refused. */
  refusedTags(): Set<string>;
};

function createPolicyRecorder(): PolicyRecorder {
  const events: GuardEvent[] = [];
  const refusedUrls: string[] = [];
  const policy = createGuardPolicy({
    resolver: createDnsResolver(),
    report: (event) => {
      events.push(event);
    },
  });
  const guards: PageGuards = {
    checkSyntax(url) {
      const verdict = policy.checkSyntax(url);
      if (!verdict.allowed) refusedUrls.push(url);
      return verdict;
    },
    async checkHost(url) {
      const verdict = await policy.checkHost(url);
      if (!verdict.allowed) refusedUrls.push(url);
      return verdict;
    },
    report(event) {
      policy.report(event);
    },
  };
  return {
    guards,
    events,
    refusedTags() {
      const tags = new Set<string>();
      for (const url of refusedUrls) {
        const tag = forbiddenTagOf(url);
        if (tag !== undefined) tags.add(tag);
      }
      return tags;
    },
  };
}

type GuardedPage = {
  page: CapturePage;
  recorder: PolicyRecorder;
  gesture: PageGestureControl;
  hardeningOn: boolean;
};

/**
 * Opens one session through the production adapter, installs the guards with the recording
 * policy and runs `run`. The adapter is the real `createRemoteBrowser` with the opt-in
 * `onPageReady`, which `getBrowser` never sets. The session is stopped in a `finally` block.
 */
async function withGuardedPage(run: (live: GuardedPage) => Promise<void>): Promise<void> {
  const config = loadConfig();
  const control: { value?: PageGestureControl } = {};
  const provider = createRemoteBrowser(config, {
    fetch,
    clock: createSystemClock(),
    onPageReady: (offered) => {
      control.value = offered;
    },
  });
  const handle = await provider.createSession({
    timeoutMinutes: config.sessionTimeoutMinutes,
    proxy: config.proxy,
    viewport: { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height },
    captureId: newCaptureId(),
  });
  try {
    const page = await handle.connect({ timeoutMs: CDP_CONNECT_TIMEOUT_MS });
    if (control.value === undefined) throw new Error("the adapter offered no page control");
    const recorder = createPolicyRecorder();
    await page.installGuards(recorder.guards);
    await run({ page, recorder, gesture: control.value, hardeningOn: config.websocketHardening !== "off" });
  } finally {
    try {
      await handle.stop();
    } catch {
      // The stop error text is redacted, and nothing here prints it either.
    }
  }
}

/** The names of the `result <name>` list items of the fixture page, read through the normal collector. */
async function readResults(page: CapturePage): Promise<Set<string>> {
  const raw = await page.collect({
    maxElements: MAX_ELEMENTS,
    maxTextChars: MAX_TEXT_CHARS,
    maxAttrChars: MAX_ATTR_CHARS,
    attributeNames: "full",
    limits: COLLECT_LIMITS,
  });
  const names = new Set<string>();
  for (const element of raw.elements) {
    const match = /^result ([a-z-]+)$/.exec(element.text);
    if (match) names.add(match[1]);
  }
  return names;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function requestBlockedEvents(events: readonly GuardEvent[]): GuardEvent[] {
  return events.filter((event) => event.kind === "request-blocked");
}

type PixelBounds = { left: number; right: number; top: number; bottom: number };

/**
 * The bounds of the marker's red pixels in a decoded JPEG, in image pixels, or `undefined`
 * when there are none. A column or row belongs to the marker when at least half of the
 * marker's height (or width) in it is red, so a few stray pixels cannot move the bounds.
 * `right` and `bottom` are exclusive.
 */
function redMarkerBounds(bytes: Uint8Array, expectedTop: number, expectedBottom: number): PixelBounds | undefined {
  const image = decode(bytes, { useTArray: true });
  const { width, height, data } = image;
  const firstRow = Math.max(0, Math.floor(expectedTop) - ALIGNMENT_SCAN_MARGIN_PX);
  const lastRow = Math.min(height, Math.ceil(expectedBottom) + ALIGNMENT_SCAN_MARGIN_PX);
  const columnCounts = new Array<number>(width).fill(0);
  const rowCounts = new Array<number>(height).fill(0);
  for (let y = firstRow; y < lastRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (
        data[offset] >= RED_MIN_CHANNEL &&
        data[offset + 1] <= RED_MAX_OTHER_CHANNEL &&
        data[offset + 2] <= RED_MAX_OTHER_CHANNEL
      ) {
        columnCounts[x] += 1;
        rowCounts[y] += 1;
      }
    }
  }
  const columnMin = Math.ceil(FIXTURE_ALIGNMENT.markerHeightPx / 2);
  const rowMin = Math.ceil(FIXTURE_ALIGNMENT.markerWidthPx / 2);
  const columns = columnCounts.flatMap((count, x) => (count >= columnMin ? [x] : []));
  const rows = rowCounts.flatMap((count, y) => (count >= rowMin ? [y] : []));
  if (columns.length === 0 || rows.length === 0) return undefined;
  return {
    left: columns[0],
    right: columns[columns.length - 1] + 1,
    top: rows[0],
    bottom: rows[rows.length - 1] + 1,
  };
}

describe.skipIf(!baseEnabled)("remote capture (live)", () => {
  it(
    "refuses a public redirect to a blocked port within the block limit",
    async () => {
      const started = performance.now();
      const result = await captureLive(REDIRECT_TO_BLOCKED_PORT_URL);
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
    "leaves the session of a finished capture stopped and not listed as active",
    async () => {
      const captureId = newCaptureId();
      await withReclaim(captureId, async () => {
        const { result, sessionId } = await captureRecorded(PUBLIC_PAGE_URL, captureId);

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

        let listed = await countActiveSessions(captureId);
        for (let attempt = 1; attempt < STATUS_POLL_ATTEMPTS && listed !== 0; attempt += 1) {
          await wait(STATUS_POLL_INTERVAL_MS);
          listed = await countActiveSessions(captureId);
        }
        // Listing with `filterBy=active` and the capture id returns no session.
        expect(listed).toBe(0);
      });
    },
    CASE_TIMEOUT_MS,
  );

  it.skipIf(!booTiqueEnabled)(
    "captures the Boo-tique home page with the default dependencies",
    async () => {
      const result = await captureLive(`${process.env.NEXT_PUBLIC_APP_URL}/boo-tique`);

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

  it.skipIf(!fixtureEnabled)(
    "guards every request source of the fixture page at the adapter level",
    async () => {
      await withGuardedPage(async ({ page, recorder, gesture, hardeningOn }) => {
        // The page loads within the navigation limit: `goto` waits for `load`, and a frame, a
        // worker or a socket that the guard left paused would keep it from finishing.
        const started = performance.now();
        const navigation = await page.goto(fixtureUrl(""), { timeoutMs: NAVIGATION_TIMEOUT_MS });
        expect(performance.now() - started).toBeLessThanOrEqual(NAVIGATION_TIMEOUT_MS);
        expect(navigation.status).toBe(200);

        const names = FIXTURE_RESULTS;
        const required: string[] = [names.workerUrlRan, names.workerBlobRan, names.sharedWorkerRan, names.swRejected];
        if (hardeningOn) required.push(names.wsError, names.cspConnectViolation);
        const sameSiteSeen = (): boolean => {
          const refused = recorder.refusedTags();
          return SAME_SITE_TAGS.every((tag) => refused.has(tag));
        };
        let results = new Set<string>();
        await pollUntil(async () => {
          results = await readResults(page);
          return required.every((name) => results.has(name)) && sameSiteSeen();
        }, SETTLE_MAX_MS);

        // Both dedicated workers and the shared worker ran, so the guard let them start.
        expect(sorted(results)).toEqual(expect.arrayContaining(sorted(required)));

        // The distinct forbidden tags the guard refused are exactly the same-site sources.
        // Tags of the cross-site frame belong to the cross-site case and are left out here.
        const sameSiteRefused = [...recorder.refusedTags()].filter((tag) => !CROSS_SITE_TAGS.includes(tag));
        expect(sorted(sameSiteRefused)).toEqual(sorted(SAME_SITE_TAGS));
        expect(requestBlockedEvents(recorder.events).length).toBeGreaterThanOrEqual(SAME_SITE_TAGS.length);

        // The service worker script was refused, so the registration was rejected.
        expect(results.has(names.swRegistered)).toBe(false);
        expect(
          recorder.events.some((event) => event.kind === "request-blocked" && event.reason === "service-worker-blocked"),
        ).toBe(true);

        if (hardeningOn) {
          // The WebSocket failed and the injected policy recorded a `connect-src` violation.
          expect(results.has(names.wsOpen)).toBe(false);
          expect(results.has(names.wsError)).toBe(true);
          expect(results.has(names.cspConnectViolation)).toBe(true);
        }

        // A popup opened with a gesture is closed, and its navigation tag is refused. The
        // adapter closes the popup at once, so its own sub-resource tag may never be requested.
        await gesture.callWithGesture("openFixturePopups");
        await pollUntil(
          () => recorder.events.some((event) => event.kind === "popup-closed") && recorder.refusedTags().has("popup-nav"),
          POPUP_WAIT_MS,
        );
        expect(recorder.events.some((event) => event.kind === "popup-closed")).toBe(true);
        expect(recorder.refusedTags().has("popup-nav")).toBe(true);

        // The guard stayed up for the whole case.
        expect(recorder.events.some((event) => event.kind === "guard-lost")).toBe(false);
      });
    },
    GUARD_CASE_TIMEOUT_MS,
  );

  it.skipIf(!crossSiteEnabled)(
    "loads the cross-site frame with the guard on and refuses its requests",
    async () => {
      // The alt base is another site than the base, and an https origin: the frame needs both.
      expect(new URL(fixtureAltBaseUrl).protocol).toBe("https:");
      expect(new URL(fixtureAltBaseUrl).hostname).not.toBe(new URL(fixtureBaseUrl).hostname);

      await withGuardedPage(async ({ page, recorder }) => {
        await page.goto(fixtureUrl(""), { timeoutMs: NAVIGATION_TIMEOUT_MS });

        let results = new Set<string>();
        await pollUntil(async () => {
          results = await readResults(page);
          const refused = recorder.refusedTags();
          return results.has(FIXTURE_RESULTS.crossFrameLoaded) && CROSS_SITE_TAGS.every((tag) => refused.has(tag));
        }, SETTLE_MAX_MS);

        // The frame posted `loaded` to its parent, so it ran with the guard on.
        expect(results.has(FIXTURE_RESULTS.crossFrameLoaded)).toBe(true);
        const refused = recorder.refusedTags();
        expect(sorted(CROSS_SITE_TAGS.filter((tag) => refused.has(tag)))).toEqual(sorted(CROSS_SITE_TAGS));
        expect(recorder.events.some((event) => event.kind === "guard-lost")).toBe(false);
      });
    },
    GUARD_CASE_TIMEOUT_MS,
  );

  it.skipIf(!fixtureEnabled)(
    "refuses the fixture redirect to a forbidden address",
    async () => {
      const result = await captureLive(fixtureUrl("/redirect"));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("the capture of the fixture redirect succeeded");
      expect(result.error.code).toBe("navigation-blocked");
    },
    CASE_TIMEOUT_MS,
  );

  it.skipIf(!fixtureEnabled)(
    "places the marker box on the red pixels of the first image",
    async () => {
      const result = await captureLive(fixtureUrl("/alignment"));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`capture failed with code ${result.error.code}`);

      const marker = result.snapshot.elements.find((element) => element.tag === "div" && element.text === "Marker");
      expect(marker).toBeDefined();
      if (!marker) return;
      const image = result.images[0];
      expect(image).toBeDefined();

      const box = marker.boundingBox;
      const top = box.y - image.offsetY;
      const bounds = redMarkerBounds(image.bytes, top, top + box.height);
      expect(bounds).toBeDefined();
      if (!bounds) return;

      // Each edge of the box is within the tolerance of the matching edge of the red pixels.
      expect(Math.abs(bounds.left - box.x)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
      expect(Math.abs(bounds.right - (box.x + box.width))).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
      expect(Math.abs(bounds.top - top)).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
      expect(Math.abs(bounds.bottom - (top + box.height))).toBeLessThanOrEqual(ALIGNMENT_TOLERANCE_PX);
    },
    CASE_TIMEOUT_MS,
  );

  it.skipIf(!fixtureEnabled)(
    "reads a form whose inputs are named like built-in members",
    async () => {
      const result = await captureLive(fixtureUrl("/clobber"));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`capture failed with code ${result.error.code}`);

      // The text inside the form and the form's own inputs are in the snapshot.
      expect(result.snapshot.elements.some((element) => (element.text ?? "").includes(FIXTURE_CLOBBER_TEXT))).toBe(true);
      const inputs = result.snapshot.elements.filter((element) => element.tag === "input");
      expect(inputs.length).toBeGreaterThanOrEqual(FIXTURE_CLOBBER_NAMES.length);
    },
    CASE_TIMEOUT_MS,
  );
});
