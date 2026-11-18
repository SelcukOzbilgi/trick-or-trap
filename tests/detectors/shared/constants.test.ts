import { describe, it, expect } from "vitest";
import * as constants from "@/lib/detectors/shared/constants";

/** The constants table of design section 4, value for value. */
const EXPECTED = {
  MAX_ELEMENTS_CONSIDERED: 1500,
  MAX_RELOAD_ELEMENTS_CONSIDERED: 750,
  MAX_TEXT_READ: 300,
  RELOAD_TEXT_CAP: 120,
  MAX_ATTR_READ: 200,
  MAX_STYLE_READ: 64,
  MAX_ROLE_TAG_READ: 32,
  MAX_ID_CHARS: 256,
  MAX_ID_DEPTH: 64,
  MAX_TOKENS_PER_TEXT: 80,
  MAX_PHRASE_TOKENS: 6,
  MAX_QUOTE_CHARS: 120,
  MAX_FINDINGS_PER_DETECTOR: 20,
  MAX_CHOICE_GROUPS: 50,
  MAX_CONTROLS_PER_GROUP: 8,
  GROUP_MAX_LEVELS: 3,
  LABEL_MAX_LEVELS: 3,
  MIN_GAP_SECONDS: 3,
  MAX_GAP_SECONDS: 120,
  TOLERANCE_BASE_SECONDS: 2,
  DATE_ZONE_SLACK_HOURS: 14,
  LOW_STOCK_MAX: 10,
  AREA_RATIO_MIN: 2,
  FONT_RATIO_MIN: 1.4,
  SMALL_FONT_PX: 12,
  DECLINE_CONTRAST_MAX: 3,
  ACCEPT_CONTRAST_MIN: 4.5,
  DECLINE_OPACITY_MAX: 0.7,
  CLOSE_MIN_PX: 16,
  CLOSE_CONTRAST_MIN: 3,
  EQUAL_AREA_RATIO_MAX: 1.25,
  HIDDEN_OPACITY_MAX: 0.01,
  HOSTILE_TIME_BUDGET_MS: 2000,
} as const;

describe("detector constants (design section 4)", () => {
  it("exports exactly the constants of the table, each with its value", () => {
    expect({ ...constants }).toEqual(EXPECTED);
  });

  it.each(Object.entries(EXPECTED))("%s is a finite number", (name, value) => {
    const actual = (constants as Record<string, unknown>)[name];
    expect(typeof actual).toBe("number");
    expect(Number.isFinite(actual as number)).toBe(true);
    expect(actual).toBe(value);
  });

  it("keeps the reload text cap and element budget below the full ones", () => {
    expect(constants.RELOAD_TEXT_CAP).toBeLessThan(constants.MAX_TEXT_READ);
    expect(constants.MAX_RELOAD_ELEMENTS_CONSIDERED).toBeLessThan(
      constants.MAX_ELEMENTS_CONSIDERED
    );
    expect(constants.MIN_GAP_SECONDS).toBeLessThan(constants.MAX_GAP_SECONDS);
  });
});
