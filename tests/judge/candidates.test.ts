import { describe, it, expect } from "vitest";
import {
  normaliseCandidateText,
  prepareCandidates,
} from "@/lib/judge/candidates";
import type { PreparedCandidate } from "@/lib/judge/candidates";
import {
  makeInput,
  makeSnapshot,
  makeText,
} from "@/tests/judge/helpers/snapshot";
import type { ElementInput } from "@/tests/judge/helpers/snapshot";

function build(elements: readonly ElementInput[]): PreparedCandidate[] {
  return prepareCandidates(makeSnapshot(elements)).candidates;
}

function texts(elements: readonly ElementInput[]): string[] {
  return build(elements).map((c) => c.text);
}

function byFirstId(
  candidates: readonly PreparedCandidate[],
  id: string,
): PreparedCandidate {
  const found = candidates.find((c) => c.elementIds[0] === id);
  if (!found) throw new Error(`no candidate with first id ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// 5.1 first sample only
// ---------------------------------------------------------------------------

describe("5.1 only the first sample is read", () => {
  it("ignores afterReload and secondSample", () => {
    const other = makeSnapshot([makeText("el-9", "p", "Reload only text")]);
    const snapshot = makeSnapshot([makeText("el-0", "p", "First sample text")], {
      afterReload: other,
      secondSample: other,
    });
    const { candidates } = prepareCandidates(snapshot);
    expect(candidates.map((c) => c.text)).toEqual(["First sample text"]);
  });
});

// ---------------------------------------------------------------------------
// 5.2 visibility
// ---------------------------------------------------------------------------

describe("5.2 visibility rules", () => {
  it("drops visibility hidden", () => {
    expect(
      texts([makeText("el-0", "p", "Hidden text", { visibility: "hidden" })]),
    ).toEqual([]);
  });

  it("drops display none", () => {
    expect(
      texts([makeText("el-0", "p", "Hidden text", { display: "none" })]),
    ).toEqual([]);
  });

  it("drops opacity 0 and keeps a faint element", () => {
    expect(
      texts([
        makeText("el-0", "p", "Invisible text", { opacity: "0" }),
        makeText("el-1", "p", "Faint text", { opacity: "0.3" }),
      ]),
    ).toEqual(["Faint text"]);
  });

  it("drops a non-control with a zero width or a zero height", () => {
    const zero = { x: 0, y: 0, width: 0, height: 20 };
    const flat = { x: 0, y: 0, width: 100, height: 0 };
    expect(
      texts([
        makeText("el-0", "p", "Zero width", { boundingBox: zero }),
        makeText("el-1", "p", "Zero height", { boundingBox: flat }),
      ]),
    ).toEqual([]);
  });

  it("keeps a control with a zero box", () => {
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      texts([
        makeText("el-0", "button", "Accept", { boundingBox: zero }),
        makeText("el-1", "a", "Skip it", { boundingBox: zero }),
        { ...makeInput("el-2", "checkbox"), boundingBox: zero },
      ]),
    ).toEqual(["Accept", "Skip it", ""]);
  });

  it("drops an element under an ancestor that is not displayed", () => {
    expect(
      texts([
        makeText("el-0", "div", "Parent text", { display: "none" }),
        makeText("el-0-0", "span", "Child text"),
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5.3 and 5.4 eligibility
// ---------------------------------------------------------------------------

describe("5.3 eligibility", () => {
  it("needs trimmed text of at least 2 characters", () => {
    expect(
      texts([
        makeText("el-0", "p", "x"),
        makeText("el-1", "p", "   "),
        makeText("el-2", "p", " ab "),
        makeText("el-3", "p", "\u200b\u200b"),
        { id: "el-4", tag: "p" },
      ]),
    ).toEqual(["ab"]);
  });

  it("keeps a checkbox or radio without text", () => {
    const found = build([
      makeInput("el-0", "checkbox", { checked: true }),
      makeInput("el-1", "radio"),
    ]);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ control: "checkbox", checked: true, text: "" });
    expect(found[1]).toMatchObject({ control: "radio", checked: false });
  });

  it("does not take any other input type", () => {
    expect(
      build([
        {
          id: "el-0",
          tag: "input",
          attributes: { type: "text" },
        },
      ]),
    ).toEqual([]);
  });

  it("keeps a selected option and drops an unselected option without text", () => {
    const found = build([
      makeText("el-0", "option", "x", { selected: true }),
      makeText("el-1", "option", "y"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      elementIds: ["el-0"],
      control: "option",
      checked: true,
      text: "x",
    });
  });

  it("keeps an unselected option that has text", () => {
    const found = build([makeText("el-0", "option", "Large")]);
    expect(found).toHaveLength(1);
    expect(found[0].control).toBeUndefined();
  });
});

describe("5.4 outsideImage", () => {
  it("keeps an element that lies outside the image", () => {
    const found = build([
      makeText("el-0", "p", "Far below the fold", { outsideImage: true }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].outsideImage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5.5 and 5.6 normalisation
// ---------------------------------------------------------------------------

describe("5.5 normaliseCandidateText", () => {
  it("applies NFKC", () => {
    expect(normaliseCandidateText("ＳＡＬＥ ﬁnal").text).toBe("SALE final");
  });

  it("removes each listed character range", () => {
    const ranges: Array<[number, number]> = [
      [0x0000, 0x0008],
      [0x000e, 0x001f],
      [0x007f, 0x009f],
      [0x200b, 0x200f],
      [0x202a, 0x202e],
      [0x2060, 0x2069],
      [0xfeff, 0xfeff],
    ];
    for (const [first, last] of ranges) {
      for (let code = first; code <= last; code += 1) {
        const ch = String.fromCodePoint(code);
        expect(normaliseCandidateText(`a${ch}b`).text, `U+${code.toString(16)}`).toBe(
          "ab",
        );
      }
    }
  });

  it("treats a tab and a line break as whitespace, not as a removed character", () => {
    expect(normaliseCandidateText("Only 3\nleft\tnow").text).toBe(
      "Only 3 left now",
    );
  });

  it("collapses runs of whitespace and trims", () => {
    expect(normaliseCandidateText("  a   b \u00a0 c  ").text).toBe("a b c");
  });

  it("returns cut false for short text", () => {
    expect(normaliseCandidateText("short")).toEqual({ text: "short", cut: false });
  });
});

describe("5.6 the 200-character cut", () => {
  it("keeps 200 characters as they are", () => {
    const text = "a".repeat(200);
    expect(normaliseCandidateText(text)).toEqual({ text, cut: false });
  });

  it("cuts 201 characters to 200 and marks the cut", () => {
    const result = normaliseCandidateText("a".repeat(250));
    expect(result.text).toBe("a".repeat(200));
    expect(result.cut).toBe(true);
  });

  it("does not split a surrogate pair at the boundary", () => {
    const result = normaliseCandidateText(`${"a".repeat(199)}😀tail`);
    expect(result.cut).toBe(true);
    expect(result.text).toBe("a".repeat(199));
    expect(result.text.length).toBe(199);
  });

  it("keeps a whole pair that ends exactly at 200", () => {
    const result = normaliseCandidateText(`${"a".repeat(198)}😀tail`);
    expect(result.text).toBe(`${"a".repeat(198)}😀`);
    expect(result.text.length).toBe(200);
    expect(result.cut).toBe(true);
  });

  it("marks the candidate cut in the prepared list", () => {
    const found = build([makeText("el-0", "p", "b".repeat(260))]);
    expect(found[0].text).toBe("b".repeat(200));
    expect(found[0].cut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Redaction in the candidate text (4.7)
// ---------------------------------------------------------------------------

describe("4.7 redaction of candidate text", () => {
  it("replaces personal data inside the text", () => {
    expect(
      texts([makeText("el-0", "p", "Questions? Write to help@shop.example today")]),
    ).toEqual(["Questions? Write to [email] today"]);
  });

  it("drops a candidate that is mostly placeholders", () => {
    expect(
      texts([
        makeText("el-0", "p", "0532 123 45 67"),
        makeText("el-1", "p", "Mail: help@shop.example"),
        makeText("el-2", "p", "Only 3 left at 12:45 for $24.99"),
      ]),
    ).toEqual(["Only 3 left at 12:45 for $24.99"]);
  });
});

// ---------------------------------------------------------------------------
// 6.1 to 6.3 role containers
// ---------------------------------------------------------------------------

function dialogWith(childLength: number): ElementInput[] {
  return [
    makeText("el-0", "div", "x".repeat(100), { role: "dialog" }),
    makeText("el-0-0", "button", "y".repeat(40)),
    makeText("el-0-1", "button", "z".repeat(childLength)),
  ];
}

describe("6.1 to 6.3 role containers", () => {
  it("does not send a dialog whose descendants cover 80 percent", () => {
    const found = build(dialogWith(40));
    expect(found.map((c) => c.elementIds[0])).toEqual(["el-0-0", "el-0-1"]);
  });

  it("sends a dialog whose descendants cover 79 percent", () => {
    const found = build(dialogWith(39));
    expect(found.map((c) => c.elementIds[0])).toEqual(["el-0", "el-0-0", "el-0-1"]);
    expect(found[0].place).toBe("dialog");
  });

  it("still gives the skipped container's place and group to its descendants", () => {
    const found = build(dialogWith(40));
    expect(found.map((c) => c.place)).toEqual(["dialog", "dialog"]);
    expect(found[0].group).toBe("g1");
    expect(found[1].group).toBe("g1");
  });

  it("caps the covered text at the container's length", () => {
    const found = build([
      makeText("el-0", "div", "x".repeat(50), { role: "dialog" }),
      makeText("el-0-0", "div", "y".repeat(50)),
      makeText("el-0-0-0", "span", "z".repeat(50)),
    ]);
    expect(found.map((c) => c.elementIds[0])).toEqual(["el-0-0", "el-0-0-0"]);
  });

  it("sends a role element that has no captured descendants", () => {
    const found = build([
      makeText("el-0", "div", "Added to your basket", { role: "status" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ place: "toast", role: "status" });
  });

  it("sends a role element whose descendants hold no text", () => {
    const found = build([
      makeText("el-0", "div", "Sale ends soon", { role: "group" }),
      makeText("el-0-0", "span", ""),
    ]);
    expect(found.map((c) => c.elementIds[0])).toEqual(["el-0"]);
  });
});

// ---------------------------------------------------------------------------
// 6.4 labels
// ---------------------------------------------------------------------------

describe("6.4 labels", () => {
  it("merges a wrapping label into its input, input id first", () => {
    const found = build([
      makeText("el-0", "label", "Add gift wrap"),
      makeInput("el-0-0", "checkbox", { checked: true }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      elementIds: ["el-0-0", "el-0"],
      text: "Add gift wrap",
      control: "checkbox",
      checked: true,
      tag: "input",
    });
  });

  it("merges the next sibling label", () => {
    const found = build([
      makeText("el-1", "div", ""),
      makeInput("el-1-0", "radio"),
      makeText("el-1-1", "label", "Express delivery"),
      makeText("el-1-2", "span", "Other text"),
    ]);
    expect(found.map((c) => c.elementIds)).toEqual([
      ["el-1-0", "el-1-1"],
      ["el-1-2"],
    ]);
    expect(found[0].text).toBe("Express delivery");
  });

  it("does not take a sibling that is not a label", () => {
    const found = build([
      makeInput("el-0", "checkbox"),
      makeText("el-1", "span", "Not a label"),
    ]);
    expect(found.map((c) => c.elementIds)).toEqual([["el-0"], ["el-1"]]);
    expect(found[0].text).toBe("");
  });

  it("prefers the wrapping label over a next sibling label", () => {
    const found = build([
      makeText("el-0", "div", ""),
      makeText("el-0-0", "label", "Wrapping"),
      makeInput("el-0-0-0", "checkbox"),
      makeText("el-0-0-1", "label", "Sibling"),
    ]);
    const input = byFirstId(found, "el-0-0-0");
    expect(input.text).toBe("Wrapping");
    expect(input.elementIds).toEqual(["el-0-0-0", "el-0-0"]);
  });

  it("does not use the text of a label that is not displayed", () => {
    const found = build([
      makeInput("el-0", "checkbox"),
      makeText("el-1", "label", "Hidden label", { display: "none" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 6.5 radio groups
// ---------------------------------------------------------------------------

describe("6.5 radio groups", () => {
  const radios: ElementInput[] = [
    makeInput("el-0", "radio", { name: "zq-shipping-choice" }),
    makeText("el-1", "label", "Standard"),
    makeInput("el-2", "radio", { name: "zq-shipping-choice" }),
    makeText("el-3", "label", "Express"),
    makeInput("el-4", "radio", { name: "zq-other-choice" }),
    makeText("el-5", "label", "Alone"),
  ];

  it("groups radios that share a name", () => {
    const found = build(radios);
    expect(found.map((c) => c.group)).toEqual(["g1", "g1", undefined]);
  });

  it("never puts the name value in the output", () => {
    const serialised = JSON.stringify(build(radios));
    expect(serialised).not.toContain("zq-shipping-choice");
    expect(serialised).not.toContain("zq-other-choice");
  });

  it("gives radios no facts", () => {
    for (const c of build(radios)) expect(c.facts).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6.6 and 6.7 button and link groups
// ---------------------------------------------------------------------------

describe("6.6 button and link groups", () => {
  it("groups a button and a link under one container", () => {
    const found = build([
      makeText("el-0", "div", ""),
      makeText("el-0-0", "button", "Accept all"),
      makeText("el-0-1", "a", "No thanks"),
    ]);
    expect(found.map((c) => c.group)).toEqual(["g1", "g1"]);
  });

  it("groups members that are 3 levels below their shared ancestor", () => {
    const found = build([
      makeText("el-0-0-0-0", "button", "Accept all"),
      makeText("el-0-1-0-0", "button", "Reject all"),
    ]);
    expect(found.map((c) => c.group)).toEqual(["g1", "g1"]);
  });

  it("does not group members that are 4 levels below their shared ancestor", () => {
    const found = build([
      makeText("el-0-0-0-0-0", "button", "Accept all"),
      makeText("el-0-1-0-0-0", "button", "Reject all"),
    ]);
    expect(found.map((c) => c.group)).toEqual([undefined, undefined]);
  });

  it("recognises submit inputs and role button as buttons", () => {
    const found = build([
      {
        id: "el-0-0",
        tag: "input",
        text: "Subscribe",
        attributes: { type: "submit" },
      },
      makeText("el-0-1", "div", "Not now", { role: "button" }),
    ]);
    expect(found.map((c) => c.group)).toEqual(["g1", "g1"]);
  });

  it("does not group a single button", () => {
    expect(build([makeText("el-0", "button", "Buy now")])[0].group).toBeUndefined();
  });

  it("does not group a plain paragraph with a button", () => {
    const found = build([
      makeText("el-0-0", "p", "Hello there"),
      makeText("el-0-1", "button", "Buy now"),
    ]);
    expect(found.map((c) => c.group)).toEqual([undefined, undefined]);
  });
});

describe("6.7 group keys", () => {
  it("numbers groups in document order of their first member", () => {
    const found = build([
      makeText("el-0-0-0-0", "button", "Alpha one"),
      makeInput("el-1", "radio", { name: "a" }),
      makeInput("el-2", "radio", { name: "a" }),
      makeText("el-3-0-0-0", "button", "Beta one"),
      makeText("el-3-0-0-1", "button", "Beta two"),
      makeText("el-0-0-0-1", "button", "Alpha two"),
    ]);
    const groups = new Map(found.map((c) => [c.elementIds[0], c.group]));
    expect(groups.get("el-0-0-0-0")).toBe("g1");
    expect(groups.get("el-0-0-0-1")).toBe("g1");
    expect(groups.get("el-1")).toBe("g2");
    expect(groups.get("el-2")).toBe("g2");
    expect(groups.get("el-3-0-0-0")).toBe("g3");
    expect(groups.get("el-3-0-0-1")).toBe("g3");
  });
});

// ---------------------------------------------------------------------------
// 6.8 to 6.10 place
// ---------------------------------------------------------------------------

describe("6.8 to 6.10 place", () => {
  it("is dialog for the element and for its descendants", () => {
    const found = build([
      makeText("el-0", "div", "Short note", { role: "alertdialog" }),
      makeText("el-1", "div", "", { role: "dialog" }),
      makeText("el-1-0", "p", "Inside a dialog"),
    ]);
    expect(found.map((c) => c.place)).toEqual(["dialog", "dialog"]);
  });

  it("is toast for role status and role alert", () => {
    const found = build([
      makeText("el-0", "div", "Saved", { role: "status" }),
      makeText("el-1", "div", "Problem", { role: "alert" }),
    ]);
    expect(found.map((c) => c.place)).toEqual(["toast", "toast"]);
  });

  it("is toast for fixed or sticky text of 160 characters, main for 161", () => {
    const found = build([
      makeText("el-0", "div", "a".repeat(160), { position: "fixed" }),
      makeText("el-1", "div", "b".repeat(161), { position: "fixed" }),
      makeText("el-2", "div", "c".repeat(160), { position: "sticky" }),
      makeText("el-3", "div", "d".repeat(161), { position: "sticky" }),
    ]);
    expect(found.map((c) => c.place)).toEqual(["toast", "main", "toast", "main"]);
  });

  it("is dialog and not toast for a fixed element inside a dialog", () => {
    const found = build([
      makeText("el-0", "div", "", { role: "dialog" }),
      makeText("el-0-0", "p", "Fixed in dialog", { position: "fixed" }),
    ]);
    expect(found[0].place).toBe("dialog");
  });

  it("is main otherwise", () => {
    expect(build([makeText("el-0", "p", "Plain text")])[0].place).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// 6.11 to 6.13 facts
// ---------------------------------------------------------------------------

describe("6.11 to 6.13 facts", () => {
  const whitePage: ElementInput = makeText("el-0", "div", "", {
    backgroundColor: "rgb(255, 255, 255)",
  });

  it("gives group members contrast, areaRatio, fontPx and disabled", () => {
    const found = build([
      whitePage,
      makeText("el-0-0", "button", "Accept all", {
        color: "rgb(0, 0, 0)",
        fontSize: "18px",
        boundingBox: { x: 0, y: 0, width: 200, height: 45 },
      }),
      makeText("el-0-1", "a", "No thanks", {
        color: "rgb(119, 119, 119)",
        fontSize: "11px",
        attributes: { disabled: "" },
        boundingBox: { x: 0, y: 0, width: 100, height: 30 },
      }),
    ]);
    expect(found[0].facts).toEqual({
      contrast: 21,
      areaRatio: 1,
      fontPx: 18,
      disabled: false,
    });
    expect(found[1].facts).toEqual({
      contrast: 4.5,
      areaRatio: 0.33,
      fontPx: 11,
      disabled: true,
    });
  });

  it("measures the area against the largest member, not the first", () => {
    const found = build([
      whitePage,
      makeText("el-0-0", "button", "Small", {
        boundingBox: { x: 0, y: 0, width: 50, height: 20 },
      }),
      makeText("el-0-1", "button", "Large", {
        boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      }),
    ]);
    expect(found.map((c) => c.facts?.areaRatio)).toEqual([0.25, 1]);
  });

  it("omits contrast when the background is assumed", () => {
    const found = build([
      makeText("el-0", "div", ""),
      makeText("el-0-0", "button", "Accept all"),
      makeText("el-0-1", "button", "Reject all"),
    ]);
    for (const c of found) {
      expect(c.facts).toBeDefined();
      expect("contrast" in (c.facts ?? {})).toBe(false);
    }
  });

  it("gives no facts to a candidate outside a group", () => {
    const found = build([whitePage, makeText("el-0-0", "button", "Alone")]);
    expect(found[0].facts).toBeUndefined();
  });

  it("keeps the contrast of group members inside a dialog", () => {
    const found = build([
      makeText("el-0", "div", "", {
        role: "dialog",
        backgroundColor: "rgb(255, 255, 255)",
      }),
      makeText("el-0-0", "button", "Yes please"),
      makeText("el-0-1", "button", "No"),
    ]);
    expect(found.map((c) => c.place)).toEqual(["dialog", "dialog"]);
    expect(found.every((c) => typeof c.facts?.contrast === "number")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("document order and bookkeeping", () => {
  it("returns candidates in document order with their order index", () => {
    const found = build([
      makeText("el-2", "p", "Third"),
      makeText("el-0", "p", "First"),
      makeText("el-1", "p", "Second"),
    ]);
    expect(found.map((c) => c.text)).toEqual(["First", "Second", "Third"]);
    const orders = found.map((c) => c.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("keeps the raw text for the split-text step", () => {
    const found = build([makeText("el-0", "p", "Only  3 left")]);
    expect(found[0].rawText).toBe("Only  3 left");
    expect(found[0].text).toBe("Only 3 left");
  });
});
