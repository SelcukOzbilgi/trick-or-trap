import { describe, it, expect } from "vitest";
import {
  CLUB_OFFER_TEXT,
  CLUB_TIMER_SECONDS,
  CLUB_TIMER_STORAGE_KEY,
  clubTimerText,
  formatMinutesSeconds,
  nextClubTimerState,
} from "@/lib/boo-tique/club-timer";

const NOW = 1_700_000_000_000;

describe("formatMinutesSeconds", () => {
  it("formats 599 seconds as 09:59", () => {
    expect(formatMinutesSeconds(599)).toBe("09:59");
  });

  it("formats zero as 00:00", () => {
    expect(formatMinutesSeconds(0)).toBe("00:00");
  });

  it("pads minutes and seconds to two digits", () => {
    expect(formatMinutesSeconds(61)).toBe("01:01");
  });

  it("clamps a negative or non-finite value to 00:00", () => {
    expect(formatMinutesSeconds(-3)).toBe("00:00");
    expect(formatMinutesSeconds(Number.NaN)).toBe("00:00");
  });
});

describe("club timer constants", () => {
  it("runs for 599 seconds", () => {
    expect(CLUB_TIMER_SECONDS).toBe(599);
  });

  it("uses a bt- storage key", () => {
    expect(CLUB_TIMER_STORAGE_KEY).toBe("bt-club-timer-end");
  });
});

describe("nextClubTimerState", () => {
  it("starts a 599 second period when nothing is stored", () => {
    expect(nextClubTimerState(null, NOW)).toEqual({
      endMs: NOW + 599_000,
      remainingSeconds: 599,
    });
  });

  it("restarts when the stored end is in the past", () => {
    expect(nextClubTimerState(NOW - 5_000, NOW)).toEqual({
      endMs: NOW + 599_000,
      remainingSeconds: 599,
    });
  });

  it("restarts when the stored end is exactly now", () => {
    expect(nextClubTimerState(NOW, NOW).remainingSeconds).toBe(599);
  });

  it("restarts when the stored end is not a finite number", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(nextClubTimerState(bad, NOW), String(bad)).toEqual({
        endMs: NOW + 599_000,
        remainingSeconds: 599,
      });
    }
  });

  it("keeps a future end and returns the remaining seconds", () => {
    const end = NOW + 120_000;
    expect(nextClubTimerState(end, NOW)).toEqual({
      endMs: end,
      remainingSeconds: 120,
    });
  });

  it("rounds the remaining seconds up", () => {
    const end = NOW + 1_001;
    expect(nextClubTimerState(end, NOW)).toEqual({
      endMs: end,
      remainingSeconds: 2,
    });
  });

  it("never reports zero remaining seconds for a future end", () => {
    expect(nextClubTimerState(NOW + 1, NOW).remainingSeconds).toBe(1);
  });
});

describe("clubTimerText", () => {
  it("gives the initial text for a fresh period", () => {
    expect(clubTimerText(CLUB_TIMER_SECONDS)).toBe("Join in 09:59 for 20% off");
  });

  it("keeps the same offer text before and after a restart", () => {
    const before = clubTimerText(nextClubTimerState(NOW + 30_000, NOW).remainingSeconds);
    const afterRestart = clubTimerText(
      nextClubTimerState(NOW - 1, NOW).remainingSeconds,
    );
    expect(before).toContain(CLUB_OFFER_TEXT);
    expect(afterRestart).toContain(CLUB_OFFER_TEXT);
    expect(before).toBe("Join in 00:30 for 20% off");
    expect(afterRestart).toBe("Join in 09:59 for 20% off");
  });

  it("uses the offer text constant", () => {
    expect(CLUB_OFFER_TEXT).toBe("20% off");
  });
});
