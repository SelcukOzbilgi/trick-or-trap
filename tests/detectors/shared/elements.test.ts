import { describe, it, expect } from "vitest";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { AttrKey } from "@/lib/detectors/shared/elements";
import {
  MAX_ATTR_READ,
  MAX_ELEMENTS_CONSIDERED,
  MAX_RELOAD_ELEMENTS_CONSIDERED,
  MAX_ROLE_TAG_READ,
  MAX_STYLE_READ,
  MAX_TEXT_READ,
  RELOAD_TEXT_CAP,
} from "@/lib/detectors/shared/constants";

type Raw = Record<string, unknown>;

/** A raw element as the capture would write it; `over` replaces any field. */
function raw(id: string, over: Raw = {}): Raw {
  return {
    id,
    tag: "span",
    text: "x",
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
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

function sample(elements: unknown, extra: Raw = {}): Raw {
  return {
    url: "https://shop.example/",
    capturedAt: "2026-12-01T12:00:00.000Z",
    viewportWidth: 1280,
    viewportHeight: 800,
    fullWidth: 1280,
    fullHeight: 2000,
    elements,
    ...extra,
  };
}

/** Ten elements: el-1 has three children, el-1-1 has two, and el-1-1-0 has one. */
const TREE_IDS = [
  "el-1",
  "el-1-0",
  "el-1-0-0",
  "el-1-0-1",
  "el-1-1",
  "el-1-1-0",
  "el-1-1-0-0",
  "el-1-1-1",
  "el-1-2",
  "el-2",
];

function treeIndex(ids: readonly string[] = TREE_IDS) {
  return buildIndex(sample(ids.map((id) => raw(id))), false);
}

function idsOf(list: readonly { readonly id: string }[]): string[] {
  return list.map((e) => e.id);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

describe("synthetic ids and structure", () => {
  it("does not treat el-1-1 as an ancestor of el-1-10, nor the other way round", () => {
    const index = buildIndex(
      sample([raw("el-1-1"), raw("el-1-10"), raw("el-1")]),
      false
    );
    const short = must(index.byId("el-1-1"));
    const long = must(index.byId("el-1-10"));
    expect(index.isAncestor(short, long)).toBe(false);
    expect(index.isAncestor(long, short)).toBe(false);
    expect(idsOf(index.ancestors(long))).toEqual(["el-1"]);
    expect(index.commonPath(short, long)).toEqual([1]);
  });

  it("parses ids into integer paths and treats el- as the root", () => {
    const index = buildIndex(
      sample([raw("el-"), raw("el-1"), raw("el-1-0-12")]),
      false
    );
    expect(must(index.byId("el-")).path).toEqual([]);
    expect(must(index.byId("el-1")).path).toEqual([1]);
    expect(must(index.byId("el-1-0-12")).path).toEqual([1, 0, 12]);
    const root = must(index.byId("el-"));
    expect(index.isAncestor(root, must(index.byId("el-1")))).toBe(true);
    expect(index.isAncestor(root, root)).toBe(false);
    expect(idsOf(index.ancestors(must(index.byId("el-1-0-12"))))).toEqual([
      "el-1",
      "el-",
    ]);
  });

  it("gives path null for ids with letters, over 256 characters or over 64 segments", () => {
    const tooLong = `el-${"1".repeat(254)}`; // 257 characters
    const sixtyFive = `el-${Array.from({ length: 65 }, () => "0").join("-")}`;
    const sixtyFour = `el-${Array.from({ length: 64 }, () => "0").join("-")}`;
    const index = buildIndex(
      sample([
        raw("el-1a"),
        raw("x-1"),
        raw("el--1"),
        raw("el-1-"),
        raw(tooLong),
        raw(sixtyFive),
        raw(sixtyFour),
        raw("el-1"),
      ]),
      false
    );
    const paths = index.elements.map((e) => [e.id, e.path] as const);
    for (const [id, path] of paths) {
      if (id === "el-1" || id === sixtyFour) expect(path).not.toBeNull();
      else expect(path).toBeNull();
    }
    expect(index.elements.some((e) => e.id.length > 256)).toBe(false);
  });

  it("gives an element with an invalid id no ancestors and no descendants", () => {
    const index = buildIndex(
      sample([raw("el-1"), raw("el-1-0"), raw("oops"), raw("el-1x")]),
      false
    );
    const odd = must(index.byId("oops"));
    const parent = must(index.byId("el-1"));
    const child = must(index.byId("el-1-0"));
    expect(index.ancestors(odd)).toEqual([]);
    expect(index.isAncestor(parent, odd)).toBe(false);
    expect(index.isAncestor(odd, child)).toBe(false);
    expect(index.commonPath(odd, child)).toBeNull();
    expect(idsOf(index.subtree([1]))).toEqual(["el-1", "el-1-0"]);
  });

  it("returns elements in path order whatever the order of the array", () => {
    const shuffled = [
      "el-2",
      "el-1-1",
      "el-1-0-1",
      "el-1",
      "el-1-10",
      "el-1-0",
      "el-1-2",
    ];
    const index = treeIndex(shuffled);
    expect(idsOf(index.elements)).toEqual([
      "el-1",
      "el-1-0",
      "el-1-0-1",
      "el-1-1",
      "el-1-2",
      "el-1-10",
      "el-2",
    ]);
    expect(index.elements.map((e) => e.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("puts elements with an invalid id last, in their original order", () => {
    const index = buildIndex(
      sample([raw("b-bad"), raw("el-3"), raw("a-bad"), raw("el-1")]),
      false
    );
    expect(idsOf(index.elements)).toEqual(["el-1", "el-3", "b-bad", "a-bad"]);
  });

  it("keeps the original order for duplicate ids and finds the first one by id", () => {
    const index = buildIndex(
      sample([
        raw("el-1", { text: "first" }),
        raw("el-1", { text: "second" }),
      ]),
      false
    );
    expect(index.elements.map((e) => e.text)).toEqual(["first", "second"]);
    expect(must(index.byId("el-1")).text).toBe("first");
  });

  it("lists ancestors nearest first, within the levels asked for", () => {
    const index = treeIndex();
    const deep = must(index.byId("el-1-1-0-0"));
    expect(idsOf(index.ancestors(deep))).toEqual(["el-1-1-0", "el-1-1", "el-1"]);
    expect(idsOf(index.ancestors(deep, 2))).toEqual(["el-1-1-0", "el-1-1"]);
    expect(idsOf(index.ancestors(deep, 0))).toEqual([]);
    expect(index.ancestors(must(index.byId("el-2")))).toEqual([]);
  });

  it("counts levels by path, so a missing middle element still uses up a level", () => {
    const index = treeIndex(["el-1", "el-1-1", "el-1-1-0-0"]);
    const deep = must(index.byId("el-1-1-0-0"));
    expect(idsOf(index.ancestors(deep))).toEqual(["el-1-1", "el-1"]);
    expect(idsOf(index.ancestors(deep, 2))).toEqual(["el-1-1"]);
  });

  it("lists a subtree, including its own element, and stops at the first element outside", () => {
    const index = treeIndex();
    expect(idsOf(index.subtree([1, 1]))).toEqual([
      "el-1-1",
      "el-1-1-0",
      "el-1-1-0-0",
      "el-1-1-1",
    ]);
    expect(idsOf(index.subtree([1, 0]))).toEqual([
      "el-1-0",
      "el-1-0-0",
      "el-1-0-1",
    ]);
    expect(idsOf(index.subtree([2]))).toEqual(["el-2"]);
    expect(idsOf(index.subtree([1, 1, 0, 0, 0]))).toEqual([]);
    expect(index.subtree([]).length).toBe(TREE_IDS.length);
  });

  it("does not mix el-1-1 and el-1-10 in a subtree", () => {
    const index = treeIndex(["el-1-1", "el-1-1-0", "el-1-10", "el-1-10-0"]);
    expect(idsOf(index.subtree([1, 1]))).toEqual(["el-1-1", "el-1-1-0"]);
    expect(idsOf(index.subtree([1, 10]))).toEqual(["el-1-10", "el-1-10-0"]);
  });

  it("gives the grandparent's path as the common path of two cousins", () => {
    const index = treeIndex();
    const a = must(index.byId("el-1-0-0"));
    const b = must(index.byId("el-1-1-0"));
    expect(index.commonPath(a, b)).toEqual([1]);
    const sibling = must(index.byId("el-1-0-1"));
    expect(index.commonPath(a, sibling)).toEqual([1, 0]);
    expect(index.commonPath(a, must(index.byId("el-2")))).toEqual([]);
    expect(index.commonPath(a, a)).toEqual([1, 0, 0]);
  });

  it("answers the same on a second call and on a rebuilt index", () => {
    const first = treeIndex();
    const second = treeIndex();
    expect(idsOf(first.subtree([1, 1]))).toEqual(idsOf(second.subtree([1, 1])));
    expect(idsOf(first.subtree([1, 1]))).toEqual(idsOf(first.subtree([1, 1])));
  });
});

describe("element fields", () => {
  it("reads the fields of a well-formed element", () => {
    const index = buildIndex(
      sample([
        raw("el-1", {
          tag: "BUTTON",
          role: "Switch",
          text: "Only 2 left",
          boundingBox: { x: 5, y: 6, width: 20, height: 4 },
          color: "rgb(1, 2, 3)",
          backgroundColor: "rgb(4, 5, 6)",
          fontSize: "11.5px",
          opacity: "0.6",
          display: "Block",
          visibility: "visible",
          position: "fixed",
          checked: true,
          outsideImage: true,
          textTruncated: true,
        }),
      ]),
      false
    );
    const el = must(index.byId("el-1"));
    expect(el.tag).toBe("button");
    expect(el.role).toBe("switch");
    expect(el.text).toBe("Only 2 left");
    expect(el.tokens.map((t) => t.norm)).toEqual(["only", "2", "left"]);
    expect(el.box).toEqual({ x: 5, y: 6, width: 20, height: 4 });
    expect(el.area).toBe(80);
    expect(el.color).toBe("rgb(1, 2, 3)");
    expect(el.backgroundColor).toBe("rgb(4, 5, 6)");
    expect(el.fontSizePx).toBe(11.5);
    expect(el.opacity).toBe(0.6);
    expect(el.display).toBe("block");
    expect(el.visibility).toBe("visible");
    expect(el.position).toBe("fixed");
    expect(el.checked).toBe(true);
    expect(el.outsideImage).toBe(true);
    expect(el.textTruncated).toBe(true);
    expect(el.isControl).toBe(true);
    expect(el.hidden).toBe(false);
  });

  it("uses safe defaults for missing or wrongly typed fields", () => {
    const index = buildIndex(
      sample([
        {
          id: "el-1",
          tag: 7,
          role: {},
          text: 12,
          boundingBox: "big",
          color: null,
          fontSize: 16,
          opacity: [],
          display: false,
          checked: "yes",
          outsideImage: "true",
        },
      ]),
      false
    );
    const el = must(index.byId("el-1"));
    expect(el.tag).toBe("");
    expect(el.role).toBe("");
    expect(el.text).toBe("");
    expect(el.tokens).toEqual([]);
    expect(el.box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(el.area).toBe(0);
    expect(el.color).toBe("");
    expect(el.fontSizePx).toBeNull();
    expect(el.opacity).toBe(1);
    expect(el.display).toBe("");
    expect(el.checked).toBe(false);
    expect(el.outsideImage).toBe(false);
    expect(el.textTruncated).toBe(false);
  });

  it("skips entries that are not objects and ignores a sample without an elements array", () => {
    const index = buildIndex(
      sample([null, 5, "text", raw("el-1"), undefined, []]),
      false
    );
    expect(idsOf(index.elements.filter((e) => e.id === "el-1"))).toEqual(["el-1"]);
    for (const bad of [null, undefined, 3, "x", {}, { elements: "no" }]) {
      const empty = buildIndex(bad, false);
      expect(empty.elements).toEqual([]);
      expect(empty.budgetHit).toBe(false);
      expect(empty.captureTruncated).toBe(false);
      expect(empty.byId("el-1")).toBeUndefined();
    }
  });

  it.each([
    ["display none", { display: "none" }],
    ["visibility hidden", { visibility: "hidden" }],
    ["visibility collapse", { visibility: "collapse" }],
    ["opacity 0.01", { opacity: "0.01" }],
    ["opacity 0", { opacity: "0" }],
    ["a zero-width box", { boundingBox: { x: 0, y: 0, width: 0, height: 9 } }],
    ["a zero-height box", { boundingBox: { x: 0, y: 0, width: 9, height: 0 } }],
  ])("marks a span with %s as hidden", (_name, over) => {
    const index = buildIndex(sample([raw("el-1", over)]), false);
    expect(must(index.byId("el-1")).hidden).toBe(true);
  });

  it("keeps an element with opacity just above the limit visible", () => {
    const index = buildIndex(sample([raw("el-1", { opacity: "0.02" })]), false);
    expect(must(index.byId("el-1")).hidden).toBe(false);
  });

  it("does not hide a form control because of a zero box", () => {
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    const index = buildIndex(
      sample([
        raw("el-1", { tag: "input", boundingBox: zero }),
        raw("el-2", { tag: "span", boundingBox: zero }),
        raw("el-3", { tag: "button", boundingBox: zero }),
        raw("el-4", { tag: "select", boundingBox: zero }),
        raw("el-5", { tag: "textarea", boundingBox: zero }),
      ]),
      false
    );
    expect(must(index.byId("el-1")).hidden).toBe(false);
    expect(must(index.byId("el-1")).isControl).toBe(true);
    expect(must(index.byId("el-2")).hidden).toBe(true);
    expect(must(index.byId("el-2")).isControl).toBe(false);
    expect(must(index.byId("el-3")).hidden).toBe(false);
    expect(must(index.byId("el-4")).hidden).toBe(false);
    expect(must(index.byId("el-5")).hidden).toBe(false);
  });

  it("hides a control that has display none", () => {
    const index = buildIndex(
      sample([raw("el-1", { tag: "input", display: "none" })]),
      false
    );
    expect(must(index.byId("el-1")).hidden).toBe(true);
  });

  it("hides an element whose ancestor is hidden, also when a middle element is missing", () => {
    const index = buildIndex(
      sample([
        raw("el-1", { display: "none" }),
        raw("el-1-0"),
        raw("el-1-0-0-0"),
        raw("el-2"),
        raw("el-2-0"),
      ]),
      false
    );
    expect(must(index.byId("el-1")).hidden).toBe(true);
    expect(must(index.byId("el-1-0")).hidden).toBe(true);
    expect(must(index.byId("el-1-0-0-0")).hidden).toBe(true);
    expect(must(index.byId("el-2")).hidden).toBe(false);
    expect(must(index.byId("el-2-0")).hidden).toBe(false);
  });

  it("hides a child of an ancestor with opacity 0, but not the ancestor's sibling", () => {
    const index = buildIndex(
      sample([
        raw("el-1", { opacity: "0" }),
        raw("el-1-0"),
        raw("el-1x"),
        raw("el-10"),
      ]),
      false
    );
    expect(must(index.byId("el-1-0")).hidden).toBe(true);
    expect(must(index.byId("el-10")).hidden).toBe(false);
    expect(must(index.byId("el-1x")).hidden).toBe(false);
  });

  it.each([
    ["NaN", { x: 0, y: 0, width: Number.NaN, height: 5 }],
    ["Infinity", { x: 0, y: 0, width: 5, height: Number.POSITIVE_INFINITY }],
    ["a non-finite x", { x: Number.NEGATIVE_INFINITY, y: 0, width: 5, height: 5 }],
    ["a negative width", { x: 0, y: 0, width: -5, height: 5 }],
    ["a negative height", { x: 0, y: 0, width: 5, height: -1 }],
    ["a string size", { x: 0, y: 0, width: "5", height: 5 }],
    ["an overflowing area", { x: 0, y: 0, width: 1e200, height: 1e200 }],
  ])("gives a zero box and area 0 for %s", (_name, box) => {
    const index = buildIndex(
      sample([raw("el-1", { boundingBox: box })]),
      false
    );
    const el = must(index.byId("el-1"));
    expect(el.box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(el.area).toBe(0);
    expect(el.hidden).toBe(true); // zero-size and not a control
  });

  it("keeps a box that sits left of or above the page origin", () => {
    const index = buildIndex(
      sample([raw("el-1", { boundingBox: { x: -30, y: -2, width: 5, height: 5 } })]),
      false
    );
    expect(must(index.byId("el-1")).box).toEqual({ x: -30, y: -2, width: 5, height: 5 });
  });

  it("reads attributes only for the AttrKey names, by key", () => {
    const allowed = new Set<string>([
      "type",
      "name",
      "disabled",
      "aria-checked",
      "aria-label",
      "aria-modal",
      "aria-live",
    ]);
    const target: Record<string, string> = {
      type: "checkbox",
      name: "protect",
      disabled: "",
      "aria-checked": "true",
      "aria-label": "Gift",
      "aria-modal": "true",
      "aria-live": "polite",
      "data-hook": "never-read",
      class: "never-read",
      href: "never-read",
    };
    const attributes = new Proxy(target, {
      get(obj, prop) {
        if (typeof prop === "string" && allowed.has(prop)) return obj[prop];
        throw new Error(`read of ${String(prop)}`);
      },
      ownKeys() {
        throw new Error("iteration");
      },
      has() {
        throw new Error("has");
      },
      getOwnPropertyDescriptor(obj, prop) {
        if (typeof prop === "string" && allowed.has(prop)) {
          return Object.getOwnPropertyDescriptor(obj, prop);
        }
        throw new Error(`descriptor of ${String(prop)}`);
      },
    });
    const index = buildIndex(sample([raw("el-1", { attributes })]), false);
    const el = must(index.byId("el-1"));
    expect(el.attr("type")).toBe("checkbox");
    expect(el.attr("name")).toBe("protect");
    expect(el.attr("disabled")).toBe("");
    expect(el.attr("aria-checked")).toBe("true");
    expect(el.attr("aria-label")).toBe("Gift");
    expect(el.attr("aria-modal")).toBe("true");
    expect(el.attr("aria-live")).toBe("polite");
    const lookup = el.attr as (name: string) => string | undefined;
    expect(lookup("data-hook")).toBeUndefined();
    expect(lookup("class")).toBeUndefined();
    expect(lookup("href")).toBeUndefined();
    expect(lookup("constructor")).toBeUndefined();
  });

  it("returns undefined for a missing key, a non-string value and a bad attributes record", () => {
    const keys: AttrKey[] = ["type", "name", "aria-label"];
    const cases: unknown[] = [undefined, null, "x", 4, [], { type: 5, name: null }];
    for (const attributes of cases) {
      const index = buildIndex(sample([raw("el-1", { attributes })]), false);
      for (const key of keys) {
        expect(must(index.byId("el-1")).attr(key)).toBeUndefined();
      }
    }
  });

  it("does not take an inherited property as an attribute", () => {
    const inherited = Object.create({ type: "checkbox" }) as Record<string, string>;
    const index = buildIndex(sample([raw("el-1", { attributes: inherited })]), false);
    expect(must(index.byId("el-1")).attr("type")).toBeUndefined();
  });

  // Requirement 6.4: a getter that throws is an unexpected exception and
  // propagates when the attribute is read; it used to give undefined.
  it("lets a throwing attribute getter propagate when the attribute is read", () => {
    const throwing: Record<string, string> = {};
    Object.defineProperty(throwing, "type", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const index = buildIndex(sample([raw("el-2", { attributes: throwing })]), false);
    expect(() => must(index.byId("el-2")).attr("type")).toThrow("boom");
  });

  it("cuts fields to their caps before use", () => {
    const index = buildIndex(
      sample([
        raw("el-1", {
          text: "a".repeat(1000),
          tag: "t".repeat(100),
          role: "r".repeat(100),
          color: "c".repeat(1_000_000),
          backgroundColor: "b".repeat(200),
          attributes: { "aria-label": "l".repeat(500) },
        }),
      ]),
      false
    );
    const el = must(index.byId("el-1"));
    expect(el.text.length).toBe(MAX_TEXT_READ);
    expect(el.tag.length).toBe(MAX_ROLE_TAG_READ);
    expect(el.role.length).toBe(MAX_ROLE_TAG_READ);
    expect(el.color.length).toBe(MAX_STYLE_READ);
    expect(el.backgroundColor.length).toBe(MAX_STYLE_READ);
    expect(must(el.attr("aria-label")).length).toBe(MAX_ATTR_READ);
  });

  it("cuts the text of a reload sample at the reload cap", () => {
    const index = buildIndex(
      sample([raw("el-1", { text: "a".repeat(300) })]),
      true
    );
    expect(must(index.byId("el-1")).text.length).toBe(RELOAD_TEXT_CAP);
  });

  it("does not leave half of a surrogate pair at a cut", () => {
    const text = `${"a".repeat(MAX_TEXT_READ - 1)}😀tail`;
    const index = buildIndex(sample([raw("el-1", { text })]), false);
    const cut = must(index.byId("el-1")).text;
    expect(cut.length).toBe(MAX_TEXT_READ - 1);
    expect(cut.endsWith("a")).toBe(true);
  });

  it("cuts a very long id so that it never reaches the path parser whole", () => {
    const index = buildIndex(sample([raw(`el-${"1-".repeat(5000)}1`)]), false);
    expect(index.elements[0].id.length).toBeLessThanOrEqual(256);
    expect(index.elements[0].path).toBeNull();
  });

  it("reads opacity as a number between 0 and 1 and defaults to 1 for junk", () => {
    const index = buildIndex(
      sample([
        raw("el-1", { opacity: "0.35" }),
        raw("el-2", { opacity: "abc" }),
        raw("el-3", { opacity: "" }),
        raw("el-4", { opacity: "7" }),
        raw("el-5", { opacity: "-3" }),
      ]),
      false
    );
    expect(must(index.byId("el-1")).opacity).toBe(0.35);
    expect(must(index.byId("el-2")).opacity).toBe(1);
    expect(must(index.byId("el-3")).opacity).toBe(1);
    expect(must(index.byId("el-4")).opacity).toBe(1);
    expect(must(index.byId("el-5")).opacity).toBe(0);
  });

  it("reads a pixel font size and gives null for anything else", () => {
    const index = buildIndex(
      sample([
        raw("el-1", { fontSize: "20px" }),
        raw("el-2", { fontSize: "1.5em" }),
        raw("el-3", { fontSize: "px" }),
        raw("el-4", { fontSize: `${"9".repeat(40)}px` }),
      ]),
      false
    );
    expect(must(index.byId("el-1")).fontSizePx).toBe(20);
    expect(must(index.byId("el-2")).fontSizePx).toBeNull();
    expect(must(index.byId("el-3")).fontSizePx).toBeNull();
    expect(must(index.byId("el-4")).fontSizePx).toBeNull();
  });
});

describe("budgets and capture flags", () => {
  it("considers at most 1,500 elements and sets budgetHit above that", () => {
    const many = Array.from({ length: MAX_ELEMENTS_CONSIDERED + 1 }, (_v, i) =>
      raw(`el-1-${i}`)
    );
    const index = buildIndex(sample(many), false);
    expect(index.elements.length).toBe(MAX_ELEMENTS_CONSIDERED);
    expect(index.budgetHit).toBe(true);
    const exact = buildIndex(sample(many.slice(0, MAX_ELEMENTS_CONSIDERED)), false);
    expect(exact.elements.length).toBe(MAX_ELEMENTS_CONSIDERED);
    expect(exact.budgetHit).toBe(false);
  });

  it("considers at most 750 elements of a reload sample", () => {
    const many = Array.from(
      { length: MAX_RELOAD_ELEMENTS_CONSIDERED + 1 },
      (_v, i) => raw(`el-1-${i}`)
    );
    const index = buildIndex(sample(many), true);
    expect(index.elements.length).toBe(MAX_RELOAD_ELEMENTS_CONSIDERED);
    expect(index.budgetHit).toBe(true);
  });

  it("takes the first elements of the array, not a sorted selection", () => {
    const many = Array.from({ length: MAX_ELEMENTS_CONSIDERED + 5 }, (_v, i) =>
      raw(`el-${MAX_ELEMENTS_CONSIDERED + 5 - i}`)
    );
    const index = buildIndex(sample(many), false);
    expect(index.byId(`el-${MAX_ELEMENTS_CONSIDERED + 5}`)).toBeDefined();
    expect(index.byId("el-1")).toBeUndefined();
  });

  it("copies capture.elementsTruncated into captureTruncated", () => {
    const yes = buildIndex(sample([raw("el-1")], { capture: { elementsTruncated: true } }), false);
    const no = buildIndex(sample([raw("el-1")], { capture: { elementsTruncated: false } }), false);
    const odd = buildIndex(sample([raw("el-1")], { capture: { elementsTruncated: "true" } }), false);
    const none = buildIndex(sample([raw("el-1")]), false);
    expect(yes.captureTruncated).toBe(true);
    expect(no.captureTruncated).toBe(false);
    expect(odd.captureTruncated).toBe(false);
    expect(none.captureTruncated).toBe(false);
  });

  it("finishes quickly on 10,000 hostile elements", () => {
    const many = Array.from({ length: 10_000 }, (_v, i) =>
      raw(`el-1-${i}`, { text: "only ".repeat(1000), color: "x".repeat(10_000) })
    );
    const started = performance.now();
    const index = buildIndex(sample(many), false);
    expect(index.elements.length).toBe(MAX_ELEMENTS_CONSIDERED);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
