// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLECT_LIMITS,
  MAX_ATTRS_PER_ELEMENT,
  MAX_ATTR_NAME_CHARS,
  MAX_PATH_DEPTH,
  MAX_ROLE_CHARS,
  MAX_STYLE_CHARS,
  MAX_TAG_CHARS,
} from "@/lib/capture/constants";
import { buildSample, collectInPage } from "@/lib/capture/extractor";
import type { CollectOptions, RawCollection, RawElement, RawPageRead } from "@/lib/capture/types";
import { TEST_ID_ATTRIBUTE } from "./helpers/forbidden-attribute";

/**
 * These tests run the real `collectInPage` against DOM built in jsdom.
 *
 * What jsdom cannot do: it has no layout, so `getBoundingClientRect` returns zeros and
 * every test stubs the rectangles it needs. It has no `innerText`, so the collector's
 * `textContent` fallback runs here (in a browser `innerText` skips hidden text). It has
 * no isolated world, so these tests cannot show that page scripts are shut out.
 */

type Rect = { left: number; top: number; width: number; height: number };

const ZERO: Rect = { left: 0, top: 0, width: 0, height: 0 };
const BOX: Rect = { left: 10, top: 20, width: 100, height: 30 };

const OPTIONS: CollectOptions = {
  maxElements: 1_500,
  maxTextChars: 300,
  maxAttrChars: 200,
  attributeNames: "full",
  limits: COLLECT_LIMITS,
};

/** Rectangles chosen by the test. An element that is not in the map gets `fallback`. */
const rects = new Map<Element, Rect>();
let fallback: Rect = ZERO;

function collect(overrides: Partial<CollectOptions> = {}): RawCollection {
  return collectInPage({ ...OPTIONS, ...overrides });
}

function byTag(result: RawCollection, tag: string): RawElement {
  const found = result.elements.find((element) => element.tag === tag);
  if (!found) throw new Error(`no collected element with the tag ${tag}`);
  return found;
}

function toPage(collection: RawCollection): RawPageRead {
  return {
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    scrollWidth: 1280,
    scrollHeight: 5_000,
    ...collection,
  };
}

