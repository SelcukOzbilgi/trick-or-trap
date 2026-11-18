import { describe, expect, it } from "vitest";
import * as constants from "@/lib/capture/constants";

describe("capture constants", () => {
  it("has the deadline values", () => {
    expect(constants.API_FETCH_TIMEOUT_MS).toBe(10_000);
    expect(constants.CDP_CONNECT_TIMEOUT_MS).toBe(15_000);
    expect(constants.NAVIGATION_TIMEOUT_MS).toBe(15_000);
    expect(constants.CAPTURE_TIMEOUT_MS).toBe(45_000);
    expect(constants.SETTLE_DELAY_MS).toBe(500);
    expect(constants.RELOAD_MIN_REMAINING_MS).toBe(12_000);
  });

  it("has the URL limits", () => {
    expect(constants.MAX_URL_LENGTH).toBe(2_048);
    expect([...constants.ALLOWED_PORTS]).toEqual([80, 443]);
  });

  it("has the element and text caps", () => {
    expect(constants.MAX_ELEMENTS).toBe(1_500);
    expect(constants.MAX_ELEMENTS_LIGHT).toBe(750);
    expect(constants.MAX_TEXT_CHARS).toBe(300);
    expect(constants.MAX_TEXT_CHARS_LIGHT).toBe(120);
    expect(constants.MAX_ATTR_CHARS).toBe(200);
  });

  it("has the screenshot limits", () => {
    expect(constants.SCREENSHOT_MAX_HEIGHT_PX).toBe(8_000);
    expect(constants.SCREENSHOT_JPEG_QUALITY).toBe(70);
    expect(constants.MAX_BASE64_LENGTH).toBe(4_194_304);
    expect(constants).not.toHaveProperty("TILE_MODE_THRESHOLD_PX");
    expect(constants.MAX_TILES).toBe(10);
    expect(constants.TILE_MIN_REMAINING_MS).toBe(3_000);
  });

  it("has the request guard limits", () => {
    expect(constants.GUARD_DECISION_TIMEOUT_MS).toBe(5_000);
    expect(constants.MAX_REQUEST_HOSTS).toBe(100);
    expect(constants.MAX_HOP_URL_LENGTH).toBe(8_192);
  });

  it("has the guard heartbeat values", () => {
    expect(constants.GUARD_HEARTBEAT_INTERVAL_MS).toBe(2_000);
    expect(constants.GUARD_HEARTBEAT_TIMEOUT_MS).toBe(5_000);
  });

  it("has the WebSocket hardening values", () => {
    expect(constants.MAX_REWRITE_BODY_BYTES).toBe(8_388_608);
    expect(constants.HARDENING_CSP).toBe("connect-src http: https: data: blob:");
  });

  it("has the stop and sweep values", () => {
    expect(constants.STOP_TIMEOUT_MS).toBe(10_000);
    expect(constants.STALE_SESSION_AGE_MS).toBe(120_000);
  });

  it("has the size bounds for page data", () => {
    expect(constants.MAX_TAG_CHARS).toBe(64);
    expect(constants.MAX_ROLE_CHARS).toBe(64);
    expect(constants.MAX_STYLE_CHARS).toBe(64);
    expect(constants.MAX_ATTR_NAME_CHARS).toBe(64);
    expect(constants.MAX_ATTRS_PER_ELEMENT).toBe(32);
    expect(constants.MAX_PATH_DEPTH).toBe(256);
    expect(constants.MAX_PATH_INDEX).toBe(100_000);
    expect(constants.MAX_ELEMENT_ID_CHARS).toBe(2_048);
    expect(constants.RAW_SCAN_FACTOR).toBe(2);
    expect(constants.MAX_SNAPSHOT_BYTES).toBe(1_500_000);
  });

  it("has the layout and plausibility values", () => {
    expect(constants.LAYOUT_DRIFT_PX).toBe(4);
    expect(constants.MAX_PLAUSIBLE_DPR).toBe(8);
    expect(constants.MAX_PLAUSIBLE_PX).toBe(1_000_000);
    expect(constants.TILE_MODE_THRESHOLD_CSS_PX).toBe(20_000);
  });

  it("builds COLLECT_LIMITS from the named constants", () => {
    expect(constants.COLLECT_LIMITS).toEqual({
      maxTagChars: constants.MAX_TAG_CHARS,
      maxRoleChars: constants.MAX_ROLE_CHARS,
      maxStyleChars: constants.MAX_STYLE_CHARS,
      maxAttrsPerElement: constants.MAX_ATTRS_PER_ELEMENT,
      maxAttrNameChars: constants.MAX_ATTR_NAME_CHARS,
      maxPathDepth: constants.MAX_PATH_DEPTH,
    });
  });

  it("keeps the id cap above the longest id a path can build", () => {
    // "el-" plus MAX_PATH_DEPTH indices of at most 6 digits, each followed by a dash.
    const longest = 3 + constants.MAX_PATH_DEPTH * (String(constants.MAX_PATH_INDEX).length + 1);
    expect(longest).toBeLessThanOrEqual(constants.MAX_ELEMENT_ID_CHARS);
  });

  it("has the viewport and session values", () => {
    expect(constants.BROWSER_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(constants.SESSION_TIMEOUT_DEFAULT_MINUTES).toBe(1);
    expect(constants.SESSION_TIMEOUT_MIN_MINUTES).toBe(1);
    expect(constants.SESSION_TIMEOUT_MAX_MINUTES).toBe(5);
  });

  it("has the detail cap", () => {
    expect(constants.MAX_DETAIL_CHARS).toBe(200);
  });
});
