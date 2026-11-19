import { describe, it, expect } from "vitest";
import {
  classifyControl,
  findChoiceGroups,
  isChoiceControl,
} from "@/lib/detectors/shared/choice-groups";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex, IndexedElement } from "@/lib/detectors/shared/elements";

type Raw = Record<string, unknown>;

function raw(id: string, tag: string, text: string, over: Raw = {}): Raw {
  return {
    id,
    tag,
    text,
    boundingBox: { x: 0, y: 0, width: 100, height: 30 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    fontSize: "16px",
    opacity: "1",
    display: "block",
    visibility: "visible",
    position: "static",
    checked: false,
    selected: false,
    ...over,
  };
}

function button(id: string, text = "Button", over: Raw = {}): Raw {
  return raw(id, "button", text, over);
}

function indexOf(elements: unknown[]): ElementIndex {
  return buildIndex({ elements }, false);
}

function ids(group: { controls: readonly IndexedElement[] }): string[] {
  return group.controls.map((el) => el.id);
}

function kindOf(text: string, over: Raw = {}, tag = "button"): string {
  const index = indexOf([raw("el-1-0", tag, text, over)]);
  return classifyControl(index.elements[0]);
}

describe("findChoiceGroups: grouping by container", () => {
  it("puts controls under one parent in one group", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      button("el-1-0-1", "Reject all"),
    ]);
    const groups = findChoiceGroups(index);
    expect(groups).toHaveLength(1);
    expect(groups[0].path).toEqual([1, 0]);
    expect(ids(groups[0])).toEqual(["el-1-0-0", "el-1-0-1"]);
  });

  it("puts a control up to three levels below the container in the same group", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      raw("el-1-0-1-0-0", "a", "Manage settings"),
    ]);
    const groups = findChoiceGroups(index);
    expect(groups).toHaveLength(1);
    expect(groups[0].path).toEqual([1, 0]);
    expect(ids(groups[0])).toEqual(["el-1-0-0", "el-1-0-1-0-0"]);
  });

  it("does not group controls whose common ancestor is four levels above one of them", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      button("el-1-0-1-0-0-0", "Reject all"),
    ]);
    expect(findChoiceGroups(index)).toEqual([]);
    const apart = indexOf([
      button("el-1-0-0-0", "Accept all"),
      button("el-2-0-0-0", "Reject all"),
    ]);
    expect(findChoiceGroups(apart)).toEqual([]);
  });

  it("gives no group for a single control", () => {
    expect(findChoiceGroups(indexOf([button("el-1-0-0", "Accept all")]))).toEqual([]);
  });

  it("keeps a tight pair together and leaves a distant control out of it", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      button("el-1-0-1", "Reject all"),
      button("el-1-3-0-0", "Buy now"),
    ]);
    const groups = findChoiceGroups(index);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0])).toEqual(["el-1-0-0", "el-1-0-1"]);
  });

  it("puts a control in at most one group", () => {
    const index = indexOf([
      button("el-1-0-0", "A"),
      button("el-1-0-1", "B"),
      button("el-1-1-0", "C"),
      button("el-1-1-1", "D"),
    ]);
    const groups = findChoiceGroups(index);
    expect(groups.map(ids)).toEqual([
      ["el-1-0-0", "el-1-0-1"],
      ["el-1-1-0", "el-1-1-1"],
    ]);
  });

  it("returns groups and controls in document order whatever the array order", () => {
    const index = indexOf([
      button("el-1-1-1", "D"),
      button("el-1-0-1", "B"),
      button("el-1-1-0", "C"),
      button("el-1-0-0", "A"),
    ]);
    expect(findChoiceGroups(index).map(ids)).toEqual([
      ["el-1-0-0", "el-1-0-1"],
      ["el-1-1-0", "el-1-1-1"],
    ]);
  });

  it("does not group a control with the control it contains", () => {
    const index = indexOf([
      raw("el-1-0", "a", "Outer link"),
      button("el-1-0-0", "Inner"),
    ]);
    expect(findChoiceGroups(index)).toEqual([]);
  });

  it("ignores elements with an id that has no integer path", () => {
    const index = indexOf([
      button("el-x-0", "Accept all"),
      button("el-x-1", "Reject all"),
      button("not-an-id", "Close"),
    ]);
    expect(findChoiceGroups(index)).toEqual([]);
  });

  it("returns an empty list for an empty index", () => {
    expect(findChoiceGroups(indexOf([]))).toEqual([]);
    expect(findChoiceGroups(buildIndex(null, false))).toEqual([]);
  });
});

