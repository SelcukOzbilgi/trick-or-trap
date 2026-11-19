import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hideScrollbars,
  ISOLATED_WORLD_NAME,
  readPageMetrics,
  runInIsolatedWorld,
  scrollInPage,
  type CdpSession,
} from "@/lib/capture/cdp";
import { collectInPage } from "@/lib/capture/extractor";
import { createFakeCdp, type CdpCall, type CdpScript } from "./helpers/fake-cdp";

const MAIN_FRAME_ID = "main-frame-7";

/** A script where each new isolated world gets the next context id, starting at 1. */
function worldScript(extra: CdpScript = {}): CdpScript {
  let nextContext = 1;
  return {
    "Page.getFrameTree": { frameTree: { frame: { id: MAIN_FRAME_ID } } },
    "Page.createIsolatedWorld": () => ({ executionContextId: nextContext++ }),
    "Runtime.callFunctionOn": { result: { type: "number", value: 42 } },
    ...extra,
  };
}

function paramsOf(call: CdpCall): Record<string, unknown> {
  return call.params as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runInIsolatedWorld", () => {
  const fn = (arg: { n: number }) => arg.n + 1;

  it("gets the frame tree, creates a world for the main frame, then calls the function in it", async () => {
    const cdp = createFakeCdp(worldScript());
    const result = await runInIsolatedWorld(cdp, fn, { n: 1 });

    expect(result).toBe(42);
    expect(cdp.calls.map((call) => call.method)).toEqual([
      "Page.getFrameTree",
      "Page.createIsolatedWorld",
      "Runtime.callFunctionOn",
    ]);
    expect(paramsOf(cdp.calls[1])).toEqual({ frameId: MAIN_FRAME_ID, worldName: ISOLATED_WORLD_NAME });
    expect(paramsOf(cdp.calls[2])).toEqual({
      executionContextId: 1,
      functionDeclaration: String(fn),
      arguments: [{ value: { n: 1 } }],
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it("addresses the page session, not a child target", async () => {
    const cdp = createFakeCdp(worldScript());
    await runInIsolatedWorld(cdp, fn, { n: 1 });
    expect(cdp.calls.every((call) => call.targetSessionId === undefined)).toBe(true);
  });

  it("creates a second, new world for a second call", async () => {
    const cdp = createFakeCdp(worldScript());
    await runInIsolatedWorld(cdp, fn, { n: 1 });
    await runInIsolatedWorld(cdp, fn, { n: 2 });

    expect(cdp.callsOf("Page.getFrameTree")).toHaveLength(2);
    expect(cdp.callsOf("Page.createIsolatedWorld")).toHaveLength(2);
    const calls = cdp.callsOf("Runtime.callFunctionOn").map(paramsOf);
    expect(calls.map((params) => params.executionContextId)).toEqual([1, 2]);
    expect(calls[1].arguments).toEqual([{ value: { n: 2 } }]);
  });

  it("uses the main frame id of the current frame tree, also after a navigation", async () => {
    let frameId = "frame-before";
    const cdp = createFakeCdp(
      worldScript({ "Page.getFrameTree": () => ({ frameTree: { frame: { id: frameId } } }) }),
    );
    await runInIsolatedWorld(cdp, fn, { n: 1 });
    frameId = "frame-after";
    await runInIsolatedWorld(cdp, fn, { n: 1 });
    expect(cdp.callsOf("Page.createIsolatedWorld").map((call) => paramsOf(call).frameId)).toEqual([
      "frame-before",
      "frame-after",
    ]);
  });

  it("rejects when the call reports exception details, and names the exception", async () => {
    const cdp = createFakeCdp(
      worldScript({
        "Runtime.callFunctionOn": {
          result: { type: "object" },
          exceptionDetails: { text: "Uncaught", exception: { description: "Error: collector exploded" } },
        },
      }),
    );
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow(/collector exploded/);
  });

  it("rejects with the exception text when there is no description", async () => {
    const cdp = createFakeCdp(
      worldScript({
        "Runtime.callFunctionOn": { result: {}, exceptionDetails: { text: "Uncaught SyntaxError" } },
      }),
    );
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow(/Uncaught SyntaxError/);
  });

  it("rejects when the frame tree has no main frame id", async () => {
    const cdp = createFakeCdp(worldScript({ "Page.getFrameTree": { frameTree: {} } }));
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow();
    expect(cdp.callsOf("Page.createIsolatedWorld")).toEqual([]);
  });

  it("rejects when the world has no execution context id", async () => {
    const cdp = createFakeCdp(worldScript({ "Page.createIsolatedWorld": {} }));
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow();
    expect(cdp.callsOf("Runtime.callFunctionOn")).toEqual([]);
  });

  it.each(["Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.callFunctionOn"])(
    "rejects with the error of a failing %s",
    async (method) => {
      const cdp = createFakeCdp(worldScript({ [method]: new Error(`${method} failed`) }));
      await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow(`${method} failed`);
    },
  );

  it("returns undefined when the call answers without a value", async () => {
    const cdp = createFakeCdp(worldScript({ "Runtime.callFunctionOn": { result: { type: "undefined" } } }));
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).resolves.toBeUndefined();
  });

  it("rejects on a non-object answer", async () => {
    const cdp = createFakeCdp(worldScript({ "Runtime.callFunctionOn": null }));
    await expect(runInIsolatedWorld(cdp, fn, { n: 1 })).rejects.toThrow();
  });
});

describe("hideScrollbars", () => {
  it("sends Emulation.setScrollbarsHidden with hidden true", async () => {
    const cdp = createFakeCdp();
    await hideScrollbars(cdp);
    expect(cdp.calls).toEqual([
      { method: "Emulation.setScrollbarsHidden", params: { hidden: true }, targetSessionId: undefined },
    ]);
  });

  it("rejects when the command fails", async () => {
    const cdp = createFakeCdp({ "Emulation.setScrollbarsHidden": new Error("not supported") });
    await expect(hideScrollbars(cdp)).rejects.toThrow("not supported");
  });
});

describe("readPageMetrics", () => {
  const LAYOUT_METRICS = {
    layoutViewport: { pageX: 1, pageY: 2, clientWidth: 1, clientHeight: 1 },
    cssLayoutViewport: { pageX: 12, pageY: 340, clientWidth: 1265, clientHeight: 588 },
    cssVisualViewport: { clientWidth: 1, clientHeight: 1 },
    contentSize: { x: 0, y: 0, width: 1, height: 1 },
    cssContentSize: { x: 0, y: 0, width: 1270, height: 9000 },
  };

  it("maps the CSS layout viewport and the CSS content size", async () => {
    const cdp = createFakeCdp({ "Page.getLayoutMetrics": LAYOUT_METRICS });
    const metrics = await readPageMetrics(cdp);

    expect(cdp.calls.map((call) => call.method)).toEqual(["Page.getLayoutMetrics"]);
    expect(metrics).toEqual({
      innerWidth: 1265,
      innerHeight: 588,
      layoutWidth: 1265,
      scrollX: 12,
      scrollY: 340,
      scrollWidth: 1270,
      scrollHeight: 9000,
    });
  });

  it("passes odd values through for the caller to sanitise", async () => {
    const cdp = createFakeCdp({
      "Page.getLayoutMetrics": {
        cssLayoutViewport: { pageX: "x", pageY: NaN, clientWidth: 0, clientHeight: -5 },
        cssContentSize: { width: Infinity, height: null },
      },
    });
    const metrics = await readPageMetrics(cdp);
    expect(metrics.scrollX).toBe("x");
    expect(metrics.scrollY).toBeNaN();
    expect(metrics.innerWidth).toBe(0);
    expect(metrics.innerHeight).toBe(-5);
    expect(metrics.scrollWidth).toBe(Infinity);
    expect(metrics.scrollHeight).toBeNull();
  });

  it.each([undefined, null, "text", 5, [], { cssLayoutViewport: 3, cssContentSize: "x" }])(
    "does not throw for the answer %j and gives undefined fields",
    async (answer) => {
      const cdp = createFakeCdp({ "Page.getLayoutMetrics": answer });
      const metrics = await readPageMetrics(cdp);
      expect(Object.values(metrics).every((value) => value === undefined)).toBe(true);
    },
  );

  it("rejects when the command fails", async () => {
    const cdp = createFakeCdp({ "Page.getLayoutMetrics": new Error("no metrics") });
    await expect(readPageMetrics(cdp)).rejects.toThrow("no metrics");
  });
});

describe("serialised page functions", () => {
  it.each([
    ["collectInPage", collectInPage],
    ["scrollInPage", scrollInPage],
  ])("keeps %s self-contained", (_name, fn) => {
    const source = String(fn);
    for (const forbidden of ["__name", "import(", "require("]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("scrollInPage scrolls to the target and resolves with the scrollY of the page", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("window", { scrollTo, scrollY: 2200 });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal("setTimeout", () => 0);

    await expect(scrollInPage(2400)).resolves.toBe(2200);
    expect(scrollTo).toHaveBeenCalledWith(0, 2400);
  });

  it("scrollInPage still resolves through its timer when the page never paints", async () => {
    vi.stubGlobal("window", { scrollTo: vi.fn(), scrollY: 50 });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 1;
    });

    await expect(scrollInPage(50)).resolves.toBe(50);
  });
});

describe("module boundary", () => {
  it("takes a structural session, so a plain object is enough", async () => {
    const sent: string[] = [];
    const session: CdpSession = {
      send: async (method) => {
        sent.push(method);
        return {};
      },
      onEvent: () => {},
    };
    await hideScrollbars(session);
    expect(sent).toEqual(["Emulation.setScrollbarsHidden"]);
  });
});
