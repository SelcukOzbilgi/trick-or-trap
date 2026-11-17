import { describe, it, expect } from "vitest";
import { nextFocusIndex, shouldCloseOnKey } from "@/lib/boo-tique/overlay";

describe("nextFocusIndex", () => {
  it("wraps forward from the last element to the first", () => {
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it("wraps backward from the first element to the last", () => {
    expect(nextFocusIndex(0, 3, true)).toBe(2);
  });

  it("moves forward by one in the middle", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
  });

  it("moves backward by one in the middle", () => {
    expect(nextFocusIndex(2, 3, true)).toBe(1);
    expect(nextFocusIndex(1, 3, true)).toBe(0);
  });

  it("returns -1 when there is nothing to focus", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
  });

  it("enters the list from the dialog itself (index -1)", () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it("stays on the only element when the count is 1", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });
});

describe("shouldCloseOnKey", () => {
  it("closes on Escape", () => {
    expect(shouldCloseOnKey("Escape")).toBe(true);
  });

  it("does not close on any other key", () => {
    for (const key of ["Enter", "Tab", " ", "a", "ArrowDown", "Esc", "escape", ""]) {
      expect(shouldCloseOnKey(key), key).toBe(false);
    }
  });
});
