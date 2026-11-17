import { describe, it, expect } from "vitest";
import {
  HERO_COUNTDOWN_SECONDS,
  formatCountdown,
} from "@/lib/boo-tique/countdown";

describe("formatCountdown", () => {
  it("formats 17999 seconds as 04:59:59", () => {
    expect(formatCountdown(17999)).toBe("04:59:59");
  });

  it("formats zero as 00:00:00", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
  });

  it("clamps a negative value to 00:00:00", () => {
    expect(formatCountdown(-5)).toBe("00:00:00");
  });

  it("pads each field to two digits", () => {
    expect(formatCountdown(3661)).toBe("01:01:01");
  });

  it("rounds a fractional value down to whole seconds", () => {
    expect(formatCountdown(59.9)).toBe("00:00:59");
  });
});

describe("HERO_COUNTDOWN_SECONDS", () => {
  it("is 17999", () => {
    expect(HERO_COUNTDOWN_SECONDS).toBe(17999);
  });
});
