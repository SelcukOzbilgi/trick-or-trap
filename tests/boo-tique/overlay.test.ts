import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  EXIT_CONFIRM_DELAY_MS,
  EXIT_CONFIRM_TEXT,
  dialogClickAction,
  nextFocusIndex,
  shouldCloseOnKey,
} from "@/lib/boo-tique/overlay";

/** Fake clicked node: `closest` returns a marker only for the selectors in `matches`. */
function fakeNode(matches: readonly string[]) {
  return {
    closest(selector: string): unknown {
      return matches.includes(selector) ? { selector } : null;
    },
  };
}

describe("exit confirmation constants", () => {
  it("has the delay and the text of 6.1", () => {
    expect(EXIT_CONFIRM_DELAY_MS).toBe(1500);
    expect(EXIT_CONFIRM_TEXT).toBe("Demo shop: nothing was sent");
  });
});

describe("dialogClickAction", () => {
  it("ignores a null node", () => {
    expect(dialogClickAction(null)).toBe("ignore");
  });

  it("ignores a node that matches neither selector", () => {
    expect(dialogClickAction(fakeNode([]))).toBe("ignore");
  });

  it("closes when only [data-bt-close] matches", () => {
    expect(dialogClickAction(fakeNode(["[data-bt-close]"]))).toBe("close");
  });

  it("confirms then closes when both selectors match", () => {
    expect(
      dialogClickAction(fakeNode(["[data-bt-close]", "[data-bt-confirm]"])),
    ).toBe("confirm-then-close");
  });

  it("confirms then closes when only [data-bt-confirm] matches", () => {
    expect(dialogClickAction(fakeNode(["[data-bt-confirm]"]))).toBe(
      "confirm-then-close",
    );
  });
});

describe("overlay component sources", () => {
  const root = process.cwd();
  const dialog = readFileSync(
    join(root, "components/boo-tique/overlay-dialog.tsx"),
    "utf8",
  );
  const modal = readFileSync(
    join(root, "components/boo-tique/exit-intent-modal.tsx"),
    "utf8",
  );

  it("imports the click helper and the delay from the overlay module", () => {
    expect(dialog).toContain("dialogClickAction");
    expect(dialog).toContain("EXIT_CONFIRM_DELAY_MS");
    expect(dialog).toContain('@/lib/boo-tique/overlay"');
  });

  it.each([
    ["overlay-dialog.tsx", dialog],
    ["exit-intent-modal.tsx", modal],
  ])("stores and sends nothing in %s", (_name, source) => {
    for (const word of [
      "fetch(",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "<form",
      "XMLHttpRequest",
    ]) {
      expect(source, word).not.toContain(word);
    }
  });
});

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
