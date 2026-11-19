/**
 * URL safety checks of the page capture.
 *
 * This part holds the syntax checks that need no DNS (`checkUrlSyntax`) and the
 * check of resolved addresses (`checkUrl`).
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
  // Every trailing dot is stripped, so `localhost..` is judged like `localhost`.
  const name = hostname.replace(/\.+$/, "");
  if (name === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || DOTTED_QUAD.test(hostname);
}

export type UrlSyntaxOptions = {
  /** Longest accepted URL in characters. Default `MAX_URL_LENGTH`. */
  maxLength?: number;
};

/**
 * Checks the form of a URL without any DNS lookup, in the order of
 * `URL_SYNTAX_CHECK_ORDER`, and returns the first failure. No host is exempt from
 * any check.
 */
export function checkUrlSyntax(input: string, options?: UrlSyntaxOptions): UrlCheckResult {
  if (input.length > (options?.maxLength ?? MAX_URL_LENGTH)) return fail("url-too-long");

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

  if (isBlockedHostName(url.hostname)) return fail("url-host-blocked");
  if (isIpLiteral(url.hostname)) {
    const address = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    if (classifyAddress(address).blocked) return fail("url-address-blocked");
  }

  url.hash = "";
  return { ok: true, url: url.href, hostname: url.hostname };
}

export interface Resolver {
  /** All A and AAAA addresses as text. Rejects when the lookup fails. */
  resolveAddresses(hostname: string): Promise<readonly string[]>;
}

export type UrlCheckOptions = { resolver: Resolver };

/**
 * Runs `checkUrlSyntax`, then resolves a host name and checks every address it
 * resolves to. An IP literal is never resolved: the syntax check has judged it.
 *
 * The resolver error text is never copied into the result.
 */
export async function checkUrl(input: string, options: UrlCheckOptions): Promise<UrlCheckResult> {
  const { resolver } = options;
  const syntax = checkUrlSyntax(input);
  if (!syntax.ok) return syntax;
  if (isIpLiteral(syntax.hostname)) return syntax;

  let addresses: readonly string[];
  try {
    addresses = await resolver.resolveAddresses(syntax.hostname);
  } catch {
    return fail("dns-failed");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return fail("dns-failed");

  for (const address of addresses) {
    if (typeof address !== "string" || classifyAddress(address).blocked) {
      return fail("url-address-blocked");
    }
  }
  return syntax;
}