beforeEach(() => {
  rects.clear();
  fallback = ZERO;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const r = rects.get(this) ?? fallback;
    return {
      ...r,
      x: r.left,
      y: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectInPage on a real DOM: what is collected", () => {
  it("returns the pixel ratio, the eligible count and the elements, and no other metric", () => {
    fallback = BOX;
    document.body.innerHTML = "<p>Hello</p>";
    const result = collect();
    expect(Object.keys(result).sort()).toEqual(["devicePixelRatio", "elements", "eligibleCount"]);
    expect(result.devicePixelRatio).toBe(window.devicePixelRatio);
    expect(result.eligibleCount).toBe(1);
  });

  it("skips script, style, noscript, template and head content", () => {
    fallback = BOX;
    document.head.innerHTML = "<title>Head title</title><style>.x { color: red }</style>";
    document.body.innerHTML = [
      '<script>var a = "script text";</script>',
      "<style>.y { color: blue }</style>",
      "<noscript>noscript text</noscript>",
      "<template><p>template text</p></template>",
      "<p>visible text</p>",
    ].join("");
    const result = collect();
    expect(result.elements.map((element) => element.tag)).toEqual(["p"]);
    expect(result.eligibleCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/script text|noscript text|template text|Head title/);
  });

  it("skips a non-control with a zero-size box and keeps a control without a box", () => {
    document.body.innerHTML = [
      '<div id="plain">no box</div>',
      '<input id="field" type="text">',
      '<button id="go">Go</button>',
      '<div id="flat">flat</div>',
    ].join("");
    rects.set(document.getElementById("go") as Element, BOX);
    rects.set(document.getElementById("flat") as Element, { left: 0, top: 0, width: 50, height: 0 });
    const result = collect();
    expect(result.elements.map((element) => element.tag)).toEqual(["input", "button"]);
    expect(result.eligibleCount).toBe(2);
    expect(byTag(result, "input").rect).toEqual(ZERO);
    expect(byTag(result, "button").rect).toEqual(BOX);
  });

  it("stops collecting at maxElements and still counts every eligible element", () => {
    fallback = BOX;
    document.body.innerHTML = "<p>1</p><p>2</p><p>3</p><p>4</p>";
    const result = collect({ maxElements: 2 });
    expect(result.elements).toHaveLength(2);
    expect(result.eligibleCount).toBe(4);
  });

  it("collects a selected option and not an unselected one without a box", () => {
    document.body.innerHTML = '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>';
    const result = collect();
    expect(result.elements.map((element) => [element.tag, element.selected])).toEqual([
      ["select", false],
      ["option", true],
    ]);
  });
});

describe("collectInPage on a real DOM: text", () => {
  it("reports own text for a plain element and subtree text for a control, link, label and role element", () => {
    fallback = BOX;
    document.body.innerHTML = [
      '<div id="plain">Parent <span>child text</span> tail</div>',
      '<a href="/x">Link <b>bold</b></a>',
      "<label>Label <i>italic</i></label>",
      '<span role="button">Role <em>emphasis</em></span>',
      "<button>Press <u>me</u></button>",
    ].join("");
    const result = collect();
    expect(byTag(result, "div").text).toBe("Parent tail");
    expect(result.elements.find((e) => e.tag === "span" && e.role === null)?.text).toBe("child text");
    expect(byTag(result, "a").text).toBe("Link bold");
    expect(byTag(result, "label").text).toBe("Label italic");
    expect(result.elements.find((e) => e.role === "button")?.text).toBe("Role emphasis");
    expect(byTag(result, "button").text).toBe("Press me");
  });

  it("cuts text at the cap and sets textTruncated", () => {
    fallback = BOX;
    document.body.innerHTML = `<p id="long">${"a".repeat(50)}</p><p id="short">  few   words  </p>`;
    const result = collect({ maxTextChars: 20 });
    const [long, short] = result.elements;
    expect(long?.text).toBe("a".repeat(20));
    expect(long?.textTruncated).toBe(true);
    expect(short?.text).toBe("few words");
    expect(short?.textTruncated).toBe(false);
  });
});

describe("collectInPage on a real DOM: attributes and form state", () => {
  it("reads only the allowed attributes in a full read", () => {
    fallback = BOX;
    document.body.innerHTML = [
      `<input type="checkbox" name="news" disabled value="yes" class="c" onclick="x()" aria-label="Sign up" placeholder="P" ${TEST_ID_ATTRIBUTE}="t">`,
      '<a href="/x" target="_blank" id="link">Link</a>',
      '<label for="news">Label</label>',
    ].join("");
    const result = collect();
    expect(byTag(result, "input").attrs).toEqual({
      type: "checkbox",
      name: "news",
      disabled: "",
      value: "yes",
      "aria-label": "Sign up",
      placeholder: "P",
    });
    expect(byTag(result, "a").attrs).toEqual({ href: "/x" });
    expect(byTag(result, "label").attrs).toEqual({ for: "news" });
  });

  it("reads only the names it is given in a light read, and no aria attribute", () => {
    fallback = BOX;
    document.body.innerHTML = `<input type="checkbox" name="n" disabled value="v" aria-label="x" placeholder="p" ${TEST_ID_ATTRIBUTE}="t">`;
    const result = collect({ attributeNames: ["type", "name", "disabled"] });
    expect(byTag(result, "input").attrs).toEqual({ type: "checkbox", name: "n", disabled: "" });
  });

  it("keeps value only for a button, an option and an input of a value type", () => {
    fallback = BOX;
    document.body.innerHTML = [
      '<input type="radio" value="r">',
      '<input type="submit" value="s">',
      '<input type="text" value="secret">',
      '<input type="password" value="secret">',
      "<input value=\"no type\">",
      '<button value="go">Go</button>',
      '<textarea value="typed">t</textarea>',
      '<select><option value="opt" selected>Opt</option></select>',
      '<div role="note" value="x">Div</div>',
    ].join("");
    const result = collect();
    const values = result.elements.map((element) => [element.tag, element.attrs.type ?? "", element.attrs.value ?? null]);
    expect(values).toEqual([
      ["input", "radio", "r"],
      ["input", "submit", "s"],
      ["input", "text", null],
      ["input", "password", null],
      ["input", "", null],
      ["button", "", "go"],
      ["textarea", "", null],
      ["select", "", null],
      ["option", "", "opt"],
      ["div", "", null],
    ]);
  });

  it("cuts an attribute value at maxAttrChars", () => {
    fallback = BOX;
    document.body.innerHTML = `<a href="${"h".repeat(500)}">Link</a>`;
    expect(byTag(collect({ maxAttrChars: 50 }), "a").attrs.href).toBe("h".repeat(50));
  });

  it("reports checked and selected", () => {
    fallback = BOX;
    document.body.innerHTML = [
      '<input type="checkbox" id="on" checked>',
      '<input type="checkbox" id="off">',
      '<select><option value="a">A</option><option value="b" selected>B</option></select>',
    ].join("");
    const result = collect();
    const inputs = result.elements.filter((element) => element.tag === "input");
    expect(inputs.map((element) => element.checked)).toEqual([true, false]);
    // Every box is stubbed here, so the unselected option is collected too.
    const options = result.elements.filter((element) => element.tag === "option");
    expect(options.map((element) => element.selected)).toEqual([false, true]);
    expect(inputs.every((element) => element.selected === false)).toBe(true);
  });

  it("never lets the test-id attribute through, in a full or a light read", () => {
    fallback = BOX;
    document.body.innerHTML = `<input type="text" aria-label="L" ${TEST_ID_ATTRIBUTE}="cart-insurance"><p ${TEST_ID_ATTRIBUTE}="x">Text</p>`;
    for (const options of [{}, { attributeNames: ["type", "name", "disabled"] }]) {
      const json = JSON.stringify(collect(options)).toLowerCase();
      expect(json).not.toContain(TEST_ID_ATTRIBUTE);
    }
    expect(byTag(collect(), "input").attrs).toEqual({ type: "text", "aria-label": "L" });
  });
});

describe("collectInPage on a real DOM: paths and depth", () => {
  const NESTED = "<div><p>one</p><section><p>two</p></section></div><p>three</p>";

  it("gives each element the path of its element-child indices, and the same ids in a second call", () => {
    fallback = BOX;
    document.body.innerHTML = NESTED;
    const first = collect();
    const second = collect();
    expect(first.elements.map((element) => element.path)).toEqual([[1, 0, 0], [1, 0, 1, 0], [1, 1]]);
    expect(second.elements.map((element) => element.path)).toEqual(first.elements.map((element) => element.path));
    const ids = buildSample(toPage(first), { light: false, url: "https://shop.example.com/", capturedAt: "2025-10-31T12:00:00.000Z" })
      .elements.map((element) => element.id);
    expect(ids).toEqual(["el-1-0-0", "el-1-0-1-0", "el-1-1"]);
  });

  it("keeps the index of a skipped sibling in the path", () => {
    fallback = BOX;
    document.body.innerHTML = "<script>1</script><p>after the script</p>";
    expect(collect().elements.map((element) => element.path)).toEqual([[1, 1]]);
  });

  function nest(depth: number): void {
    let parent: Element = document.body;
    for (let i = 0; i < depth; i++) {
      const div = document.createElement("div");
      div.textContent = `level ${i}`;
      // The text node comes first, so appending the child keeps the text as own text.
      parent.appendChild(div);
      parent = div;
    }
  }

  it("does not collect elements deeper than limits.maxPathDepth and still counts them as eligible", () => {
    fallback = BOX;
    nest(6);
    const result = collect({ limits: { ...COLLECT_LIMITS, maxPathDepth: 4 } });
    // body has the path [1]; the first div [1, 0] (length 2) ... the third [1, 0, 0, 0] (length 4).
    expect(result.elements.map((element) => element.path.length)).toEqual([2, 3, 4]);
    expect(result.elements.map((element) => element.text)).toEqual(["level 0", "level 1", "level 2"]);
    expect(result.eligibleCount).toBe(6);
  });

  it("applies the default depth cap to a deep document without error", () => {
    fallback = BOX;
    nest(MAX_PATH_DEPTH + 44);
    const result = collect();
    expect(result.eligibleCount).toBe(MAX_PATH_DEPTH + 44);
    expect(result.elements).toHaveLength(MAX_PATH_DEPTH - 1);
    const deepest = result.elements[result.elements.length - 1];
    expect(deepest?.path).toHaveLength(MAX_PATH_DEPTH);
  });
});

describe("collectInPage on a real DOM: hostile input", () => {
  it("does not throw and stays within the caps when slice and getComputedStyle are overridden", () => {
    fallback = BOX;
    document.body.innerHTML = `<p role="note" id="p">${"t".repeat(2_000)}</p>`;
    const hostile = "r".repeat(1_000_000);
    const style = {
      color: hostile,
      backgroundColor: hostile,
      fontSize: hostile,
      opacity: hostile,
      display: hostile,
      visibility: hostile,
      position: hostile,
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => style);
    // A page that replaced `slice` so that it never cuts anything.
    const slice = vi.spyOn(String.prototype, "slice").mockImplementation(function (this: string) {
      return String(this);
    });

    let result: RawCollection | undefined;
    let failure: unknown;
    try {
      result = collect({ maxTextChars: 100 });
    } catch (error) {
      failure = error;
    } finally {
      slice.mockRestore();
    }
    expect(failure).toBeUndefined();
    if (!result) return;

    const snapshot = buildSample(toPage(result), {
      light: false,
      url: "https://shop.example.com/",
      capturedAt: "2025-10-31T12:00:00.000Z",
    });
    expect(snapshot.elements).toHaveLength(1);
    const element = snapshot.elements[0];
    expect(element?.text?.length).toBeLessThanOrEqual(300);
    for (const key of ["color", "backgroundColor", "fontSize", "opacity", "display", "visibility", "position"] as const) {
      expect(element?.[key].length).toBeLessThanOrEqual(MAX_STYLE_CHARS);
    }
    // The collector itself already cuts what it returns.
    expect(result.elements[0]?.style.color.length).toBeLessThanOrEqual(MAX_STYLE_CHARS);
  });

  it("does not throw when getComputedStyle throws", () => {
    fallback = BOX;
    document.body.innerHTML = "<p>text</p>";
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => {
      throw new Error("hostile");
    });
    const result = collect();
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.style.color).toBe("");
  });

  it("cuts a role of 1,000,000 characters and keeps at most 32 attributes with names of at most 64", () => {
    fallback = BOX;
    const el = document.createElement("div");
    el.textContent = "hostile";
    el.setAttribute("role", "r".repeat(1_000_000));
    el.setAttribute(`aria-${"n".repeat(100)}`, "long name");
    for (let i = 0; i < 2_000; i++) el.setAttribute(`aria-a${i}`, "v");
    document.body.appendChild(el);

    const result = collect();
    const element = result.elements[0];
    expect(element?.role?.length).toBeLessThanOrEqual(MAX_ROLE_CHARS);
    const names = Object.keys(element?.attrs ?? {});
    expect(names.length).toBeLessThanOrEqual(MAX_ATTRS_PER_ELEMENT);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(MAX_ATTR_NAME_CHARS);
    expect(names.some((name) => name.includes("nnnnnnnn"))).toBe(false);
  });

  it("cuts a tag of 10,000 characters", () => {
    fallback = BOX;
    const el = document.createElement("x".repeat(10_000));
    el.textContent = "odd tag";
    document.body.appendChild(el);
    const result = collect();
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.tag).toBe("x".repeat(MAX_TAG_CHARS));
  });
});
