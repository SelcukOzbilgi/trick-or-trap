import "server-only";
import {
  DIRECT_BASE_URL,
  GATEWAY_BASE_URL,
  JUDGE_MODEL_DIRECT,
  JUDGE_MODEL_GATEWAY,
} from "@/lib/judge/constants";
import type { OffReason } from "@/lib/judge/types";

/**
 * Environment parsing of the model judge (design section 16). It reads names
 * from the object it is given, never from `process.env` itself, so a test can
 * pass any environment. It never throws and never puts a key, or any other
 * environment value, into a field other than `apiKey`.
 */

/** The environment names read here. */
export type JudgeEnv = Readonly<Record<string, string | undefined>>;

export type JudgeConfigOff = {
  mode: "off";
  offReason: OffReason;
  /** The mode that was asked for, when it is valid and its key is missing. */
  requestedMode?: "gateway" | "anthropic";
};

export type JudgeConfigOn = {
  mode: "gateway" | "anthropic";
  apiKey: string;
  baseURL: string;
  model: string;
};

export type JudgeConfig = JudgeConfigOff | JudgeConfigOn;

/** A trimmed value, or an empty string when the name is not set. */
function read(env: JudgeEnv, name: string): string {
  return (env[name] ?? "").trim();
}

/**
 * Read the judge mode and the settings of that mode.
 *
 * - `JUDGE_MODE` unset, empty or `off` gives mode `off` with the reason
 *   `unset`. Any other value than `gateway` or `anthropic` gives `off` with
 *   `unknown-mode`; the value is not echoed.
 * - `gateway` needs `AI_GATEWAY_API_KEY`; `anthropic` needs
 *   `ANTHROPIC_API_KEY`. A key is trimmed, and an empty key is missing: the
 *   result is `off` with `missing-key` and the requested mode.
 */
export function readJudgeConfig(env: JudgeEnv): JudgeConfig {
  const requested = read(env, "JUDGE_MODE");
  if (requested === "" || requested === "off") {
    return { mode: "off", offReason: "unset" };
  }
  if (requested === "gateway") {
    const apiKey = read(env, "AI_GATEWAY_API_KEY");
    if (apiKey === "") {
      return { mode: "off", offReason: "missing-key", requestedMode: "gateway" };
    }
    return { mode: "gateway", apiKey, baseURL: GATEWAY_BASE_URL, model: JUDGE_MODEL_GATEWAY };
  }
  if (requested === "anthropic") {
    const apiKey = read(env, "ANTHROPIC_API_KEY");
    if (apiKey === "") {
      return { mode: "off", offReason: "missing-key", requestedMode: "anthropic" };
    }
    return { mode: "anthropic", apiKey, baseURL: DIRECT_BASE_URL, model: JUDGE_MODEL_DIRECT };
  }
  return { mode: "off", offReason: "unknown-mode" };
}
