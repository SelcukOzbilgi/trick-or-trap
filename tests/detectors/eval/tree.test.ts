import { describe, it, expect } from "vitest";
import { BaseSnapshotSchema, PageSnapshotSchema } from "@/lib/types";
import type { ElementSnapshot, PageSnapshot } from "@/lib/types";
import { buildSnapshot } from "@/tests/detectors/eval/helpers/tree";
import type { PageNode } from "@/tests/detectors/eval/helpers/tree";
import { toLightSample } from "@/tests/detectors/eval/helpers/light";
import { assertNoTestHooks } from "@/tests/detectors/eval/helpers/no-hooks";

const BASE = { capturedAt: "2026-12-01T12:00:00.000Z", url: "https://shop.example/" };
const RELOAD_TIME = "2026-12-01T12:00:09.000Z";

function body(...children: PageNode[]): PageNode {
  return { tag: "body", children };
}

function build(root: PageNode): { snapshot: PageSnapshot; keyToId: ReadonlyMap<string, string> } {
  return buildSnapshot(root, BASE);
}

function ids(snapshot: PageSnapshot): string[] {
  return snapshot.elements.map((e) => e.id);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

function byId(snapshot: { readonly elements: readonly ElementSnapshot[] }, id: string): ElementSnapshot {
  return must(snapshot.elements.find((e) => e.id === id));
}

describe("buildSnapshot: ids and eligibility", () => {
  it("gives el-1 to the body and child-index ids below it", () => {
    const { snapshot, keyToId } = build({
      key: "body",
      tag: "body",
      children: [
        { key: "h", tag: "h1", text: "Hello" },
        {
          key: "box",
          tag: "div",
          children: [
            { key: "a", tag: "span", text: "A" },
            { key: "b", tag: "span", text: "B" },
          ],
        },
      ],
    });
    expect(keyToId.get("body")).toBe("el-1");
    expect(keyToId.get("h")).toBe("el-1-0");
    expect(keyToId.get("box")).toBe("el-1-1");
    expect(keyToId.get("a")).toBe("el-1-1-0");
    expect(keyToId.get("b")).toBe("el-1-1-1");
    expect(ids(snapshot)).toEqual(["el-1-0", "el-1-1-0", "el-1-1-1"]);
  });

  it("keeps the body when it has own text", () => {
    const { snapshot } = build({ tag: "body", text: "Hi" });
    expect(ids(snapshot)).toEqual(["el-1"]);
  });

  it("leaves out a div without own text and role but keeps the ids of its children", () => {
    const { snapshot } = build(body({ tag: "div", children: [{ tag: "p", text: "Inside" }] }));
    expect(ids(snapshot)).toEqual(["el-1-0-0"]);
  });

  it("keeps a div that has a role, with the text of its descendants", () => {
    const { snapshot } = build(
      body({ tag: "div", role: "status", children: [{ tag: "span", text: "Sold" }, { tag: "span", text: "today" }] }),
    );
    expect(byId(snapshot, "el-1-0").role).toBe("status");
    expect(byId(snapshot, "el-1-0").text).toBe("Sold today");
  });

  it("leaves out a zero-size span and keeps a zero-size input", () => {
    const { snapshot } = build(
      body(
        { tag: "span", text: "gone", box: { width: 0, height: 0 } },
        { tag: "input", attrs: { type: "checkbox" }, box: { width: 0, height: 0 } },
        { tag: "span", text: "no width", box: { width: 0, height: 10 } },
      ),
    );
    expect(ids(snapshot)).toEqual(["el-1-1"]);
    expect(byId(snapshot, "el-1-1").boundingBox).toMatchObject({ width: 0, height: 0 });
  });

  it("includes the text of the descendants in a label", () => {
    const { snapshot } = build(
      body({
        tag: "label",
        text: "Add protection",
        children: [{ tag: "input", attrs: { type: "checkbox" }, checked: true }, { tag: "span", text: "+$4.99" }],
      }),
    );
    expect(byId(snapshot, "el-1-0").text).toBe("Add protection +$4.99");
    expect(byId(snapshot, "el-1-0-1").text).toBe("+$4.99");
  });

  it("gives an input no text of its own", () => {
    const { snapshot } = build(body({ tag: "input", text: "ignored", attrs: { type: "text" } }));
    expect(byId(snapshot, "el-1-0").text).toBeUndefined();
  });

  it("collapses whitespace in text", () => {
    const { snapshot } = build(body({ tag: "p", text: "  a \n  b\t c  " }));
    expect(byId(snapshot, "el-1-0").text).toBe("a b c");
  });

  it("keeps a link only with an href or own text, and a button without text", () => {
    const { snapshot } = build(
      body(
        { tag: "a", attrs: { href: "/x" }, children: [{ tag: "img" }] },
        { tag: "a", children: [{ tag: "img" }] },
        { tag: "button" },
      ),
    );
    expect(ids(snapshot)).toEqual(["el-1-0", "el-1-2"]);
  });

  it("keeps a selected option and a control only through the control rule, not an unselected option", () => {
    const { snapshot } = build(
      body({
        tag: "select",
        children: [
          { tag: "option", text: "One", selected: true },
          { tag: "option", text: "Two" },
        ],
      }),
    );
    expect(ids(snapshot)).toEqual(["el-1-0", "el-1-0-0"]);
    expect(byId(snapshot, "el-1-0-0").selected).toBe(true);
  });

  it("sets checked only on inputs", () => {
    const { snapshot } = build(
      body(
        { tag: "input", attrs: { type: "checkbox" }, checked: true },
        { tag: "button", role: "switch", text: "On", checked: true, attrs: { "aria-checked": "true" } },
      ),
    );
    expect(byId(snapshot, "el-1-0").checked).toBe(true);
    expect(byId(snapshot, "el-1-1").checked).toBe(false);
  });

  it("skips script, style and template subtrees but counts their index", () => {
    const { snapshot } = build(
      body(
        { tag: "script", text: "var a" },
        { tag: "style", text: "p{}" },
        { tag: "template", children: [{ tag: "p", text: "hidden" }] },
        { tag: "p", text: "Visible" },
      ),
    );
    expect(ids(snapshot)).toEqual(["el-1-3"]);
  });

  it("drops non-controls under a display:none ancestor, keeps its controls and leaves its text out of a label", () => {
    const { snapshot } = build(
      body(
        {
          tag: "div",
          style: { display: "none" },
          children: [{ tag: "span", text: "x" }, { tag: "input", attrs: { type: "checkbox" } }],
        },
        {
          tag: "label",
          text: "Shown",
          children: [{ tag: "span", text: "secret", style: { display: "none" } }],
        },
      ),
    );
    expect(ids(snapshot)).toEqual(["el-1-0-1", "el-1-1"]);
    expect(byId(snapshot, "el-1-0-1").boundingBox).toMatchObject({ width: 0, height: 0 });
    expect(byId(snapshot, "el-1-1").text).toBe("Shown");
  });

  it("rejects a duplicate node key", () => {
    expect(() => build(body({ key: "k", tag: "p", text: "a" }, { key: "k", tag: "p", text: "b" }))).toThrow(/k/);
  });

  it("maps keys of left-out nodes to their ids too", () => {
    const { keyToId } = build(body({ key: "wrap", tag: "div", children: [{ tag: "p", text: "x" }] }));
    expect(keyToId.get("wrap")).toBe("el-1-0");
  });
});

describe("buildSnapshot: attributes, text caps and element cap", () => {
  it("keeps only the capture's attribute allow-list", () => {
    const { snapshot } = build(
      body({
        tag: "input",
        attrs: {
          type: "checkbox",
          name: "opt",
          disabled: "",
          value: "yes",
          "aria-checked": "true",
          "aria-label": "Option",
          class: "bt-toggle",
          id: "x",
          onclick: "boom()",
        },
      }),
    );
    expect(byId(snapshot, "el-1-0").attributes).toEqual({
      type: "checkbox",
      name: "opt",
      disabled: "",
      value: "yes",
      "aria-checked": "true",
      "aria-label": "Option",
    });
  });

  it("keeps a value only on buttons, options and checkbox, radio, submit, button and reset inputs", () => {
    const { snapshot } = build(
      body(
        { tag: "input", attrs: { type: "text", value: "typed" } },
        { tag: "input", attrs: { type: "radio", value: "r" } },
        { tag: "button", attrs: { value: "b" }, text: "Go" },
      ),
    );
    expect(byId(snapshot, "el-1-0").attributes).toEqual({ type: "text" });
    expect(byId(snapshot, "el-1-1").attributes).toEqual({ type: "radio", value: "r" });
    expect(byId(snapshot, "el-1-2").attributes).toEqual({ value: "b" });
  });

  it("cuts attribute values at 200 characters", () => {
    const { snapshot } = build(body({ tag: "input", attrs: { type: "text", placeholder: "p".repeat(500) } }));
    expect(byId(snapshot, "el-1-0").attributes?.placeholder).toHaveLength(200);
  });

  it("cuts text at 300 characters and marks it truncated", () => {
    const { snapshot } = build(body({ tag: "p", text: "w".repeat(400) }));
    const element = byId(snapshot, "el-1-0");
    expect(element.text).toHaveLength(300);
    expect(element.textTruncated).toBe(true);
  });

  it("stops at 1,500 elements and says so", () => {
    const children: PageNode[] = [];
    for (let i = 0; i < 1_600; i++) children.push({ tag: "span", text: `n${i}` });
    const { snapshot } = build(body(...children));
    expect(snapshot.elements).toHaveLength(1_500);
    expect(snapshot.capture?.eligibleElementCount).toBe(1_600);
    expect(snapshot.capture?.elementsTruncated).toBe(true);
  });

  it("does not report truncation below the cap", () => {
    const { snapshot } = build(body({ tag: "p", text: "x" }));
    expect(snapshot.capture?.elementsTruncated).toBe(false);
    expect(snapshot.capture?.light).toBe(false);
  });
});

describe("buildSnapshot: styles", () => {
  it("converts hex colours to rgb() and keeps px sizes", () => {
    const { snapshot } = build(
      body({ tag: "p", text: "Grey", style: { color: "#9a9a9a", backgroundColor: "#fff9ee", fontSize: "20px" } }),
    );
    const element = byId(snapshot, "el-1-0");
    expect(element.color).toBe("rgb(154, 154, 154)");
    expect(element.backgroundColor).toBe("rgb(255, 249, 238)");
    expect(element.fontSize).toBe("20px");
  });

  it("converts short hex, hex with alpha, transparent, numbers and passes rgb() through", () => {
    const { snapshot } = build(
      body(
        { tag: "p", text: "a", style: { color: "#fff", backgroundColor: "transparent", fontSize: 14, opacity: 0.6 } },
        { tag: "p", text: "b", style: { color: "#00000080", backgroundColor: "rgb(1, 2, 3)" } },
      ),
    );
    const first = byId(snapshot, "el-1-0");
    expect(first.color).toBe("rgb(255, 255, 255)");
    expect(first.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(first.fontSize).toBe("14px");
    expect(first.opacity).toBe("0.6");
    const second = byId(snapshot, "el-1-1");
    expect(second.color).toBe("rgba(0, 0, 0, 0.5)");
    expect(second.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("gives a missing style the browser defaults", () => {
    const { snapshot } = build(
      body({ tag: "p", text: "p" }, { tag: "span", text: "s" }, { tag: "button", text: "b" }),
    );
    const p = byId(snapshot, "el-1-0");
    expect(p).toMatchObject({
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      opacity: "1",
      display: "block",
      visibility: "visible",
      position: "static",
    });
    expect(byId(snapshot, "el-1-1").display).toBe("inline");
    expect(byId(snapshot, "el-1-2").display).toBe("inline-block");
  });

  it("inherits color, font size and visibility, but not opacity, background or position", () => {
    const { snapshot } = build({
      tag: "body",
      style: { color: "#2a1512", fontSize: "18px", visibility: "hidden", opacity: 0.5, backgroundColor: "#fbf3e4" },
      children: [{ tag: "p", text: "child" }, { tag: "p", text: "own", style: { visibility: "visible", color: "#ffffff" } }],
    });
    expect(byId(snapshot, "el-1-0")).toMatchObject({
      color: "rgb(42, 21, 18)",
      fontSize: "18px",
      visibility: "hidden",
      opacity: "1",
      backgroundColor: "rgba(0, 0, 0, 0)",
    });
    expect(byId(snapshot, "el-1-1")).toMatchObject({ color: "rgb(255, 255, 255)", visibility: "visible" });
  });

  it("cuts style strings at 64 characters", () => {
    const { snapshot } = build(body({ tag: "p", text: "x", style: { display: "x".repeat(200) } }));
    expect(byId(snapshot, "el-1-0").display).toHaveLength(64);
  });
});

describe("buildSnapshot: box estimate", () => {
  it("estimates width from characters, font size and padding, and height from font size and padding", () => {
    const { snapshot } = build(
      body({ tag: "button", text: "0123456789", style: { fontSize: "20px", padding: "10px 30px" } }),
    );
    const box = byId(snapshot, "el-1-0").boundingBox;
    expect(box.width).toBeCloseTo(10 * 20 * 0.55 + 60, 5);
    expect(box.height).toBeCloseTo(1.25 * 20 + 20, 5);
  });

  it("raises the box to minWidth and minHeight, and lets explicit size and box win", () => {
    const { snapshot } = build(
      body(
        { tag: "button", text: "ok", style: { minWidth: "160px", minHeight: "48px" } },
        { tag: "button", text: "ok", style: { minHeight: "48px" }, box: { x: 5, y: 7, width: 3, height: 8 } },
        { tag: "button", text: "ok", style: { width: "100%", height: 30 } },
      ),
    );
    expect(byId(snapshot, "el-1-0").boundingBox).toMatchObject({ width: 160, height: 48 });
    expect(byId(snapshot, "el-1-1").boundingBox).toEqual({ x: 5, y: 7, width: 3, height: 8 });
    expect(byId(snapshot, "el-1-2").boundingBox.height).toBe(30);
  });

  it("wraps long text at the layout width", () => {
    const { snapshot } = build(body({ tag: "p", text: "w".repeat(300) }));
    const box = byId(snapshot, "el-1-0").boundingBox;
    expect(box.width).toBe(1_280);
    expect(box.height).toBeGreaterThan(1.25 * 16);
  });

  it("gives a checkbox a small fixed box", () => {
    const { snapshot } = build(body({ tag: "input", attrs: { type: "checkbox" } }));
    expect(byId(snapshot, "el-1-0").boundingBox).toMatchObject({ width: 13, height: 13 });
  });

  it("stacks boxes downwards by default, and every box has finite, non-negative numbers", () => {
    const { snapshot } = build(body({ tag: "p", text: "one" }, { tag: "p", text: "two" }));
    const [a, b] = snapshot.elements;
    expect(must(b).boundingBox.y).toBeGreaterThanOrEqual(must(a).boundingBox.y + must(a).boundingBox.height);
    for (const e of snapshot.elements) {
      for (const n of Object.values(e.boundingBox)) {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("buildSnapshot: the result", () => {
  it("passes PageSnapshotSchema", () => {
    const { snapshot } = build(
      body(
        { tag: "h1", text: "Shop" },
        { tag: "label", text: "Gift wrap +$3.00", children: [{ tag: "input", attrs: { type: "checkbox", name: "wrap" } }] },
        { tag: "button", text: "Buy", style: { fontSize: "20px", color: "#ffffff", backgroundColor: "#8b1a1a" } },
      ),
    );
    expect(PageSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.url).toBe(BASE.url);
    expect(snapshot.capturedAt).toBe(BASE.capturedAt);
  });

  it("describes a single full-page image and flags an element beyond it", () => {
    const { snapshot } = build(
      body({ tag: "p", text: "near" }, { tag: "p", text: "far", box: { x: 0, y: 99_999, width: 50, height: 20 } }),
    );
    expect(snapshot.capture?.images?.mode).toBe("single");
    expect(snapshot.capture?.images?.items).toHaveLength(1);
    expect(byId(snapshot, "el-1-0").outsideImage).toBe(false);
    expect(byId(snapshot, "el-1-1").outsideImage).toBe(true);
  });

  it("keeps keyToId out of the snapshot", () => {
    const result = build(body({ key: "zz-unique-key", tag: "p", text: "x" }));
    expect("keyToId" in result.snapshot).toBe(false);
    expect(JSON.stringify(result.snapshot)).not.toContain("zz-unique-key");
  });

  it("builds the same snapshot twice", () => {
    const tree = body({ tag: "p", text: "x" }, { tag: "button", text: "y" });
    expect(build(tree).snapshot).toEqual(build(tree).snapshot);
  });
});

describe("toLightSample", () => {
  function fullSample(): PageSnapshot {
    return build(
      body(
        { tag: "p", text: "w".repeat(250) },
        {
          tag: "input",
          attrs: {
            type: "checkbox",
            name: "opt",
            disabled: "",
            value: "yes",
            href: "/x",
            "aria-checked": "true",
            "data-x": "1",
          },
          checked: true,
        },
        { tag: "a", attrs: { href: "/next" }, text: "Next" },
      ),
    ).snapshot;
  }

  it("cuts text to 120 characters and marks it truncated", () => {
    const light = toLightSample(fullSample(), RELOAD_TIME);
    const element = byId(light as PageSnapshot, "el-1-0");
    expect(element.text).toHaveLength(120);
    expect(element.textTruncated).toBe(true);
  });

  it("keeps only type, name and disabled", () => {
    const light = toLightSample(fullSample(), RELOAD_TIME);
    expect(byId(light as PageSnapshot, "el-1-1").attributes).toEqual({ type: "checkbox", name: "opt", disabled: "" });
    expect(byId(light as PageSnapshot, "el-1-2").attributes).toEqual({});
  });

  it("keeps the state and drops outsideImage and the images", () => {
    const full = fullSample();
    expect(byId(full, "el-1-0").outsideImage).toBe(false);
    expect(full.capture?.images).toBeDefined();
    const light = toLightSample(full, RELOAD_TIME);
    expect(byId(light as PageSnapshot, "el-1-1").checked).toBe(true);
    for (const e of light.elements) expect("outsideImage" in e).toBe(false);
    expect(light.capture?.images).toBeUndefined();
    expect("images" in (light.capture ?? {})).toBe(false);
    expect(light.capture?.light).toBe(true);
  });

  it("takes the given capture time and leaves the input untouched", () => {
    const full = fullSample();
    const before = JSON.stringify(full);
    const light = toLightSample(full, RELOAD_TIME);
    expect(light.capturedAt).toBe(RELOAD_TIME);
    expect(light.url).toBe(full.url);
    expect(JSON.stringify(full)).toBe(before);
    expect(full.capture?.light).toBe(false);
  });

  it("caps the elements at 750 and reports the truncation", () => {
    const children: PageNode[] = [];
    for (let i = 0; i < 800; i++) children.push({ tag: "span", text: `n${i}` });
    const full = build(body(...children)).snapshot;
    expect(full.elements).toHaveLength(800);
    expect(full.capture?.elementsTruncated).toBe(false);
    const light = toLightSample(full, RELOAD_TIME);
    expect(light.elements).toHaveLength(750);
    expect(light.capture?.elementsTruncated).toBe(true);
    expect(light.capture?.eligibleElementCount).toBe(800);
  });

  it("passes the schema, also as the afterReload sample", () => {
    const full = fullSample();
    const light = toLightSample(full, RELOAD_TIME);
    expect(BaseSnapshotSchema.safeParse(light).success).toBe(true);
    expect(PageSnapshotSchema.safeParse({ ...full, afterReload: light }).success).toBe(true);
  });
});

describe("test hooks", () => {
  it("passes assertNoTestHooks on every built snapshot, full and light", () => {
    const { snapshot } = build(
      body(
        { tag: "h1", text: "Shop" },
        { tag: "input", attrs: { type: "checkbox", name: "a", "aria-checked": "false" } },
      ),
    );
    expect(() => assertNoTestHooks(snapshot)).not.toThrow();
    const light = toLightSample(snapshot, RELOAD_TIME);
    expect(() => assertNoTestHooks({ ...snapshot, afterReload: light })).not.toThrow();
  });

  it("throws when a tree node carries a data-* attribute", () => {
    const { snapshot } = build(body({ tag: "p", text: "x", attrs: { "data-x": "1" } }));
    expect(() => assertNoTestHooks(snapshot)).toThrow(/data-x/);
  });

  it("leaves a data-* attribute out of the light sample", () => {
    const { snapshot } = build(body({ tag: "input", attrs: { type: "text", "data-x": "1" } }));
    const light = toLightSample(snapshot, RELOAD_TIME);
    expect(byId(light, "el-1-0").attributes).toEqual({ type: "text" });
    expect(() => assertNoTestHooks(snapshot)).toThrow(/data-x/);
    expect(() => assertNoTestHooks(light)).not.toThrow();
  });
});
