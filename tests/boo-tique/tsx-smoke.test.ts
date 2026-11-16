import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Smoke, SMOKE_TEXT } from "@/components/boo-tique/smoke";

describe("TSX smoke test", () => {
  it("imports, renders and asserts a .tsx component under Vitest", () => {
    const markup = renderToStaticMarkup(createElement(Smoke));
    expect(markup).toBe(`<p>${SMOKE_TEXT}</p>`);
  });
});
