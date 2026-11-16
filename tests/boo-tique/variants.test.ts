import { describe, it, expect } from "vitest";
import { pickVariant } from "@/lib/boo-tique/variants";

const ALLOWED = ["default", "ghost", "equal"] as const;

describe("pickVariant", () => {
  it("returns an allowed string value", () => {
    expect(pickVariant("ghost", ALLOWED, "default")).toBe("ghost");
    expect(pickVariant("equal", ALLOWED, "default")).toBe("equal");
  });

  it("returns the fallback for undefined", () => {
    expect(pickVariant(undefined, ALLOWED, "default")).toBe("default");
  });

  it("returns the fallback for an unknown value", () => {
    expect(pickVariant("foo", ALLOWED, "default")).toBe("default");
  });

  it("returns the fallback for an empty string", () => {
    expect(pickVariant("", ALLOWED, "default")).toBe("default");
  });

  it("matches exactly, with no case folding", () => {
    expect(pickVariant("GHOST", ALLOWED, "default")).toBe("default");
  });

  it("uses the first element of an array", () => {
    expect(pickVariant(["equal", "ghost"], ALLOWED, "default")).toBe("equal");
  });

  it("returns the fallback when the first array element is unknown, even if a later one is allowed", () => {
    expect(pickVariant(["foo", "ghost"], ALLOWED, "default")).toBe("default");
  });

  it("returns the fallback for an empty array", () => {
    expect(pickVariant([], ALLOWED, "default")).toBe("default");
  });

  it("does not treat object prototype keys as allowed values", () => {
    expect(pickVariant("constructor", ALLOWED, "default")).toBe("default");
    expect(pickVariant("__proto__", ALLOWED, "default")).toBe("default");
    expect(pickVariant("toString", ALLOWED, "default")).toBe("default");
  });

  it("never throws, whatever the input", () => {
    const inputs: unknown[] = [
      undefined,
      "",
      "x",
      [],
      [""],
      ["a", "b", "c"],
      null,
      42,
      {},
    ];
    for (const input of inputs) {
      expect(() =>
        pickVariant(input as string | string[] | undefined, ALLOWED, "default"),
      ).not.toThrow();
      expect(pickVariant(input as string | string[] | undefined, [], "x")).toBe("x");
    }
  });
});