describe("findChoiceGroups: which elements are controls", () => {
  it("counts buttons, links, submit and button inputs and role button or link elements", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      raw("el-1-0-1", "a", "Manage"),
      raw("el-1-0-2", "input", "", { attributes: { type: "submit" } }),
      raw("el-1-0-3", "input", "", { attributes: { type: "button" } }),
      raw("el-1-0-4", "div", "Skip", { role: "button" }),
      raw("el-1-0-5", "span", "Learn more", { role: "link" }),
    ]);
    const groups = findChoiceGroups(index);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0])).toEqual([
      "el-1-0-0",
      "el-1-0-1",
      "el-1-0-2",
      "el-1-0-3",
      "el-1-0-4",
      "el-1-0-5",
    ]);
  });

  it("leaves out text inputs, checkboxes, plain text, switches and tabs", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      raw("el-1-0-1", "input", "", { attributes: { type: "text" } }),
      raw("el-1-0-2", "input", "", { attributes: { type: "checkbox" } }),
      raw("el-1-0-3", "span", "Some text"),
      raw("el-1-0-4", "button", "Gift wrap", { role: "switch" }),
      raw("el-1-0-5", "button", "Details", { role: "tab" }),
    ]);
    expect(findChoiceGroups(index)).toEqual([]);
  });

  it("leaves out hidden controls", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      button("el-1-0-1", "Reject all", { display: "none" }),
      button("el-1-0-2", "Manage", { visibility: "hidden" }),
      raw("el-1-0-3", "a", "Skip", { boundingBox: { x: 0, y: 0, width: 0, height: 0 } }),
    ]);
    expect(findChoiceGroups(index)).toEqual([]);
  });

  it("isChoiceControl agrees with the rules above", () => {
    const index = indexOf([
      button("el-1-0-0", "Accept all"),
      raw("el-1-0-1", "span", "Some text"),
      raw("el-1-0-2", "a", "Manage"),
      button("el-1-0-3", "Hidden", { display: "none" }),
    ]);
    expect(index.elements.map(isChoiceControl)).toEqual([true, false, true, false]);
  });
});

describe("findChoiceGroups: budgets", () => {
  it("keeps at most 50 groups", () => {
    const elements: unknown[] = [];
    for (let i = 0; i < 60; i += 1) {
      elements.push(button(`el-1-${i}-0`, "Accept"));
      elements.push(button(`el-1-${i}-1`, "Decline"));
    }
    const groups = findChoiceGroups(indexOf(elements));
    expect(groups).toHaveLength(50);
    expect(ids(groups[0])).toEqual(["el-1-0-0", "el-1-0-1"]);
    expect(ids(groups[49])).toEqual(["el-1-49-0", "el-1-49-1"]);
  });

  it("keeps at most 8 controls per group, the first 8 in document order", () => {
    const elements: unknown[] = [];
    for (let i = 0; i < 12; i += 1) elements.push(button(`el-1-0-${i}`, `Option ${i}`));
    const groups = findChoiceGroups(indexOf(elements));
    expect(groups).toHaveLength(1);
    expect(groups[0].controls).toHaveLength(8);
    expect(ids(groups[0])).toEqual(Array.from({ length: 8 }, (_, i) => `el-1-0-${i}`));
  });

  it("stays fast and bounded for 1,500 controls", () => {
    const elements: unknown[] = [];
    for (let i = 0; i < 1500; i += 1) elements.push(button(`el-1-${i % 40}-${Math.floor(i / 40)}`, "Go"));
    const started = performance.now();
    const groups = findChoiceGroups(indexOf(elements));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(groups.length).toBeLessThanOrEqual(50);
    for (const group of groups) expect(group.controls.length).toBeLessThanOrEqual(8);
  });
});

