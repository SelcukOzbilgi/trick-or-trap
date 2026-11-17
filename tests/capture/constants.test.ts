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
    expect(constants.TILE_MODE_THRESHOLD_PX).toBe(30_000);
    expect(constants.MAX_TILES).toBe(10);
    expect(constants.TILE_MIN_REMAINING_MS).toBe(3_000);
  });

  it("has the viewport and session values", () => {
    expect(constants.BROWSER_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(constants.SESSION_TIMEOUT_DEFAULT_MINUTES).toBe(2);
    expect(constants.SESSION_TIMEOUT_MIN_MINUTES).toBe(1);
    expect(constants.SESSION_TIMEOUT_MAX_MINUTES).toBe(5);
  });

  it("has the detail cap", () => {
    expect(constants.MAX_DETAIL_CHARS).toBe(200);
  });
});
