import { describe, it, expect } from "vitest";
import { buildIndex } from "@/lib/detectors/shared/elements";
import type { ElementIndex } from "@/lib/detectors/shared/elements";
import { findLabel } from "@/lib/detectors/shared/labels";

type Raw = Record<string, unknown>;

function raw(id: string, tag: string, text: string, over: Raw = {}): Raw {
  return {
    id,
    tag,
    text,
    boundingBox: { x: 0, y: 0, width: 100, height: 20 },
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

function indexOf(elements: Raw[]): ElementIndex {
  return buildIndex(
    {
      url: "https://shop.example/",
      capturedAt: "2026-12-01T12:00:00.000Z",
      viewportWidth: 1280,
      viewportHeight: 800,
      fullWidth: 1280,
      fullHeight: 2000,
      elements,
    },
    false
  );
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function labelOf(elements: Raw[], controlId: string) {
  const index = indexOf(elements);
  return findLabel(index, must(index.byId(controlId)));
}

const checkbox = (id: string, over: Raw = {}): Raw =>
  raw(id, "input", "", { checked: true, attributes: { type: "checkbox" }, ...over });

const switchButton = (id: string, over: Raw = {}): Raw =>
  raw(id, "button", "", { role: "switch", attributes: { "aria-checked": "true" }, ...over });

describe("findLabel: direct steps", () => {
  it("uses a label ancestor and its text", () => {
    const match = labelOf(
      [raw("el-1-0", "label", "Add protection +$4.99"), checkbox("el-1-0-0")],
      "el-1-0-0"
    );
    expect(must(match).how).toBe("label");
    expect(must(match).text).toBe("Add protection +$4.99");
    expect(must(must(match).element).id).toBe("el-1-0");
    expect(must(match).tokens.map((t) => t.norm)).toContain("protection");
  });

  it("takes the nearest label ancestor within three levels", () => {
    const match = labelOf(
      [
        raw("el-1", "label", "Outer label"),
        raw("el-1-0-0", "label", "Inner label"),
        checkbox("el-1-0-0-0"),
      ],
      "el-1-0-0-0"
    );
    expect(must(match).text).toBe("Inner label");
  });

  it("uses a label that is three levels up but not one that is four levels up", () => {
    const near = labelOf(
      [raw("el-1", "label", "Three up"), checkbox("el-1-0-0-0")],
      "el-1-0-0-0"
    );
    expect(must(near).how).toBe("label");
    const far = labelOf(
      [raw("el-1", "label", "Four up"), checkbox("el-1-0-0-0-0")],
      "el-1-0-0-0-0"
    );
    expect(far).toBeNull();
  });

  it("ignores a label ancestor without text and goes on", () => {
    const match = labelOf(
      [
        raw("el-1", "label", ""),
        checkbox("el-1-0", { attributes: { type: "checkbox", "aria-label": "Gift wrap" } }),
      ],
      "el-1-0"
    );
    expect(must(match).how).toBe("aria");
    expect(must(match).text).toBe("Gift wrap");
  });

  it("uses the control's own text", () => {
    const match = labelOf(
      [switchButton("el-1-0", { text: "Remember me" })],
      "el-1-0"
    );
    expect(must(match).how).toBe("own");
    expect(must(match).text).toBe("Remember me");
    expect(must(match).element?.id).toBe("el-1-0");
  });

  it("uses aria-label when there is no label and no own text", () => {
    const match = labelOf(
      [checkbox("el-1-0", { attributes: { type: "checkbox", "aria-label": "Newsletter" } })],
      "el-1-0"
    );
    expect(must(match).how).toBe("aria");
    expect(must(match).text).toBe("Newsletter");
    expect(must(match).element).toBeNull();
  });

  it("prefers a label ancestor over own text and aria-label", () => {
    const match = labelOf(
      [
        raw("el-1", "label", "From the label"),
        switchButton("el-1-0", {
          text: "Own",
          attributes: { "aria-label": "From aria" },
        }),
      ],
      "el-1-0"
    );
    expect(must(match).how).toBe("label");
  });

  it("prefers own text over aria-label", () => {
    const match = labelOf(
      [switchButton("el-1-0", { text: "Own", attributes: { "aria-label": "From aria" } })],
      "el-1-0"
    );
    expect(must(match).how).toBe("own");
  });
});

describe("findLabel: container steps", () => {
  it("labels a switch from the text of its parent container when it is the sole control", () => {
    // A cart row: a span with the label and a role="switch" button under one parent.
    const match = labelOf(
      [
        raw("el-1-0", "div", ""),
        raw("el-1-0-0", "span", "Gift packaging"),
        switchButton("el-1-0-1"),
      ],
      "el-1-0-1"
    );
    expect(must(match).how).toBe("sole");
    expect(must(match).text).toBe("Gift packaging");
    expect(must(match).element?.id).toBe("el-1-0-0");
  });

  it("joins the text elements of a sole container in document order", () => {
    const match = labelOf(
      [
        raw("el-1-0", "div", ""),
        raw("el-1-0-0", "span", "Express"),
        switchButton("el-1-0-1"),
        raw("el-1-0-2", "span", "shipping"),
      ],
      "el-1-0-1"
    );
    expect(must(match).how).toBe("sole");
    expect(must(match).text).toBe("Express shipping");
  });

  it("does not repeat text that a container already holds in full", () => {
    const match = labelOf(
      [
        raw("el-1-0", "div", "Gift wrap", { role: "group" }),
        raw("el-1-0-0", "span", "Gift wrap"),
        switchButton("el-1-0-1"),
      ],
      "el-1-0-1"
    );
    expect(must(match).how).toBe("sole");
    expect(must(match).text).toBe("Gift wrap");
  });

  it("ignores hidden text and text inside the control itself", () => {
    const match = labelOf(
      [
        raw("el-1-0", "div", ""),
        raw("el-1-0-0", "span", "Hidden words", { display: "none" }),
        raw("el-1-0-1", "span", "Visible words"),
        switchButton("el-1-0-2"),
        raw("el-1-0-2-0", "span", "On"),
      ],
      "el-1-0-2"
    );
    expect(must(match).how).toBe("sole");
    expect(must(match).text).toBe("Visible words");
  });

  it("falls to nearby when the container holds two controls, and lowers trust via how", () => {
    const elements = [
      raw("el-1-0", "div", ""),
      raw("el-1-0-0", "span", "Express"),
      switchButton("el-1-0-1"),
      switchButton("el-1-0-2"),
    ];
    const match = labelOf(elements, "el-1-0-1");
    expect(must(match).how).toBe("nearby");
    expect(must(match).text).toBe("Express");
    expect(must(match).element?.id).toBe("el-1-0-0");
  });

  it("takes the nearest text element before or after the control", () => {
    const elements = [
      raw("el-1-0", "div", ""),
      switchButton("el-1-0-0"),
      raw("el-1-0-1", "span", "Right after"),
      raw("el-1-0-2", "span", "Further"),
      switchButton("el-1-0-3"),
    ];
    expect(must(labelOf(elements, "el-1-0-0")).text).toBe("Right after");
    const second = labelOf(elements, "el-1-0-3");
    expect(must(second).how).toBe("nearby");
    expect(must(second).text).toBe("Further");
  });

  it("looks one level higher for a nearby text when the container has none", () => {
    const match = labelOf(
      [
        raw("el-1", "div", ""),
        raw("el-1-0", "div", ""),
        checkbox("el-1-0-0"),
        checkbox("el-1-0-1"),
        raw("el-1-1", "span", "Send me offers"),
      ],
      "el-1-0-0"
    );
    expect(must(match).how).toBe("nearby");
    expect(must(match).text).toBe("Send me offers");
  });

  it("does not look two levels higher", () => {
    const match = labelOf(
      [
        raw("el-1-0-0", "div", ""),
        checkbox("el-1-0-0-0"),
        checkbox("el-1-0-0-1"),
        raw("el-1-1", "span", "Too far away"),
      ],
      "el-1-0-0-0"
    );
    expect(match).toBeNull();
  });

  it("gives null when nothing is found", () => {
    expect(labelOf([checkbox("el-1-0")], "el-1-0")).toBeNull();
    expect(
      labelOf([raw("el-1", "div", ""), checkbox("el-1-0"), raw("el-2", "span", "Elsewhere")], "el-1-0")
    ).toBeNull();
  });

  it("does not search the whole page from a control that sits directly under the root", () => {
    const match = labelOf(
      [raw("el-1", "span", "Text on the page"), checkbox("el-5"), raw("el-7", "span", "More text")],
      "el-5"
    );
    expect(match).toBeNull();
  });

  it("gives null for a control with an invalid id and no own label", () => {
    expect(
      labelOf([raw("el-1", "span", "Some text"), checkbox("odd-id")], "odd-id")
    ).toBeNull();
  });

  it("still uses own text and aria-label for a control with an invalid id", () => {
    expect(
      must(labelOf([switchButton("odd", { text: "Own text" })], "odd")).how
    ).toBe("own");
  });

  it("does not use a control as a label for another control", () => {
    const match = labelOf(
      [
        raw("el-1-0", "div", ""),
        raw("el-1-0-0", "button", "Buy now"),
        checkbox("el-1-0-1"),
      ],
      "el-1-0-1"
    );
    // The button is another control, so the container is not "sole" and the button is no text element.
    expect(match).toBeNull();
  });

  it("does not use hidden text as a nearby label", () => {
    const match = labelOf(
      [
        raw("el-1-0", "div", ""),
        raw("el-1-0-0", "span", "Ghost text", { visibility: "hidden" }),
        checkbox("el-1-0-1"),
        checkbox("el-1-0-2"),
      ],
      "el-1-0-1"
    );
    expect(match).toBeNull();
  });

  it("bounds the work on a flat page of 1,500 text elements", () => {
    const elements: Raw[] = [raw("el-1", "div", "")];
    for (let i = 0; i < 1498; i += 1) elements.push(raw(`el-1-${i}`, "span", `Line ${i}`));
    elements.push(checkbox("el-1-1498"));
    const started = performance.now();
    const match = labelOf(elements, "el-1-1498");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(must(match).how).toBe("sole");
    expect(must(match).text.length).toBeLessThanOrEqual(300);
  });
});
