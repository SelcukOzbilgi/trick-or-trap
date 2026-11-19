import { describe, expect, it } from "vitest";
import type { CdpSession } from "@/lib/capture/cdp";
import { createFakeCdp, type CdpCall } from "./helpers/fake-cdp";

/** Calls `send` the way a wrong caller would, with an extra argument. */
function sendWithThreeArguments(session: CdpSession): unknown {
  return (session.send as (...args: unknown[]) => unknown)("Page.getFrameTree", {}, "child-session");
}

describe("fake CDP page session", () => {
  it("is a CdpSession with send only", () => {
    const cdp = createFakeCdp();
    const session: CdpSession = cdp;
    expect(typeof session.send).toBe("function");
    expect("onEvent" in cdp).toBe(false);
    expect("emit" in cdp).toBe(false);
  });

  it("records calls with a method and parameters and no target session id", async () => {
    const cdp = createFakeCdp();
    await cdp.send("Emulation.setScrollbarsHidden", { hidden: true });
    await cdp.send("Page.getFrameTree");
    expect(cdp.calls).toEqual([
      { method: "Emulation.setScrollbarsHidden", params: { hidden: true } },
      { method: "Page.getFrameTree", params: undefined },
    ]);
    expect(cdp.callsOf("Page.getFrameTree")).toHaveLength(1);
    expect(cdp.violations).toEqual([]);
    expect(() => cdp.assertNoViolations()).not.toThrow();
  });

  it("answers a method without a script with an empty object", async () => {
    await expect(createFakeCdp().send("Page.enable")).resolves.toEqual({});
  });

  it("answers a scripted value, a function of the call, an error and a hang", async () => {
    const cdp = createFakeCdp({
      "A.value": { ok: 1 },
      "A.fn": (call: CdpCall) => ({ echoed: call.method }),
      "A.error": new Error("scripted failure"),
      "A.hang": "hang",
    });
    await expect(cdp.send("A.value")).resolves.toEqual({ ok: 1 });
    await expect(cdp.send("A.fn")).resolves.toEqual({ echoed: "A.fn" });
    await expect(cdp.send("A.error")).rejects.toThrow("scripted failure");

    let settled = false;
    void cdp.send("A.hang").then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
  });

  it("replaces the answer of a method with script", async () => {
    const cdp = createFakeCdp({ "A.value": 1 });
    cdp.script("A.value", 2);
    await expect(cdp.send("A.value")).resolves.toBe(2);
  });

  it("throws on a third argument and records a violation", () => {
    const cdp = createFakeCdp();
    expect(() => sendWithThreeArguments(cdp)).toThrow(/protocol violation/);
    expect(cdp.violations).toHaveLength(1);
    expect(cdp.violations[0]).toContain("Page.getFrameTree");
    expect(cdp.calls).toEqual([]);
    expect(() => cdp.assertNoViolations()).toThrow(/protocol violations/);
  });

  it("throws on a sessionId in the parameters and records a violation", () => {
    const cdp = createFakeCdp();
    expect(() => cdp.send("Runtime.callFunctionOn", { sessionId: "child", other: 1 })).toThrow(/protocol violation/);
    expect(cdp.violations).toHaveLength(1);
    expect(cdp.violations[0]).toContain("sessionId");
    expect(cdp.calls).toEqual([]);
    expect(() => cdp.assertNoViolations()).toThrow();
  });

  it("keeps every violation in the list", () => {
    const cdp = createFakeCdp();
    expect(() => sendWithThreeArguments(cdp)).toThrow();
    expect(() => cdp.send("X.y", { sessionId: "s" })).toThrow();
    expect(cdp.violations).toHaveLength(2);
  });

  it("does not take a field named like a session id inside nested parameters as a violation", async () => {
    const cdp = createFakeCdp();
    await cdp.send("X.y", { nested: { sessionId: "s" } });
    expect(cdp.violations).toEqual([]);
  });
});
