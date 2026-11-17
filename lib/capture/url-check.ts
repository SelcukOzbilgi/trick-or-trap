/**
 * URL safety checks of the page capture.
 *
 * This part holds the syntax checks that need no DNS. The check for resolved
 * addresses is added next to it.
 */
import { ALLOWED_PORTS, MAX_URL_LENGTH } from "@/lib/capture/constants";
import { classifyAddress } from "@/lib/capture/ip-ranges";
import type { UrlErrorCode } from "@/lib/capture/types";

export type UrlCheckResult =
  | { ok: true; url: string; hostname: string } // url: normalised, no fragment
  | { ok: false; code: UrlErrorCode };

/** The failure codes of `checkUrlSyntax`, in the order the checks run. */
export const URL_SYNTAX_CHECK_ORDER = [
  "url-too-long",
  "url-invalid",
  "url-scheme-blocked",
  "url-credentials-blocked",
  "url-port-blocked",
  "url-host-blocked",
  "url-address-blocked",
] as const satisfies readonly UrlErrorCode[];

const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const DOTTED_QUAD = /^\d+\.\d+\.\d+\.\d+$/;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"] as const;

function fail(code: UrlErrorCode): UrlCheckResult {
  return { ok: false, code };
}

function isBlockedHostName(hostname: string): boolean {
  const name = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (name === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || DOTTED_QUAD.test(hostname);
}

/**
 * Checks the form of a URL without any DNS lookup, in the order of
 * `URL_SYNTAX_CHECK_ORDER`, and returns the first failure.
 *
 * `allowOrigin` is an exact origin (scheme, host, port). A URL with that origin
 * skips the host name and address checks only.
 */
export function checkUrlSyntax(input: string, allowOrigin: string | null): UrlCheckResult {
  if (input.length > MAX_URL_LENGTH) return fail("url-too-long");

  if (CONTROL_OR_SPACE.test(input)) return fail("url-invalid");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("url-invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("url-scheme-blocked");
  if (url.username !== "" || url.password !== "") return fail("url-credentials-blocked");
  // The WHATWG parser drops a default port, so an empty port is always acceptable.
  if (url.port !== "" && !ALLOWED_PORTS.includes(Number(url.port))) return fail("url-port-blocked");

  const allowed = allowOrigin !== null && url.origin === allowOrigin;
  if (!allowed) {
    if (isBlockedHostName(url.hostname)) return fail("url-host-blocked");
    if (isIpLiteral(url.hostname)) {
      const address = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
      if (classifyAddress(address).blocked) return fail("url-address-blocked");
    }
  }

  url.hash = "";
  return { ok: true, url: url.href, hostname: url.hostname };
}
