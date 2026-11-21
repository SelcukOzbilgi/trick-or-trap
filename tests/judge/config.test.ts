import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DIRECT_BASE_URL,
  GATEWAY_BASE_URL,
  JUDGE_MODEL_DIRECT,
  JUDGE_MODEL_GATEWAY,
} from "@/lib/judge/constants";
import { readJudgeConfig } from "@/lib/judge/config";

const PLACEHOLDER_GATEWAY_VALUE = "placeholder-gateway";
const PLACEHOLDER_DIRECT_VALUE = "placeholder-direct";

describe("readJudgeConfig: mode off", () => {
  it("reads an unset mode as off with the reason unset", () => {
    expect(readJudgeConfig({})).toEqual({ mode: "off", offReason: "unset" });
  });

  it("reads an empty or space-only mode as off with the reason unset", () => {
    expect(readJudgeConfig({ JUDGE_MODE: "" })).toEqual({ mode: "off", offReason: "unset" });
    expect(readJudgeConfig({ JUDGE_MODE: "   " })).toEqual({ mode: "off", offReason: "unset" });
  });

  it("reads the word off as off with the reason unset", () => {
    expect(readJudgeConfig({ JUDGE_MODE: "off", AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE })).toEqual({
      mode: "off",
      offReason: "unset",
    });
  });

  it("reads an unknown mode as off with the reason unknown-mode and does not echo it", () => {
    const result = readJudgeConfig({
      JUDGE_MODE: "bogus-MODE-SENTINEL",
      AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE,
      ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE,
    });
    expect(result).toEqual({ mode: "off", offReason: "unknown-mode" });
    const text = JSON.stringify(result);
    expect(text).not.toContain("SENTINEL");
    expect(text).not.toContain(PLACEHOLDER_GATEWAY_VALUE);
    expect(text).not.toContain(PLACEHOLDER_DIRECT_VALUE);
  });

  it("does not guess a different spelling of a mode", () => {
    for (const mode of ["Gateway", "ANTHROPIC", "gateway,anthropic", "on", "1"]) {
      expect(readJudgeConfig({ JUDGE_MODE: mode, AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE })).toEqual({
        mode: "off",
        offReason: "unknown-mode",
      });
    }
  });
});

describe("readJudgeConfig: gateway", () => {
  it("returns the key, the gateway base URL and the gateway model", () => {
    expect(
      readJudgeConfig({ JUDGE_MODE: "gateway", AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE }),
    ).toEqual({
      mode: "gateway",
      apiKey: PLACEHOLDER_GATEWAY_VALUE,
      baseURL: GATEWAY_BASE_URL,
      model: JUDGE_MODEL_GATEWAY,
    });
  });

  it("trims the mode and the key", () => {
    expect(
      readJudgeConfig({ JUDGE_MODE: "  gateway ", AI_GATEWAY_API_KEY: `  ${PLACEHOLDER_GATEWAY_VALUE}\n` }),
    ).toMatchObject({
      mode: "gateway",
      apiKey: PLACEHOLDER_GATEWAY_VALUE,
    });
  });

  it.each([
    ["missing", {}],
    ["empty", { AI_GATEWAY_API_KEY: "" }],
    ["space-only", { AI_GATEWAY_API_KEY: "  \t " }],
  ])("returns off with missing-key when the key is %s", (_label, keys) => {
    const result = readJudgeConfig({ JUDGE_MODE: "gateway", ...keys });
    expect(result).toEqual({ mode: "off", offReason: "missing-key", requestedMode: "gateway" });
  });

  it("does not use the key of the other mode", () => {
    expect(readJudgeConfig({ JUDGE_MODE: "gateway", ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE })).toEqual({
      mode: "off",
      offReason: "missing-key",
      requestedMode: "gateway",
    });
  });
});

describe("readJudgeConfig: anthropic", () => {
  it("returns the key, the direct base URL and the direct model", () => {
    expect(
      readJudgeConfig({ JUDGE_MODE: "anthropic", ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE }),
    ).toEqual({
      mode: "anthropic",
      apiKey: PLACEHOLDER_DIRECT_VALUE,
      baseURL: DIRECT_BASE_URL,
      model: JUDGE_MODEL_DIRECT,
    });
  });

  it.each([
    ["missing", {}],
    ["empty", { ANTHROPIC_API_KEY: "" }],
    ["space-only", { ANTHROPIC_API_KEY: "   " }],
  ])("returns off with missing-key when the key is %s", (_label, keys) => {
    const result = readJudgeConfig({ JUDGE_MODE: "anthropic", ...keys });
    expect(result).toEqual({ mode: "off", offReason: "missing-key", requestedMode: "anthropic" });
  });

  it("does not use the key of the other mode", () => {
    expect(readJudgeConfig({ JUDGE_MODE: "anthropic", AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE })).toEqual({
      mode: "off",
      offReason: "missing-key",
      requestedMode: "anthropic",
    });
  });
});

describe("readJudgeConfig: no key in any message", () => {
  it("holds no key value in a result that is off", () => {
    const results = [
      readJudgeConfig({ JUDGE_MODE: "gateway", ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE }),
      readJudgeConfig({ JUDGE_MODE: "anthropic", AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE }),
      readJudgeConfig({
        JUDGE_MODE: "bogus",
        AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE,
        ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE,
      }),
      readJudgeConfig({
        AI_GATEWAY_API_KEY: PLACEHOLDER_GATEWAY_VALUE,
        ANTHROPIC_API_KEY: PLACEHOLDER_DIRECT_VALUE,
      }),
    ];
    for (const result of results) {
      expect(result.mode).toBe("off");
      const text = JSON.stringify(result);
      expect(text).not.toContain(PLACEHOLDER_GATEWAY_VALUE);
      expect(text).not.toContain(PLACEHOLDER_DIRECT_VALUE);
      expect(text).not.toContain("placeholder");
    }
  });

  it("never throws, whatever the environment holds", () => {
    expect(() => readJudgeConfig({ JUDGE_MODE: undefined, AI_GATEWAY_API_KEY: undefined })).not.toThrow();
    expect(() => readJudgeConfig(process.env)).not.toThrow();
  });
});