describe("classifyControl", () => {
  it("accept words, in English and Turkish", () => {
    for (const text of [
      "Accept all",
      "Accept",
      "Allow all",
      "I agree",
      "OK",
      "Got it",
      "Yes, please",
      "Subscribe",
      "Add to cart",
      "Continue",
      "Claim my discount",
      "Kabul et",
      "Tümünü kabul et",
      "İzin ver",
      "Tamam",
      "Evet, istiyorum",
      "Abone ol",
    ]) {
      expect(kindOf(text), text).toBe("accept");
    }
  });

  it("reject words, in English and Turkish", () => {
    for (const text of [
      "Reject all",
      "Decline",
      "Refuse",
      "Deny",
      "Only necessary",
      "Necessary only",
      "Essential only",
      "No, I'll pay full price",
      "Reddet",
      "Tümünü reddet",
      "Sadece gerekli",
      "Yalnızca zorunlu",
    ]) {
      expect(kindOf(text), text).toBe("reject");
    }
  });

  it("lesser words, in English and Turkish", () => {
    for (const text of [
      "Settings",
      "Manage preferences",
      "Options",
      "More options",
      "Customise",
      "Customize",
      "Learn more",
      "Ayarlar",
      "Seçenekler",
      "Tercihler",
      "Yönet",
      "Özelleştir",
    ]) {
      expect(kindOf(text), text).toBe("lesser");
    }
  });

  it("close glyphs and an aria-label of Close", () => {
    for (const glyph of ["x", "X", "×", "✕", "✖"]) {
      expect(kindOf(glyph), glyph).toBe("close");
    }
    expect(kindOf("", { attributes: { "aria-label": "Close" } })).toBe("close");
    expect(kindOf("×", { attributes: { "aria-label": "Close" } })).toBe("close");
    expect(kindOf("", { attributes: { "aria-label": "Dismiss" } })).toBe("close");
    expect(kindOf("", { attributes: { "aria-label": "Kapat" } })).toBe("close");
  });

  it("exact plain declines, in English and Turkish, also with punctuation and capitals", () => {
    for (const text of [
      "No thanks",
      "No, thanks",
      "NO THANKS!",
      "No thank you",
      "Not now",
      "Maybe later",
      "Skip",
      "Not interested",
      "Hayır",
      "Hayır, teşekkürler",
      "HAYIR TEŞEKKÜRLER",
      "Şimdi değil",
      "Belki sonra",
    ]) {
      expect(kindOf(text), text).toBe("plain-decline");
    }
  });

  it("a plain decline with more words is not a plain decline", () => {
    expect(kindOf("No thanks, I hate saving")).toBe("reject");
    expect(kindOf("Not now, maybe never")).toBe("other");
  });

  it("other text and empty text are other", () => {
    expect(kindOf("Buy now")).toBe("other");
    expect(kindOf("Sepete git")).toBe("other");
    expect(kindOf("")).toBe("other");
    expect(kindOf("I don't need a bag")).toBe("other");
  });

  it("matches words only at the start of the text and only as whole words", () => {
    expect(kindOf("Please accept")).toBe("other");
    expect(kindOf("Okay")).toBe("other");
    expect(kindOf("Address book")).toBe("other");
  });

  it("skips leading symbols before the first word", () => {
    expect(kindOf("✓ Accept all")).toBe("accept");
  });

  it("falls back to the aria-label when the control has no text", () => {
    expect(kindOf("", { attributes: { "aria-label": "Accept all" } })).toBe("accept");
    expect(kindOf("", { attributes: { "aria-label": "Reject all" } })).toBe("reject");
  });

  it("does not read data attributes", () => {
    const trap = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "aria-label" || key === "type") return undefined;
          throw new Error(`read of ${String(key)}`);
        },
        has() {
          return false;
        },
        ownKeys() {
          throw new Error("iterated");
        },
      }
    );
    expect(kindOf("Accept all", { attributes: trap })).toBe("accept");
  });
});
