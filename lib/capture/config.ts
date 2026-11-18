import "server-only";
import { z } from "zod";
import {
  SESSION_TIMEOUT_DEFAULT_MINUTES,
  SESSION_TIMEOUT_MAX_MINUTES,
  SESSION_TIMEOUT_MIN_MINUTES,
} from "@/lib/capture/constants";
import type { CaptureError } from "@/lib/capture/types";
import { checkUrlSyntax } from "@/lib/capture/url-check";

export type CaptureConfig = Readonly<{
  browserMode: string; // default "remote"
  apiKey: string | null;
  proxy: "on" | "off"; // default "off"
  sessionTimeoutMinutes: number; // integer 1..5, default 1
  allowOrigin: string | null; // parsed once from NEXT_PUBLIC_APP_URL; bypasses no check
}>;

export type ConfigResult = { ok: true; config: CaptureConfig } | { ok: false; error: CaptureError };

const ENV_NAMES = [
  "CAPTURE_BROWSER_MODE",
  "BROWSER_USE_API_KEY",
  "BROWSER_USE_PROXY",
  "BROWSER_USE_SESSION_TIMEOUT_MINUTES",
  "NEXT_PUBLIC_APP_URL",
] as const;

const MAX_MODE_LENGTH = 32;
const DEFAULT_MODE = "remote";

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * False for an origin whose host is a blocked name or a blocked address. Other syntax
 * codes (for example a non-default port) do not reject it: the origin bypasses nothing.
 */
function hasPublicHost(origin: string): boolean {
  const result = checkUrlSyntax(origin);
  return result.ok || (result.code !== "url-host-blocked" && result.code !== "url-address-blocked");
}

// Issue paths are the environment variable names, so a failure can be reported by name only.
const EnvSchema = z
  .object({
    CAPTURE_BROWSER_MODE: z.string().min(1).max(MAX_MODE_LENGTH).optional(),
    BROWSER_USE_API_KEY: z.string().min(1).optional(),
    BROWSER_USE_PROXY: z.enum(["on", "off"]).optional(),
    BROWSER_USE_SESSION_TIMEOUT_MINUTES: z
      .string()
      .regex(/^[0-9]{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(SESSION_TIMEOUT_MIN_MINUTES).max(SESSION_TIMEOUT_MAX_MINUTES))
      .optional(),
    NEXT_PUBLIC_APP_URL: z
      .string()
      .refine(isHttpUrl)
      .transform((value) => new URL(value).origin)
      .refine(hasPublicHost)
      .optional(),
  });

/** Trims every known value; an empty or whitespace-only string counts as unset. */
function normalise(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) out[name] = value;
  }
  return out;
}

/** Validates an injected environment object. Never reads `process.env`. */
export function parseCaptureConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const input = normalise(env);
  const parsed = EnvSchema.safeParse(input);
  const names = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path[0];
      if (typeof name === "string") names.add(name);
    }
  }
  // Checked outside zod: an object-level refinement is skipped when a field already failed.
  if ((input.CAPTURE_BROWSER_MODE ?? DEFAULT_MODE) === "remote" && input.BROWSER_USE_API_KEY === undefined) {
    names.add("BROWSER_USE_API_KEY");
  }
  if (!parsed.success || names.size > 0) {
    // Names only, never values.
    const ordered = ENV_NAMES.filter((name) => names.has(name));
    return {
      ok: false,
      error: {
        code: "config-invalid",
        message: `Invalid capture environment: ${ordered.join(", ")}`,
      },
    };
  }
  const value = parsed.data;
  return {
    ok: true,
    config: {
      browserMode: value.CAPTURE_BROWSER_MODE ?? DEFAULT_MODE,
      apiKey: value.BROWSER_USE_API_KEY ?? null,
      proxy: value.BROWSER_USE_PROXY ?? "off",
      sessionTimeoutMinutes: value.BROWSER_USE_SESSION_TIMEOUT_MINUTES ?? SESSION_TIMEOUT_DEFAULT_MINUTES,
      allowOrigin: value.NEXT_PUBLIC_APP_URL ?? null,
    },
  };
}

let cached: ConfigResult | undefined;

/** Parses `process.env` once and reuses the result. */
export function getCaptureConfig(): ConfigResult {
  cached ??= parseCaptureConfig(process.env);
  return cached;
}
