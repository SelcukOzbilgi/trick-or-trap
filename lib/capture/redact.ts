import { MAX_DETAIL_CHARS } from "@/lib/capture/constants";

const MIN_SECRET_LENGTH = 4;
const SECRET_PLACEHOLDER = "[redacted]";
const URL_PLACEHOLDER = "[redacted-url]";

const WEBSOCKET_URL = /wss?:\/\/\S*/gi;
// `*.cdp.browser-use.com` with an optional scheme, port and path.
const CDP_HOST =
  /(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[a-z0-9-]+\.)*cdp\.browser-use\.com(?::\d+)?(?:\/\S*)?/gi;

/**
 * Removes secrets and session addresses from `text`.
 *
 * Order: exact secrets (longest first, so a secret inside another one leaves no
 * rest), then `ws://` and `wss://` URLs, then `*.cdp.browser-use.com` hosts.
 * Secrets that are empty, blank or shorter than 4 characters are ignored.
 */
export function redactText(
  text: string,
  secrets: readonly (string | null | undefined)[]
): string {
  const usable = Array.from(
    new Set(
      secrets.filter(
        (secret): secret is string =>
          typeof secret === "string" &&
          secret.length >= MIN_SECRET_LENGTH &&
          secret.trim().length > 0
      )
    )
  ).sort((a, b) => b.length - a.length);

  let out = text;
  for (const secret of usable) {
    out = out.split(secret).join(SECRET_PLACEHOLDER);
  }
  return out.replace(WEBSOCKET_URL, URL_PLACEHOLDER).replace(CDP_HOST, URL_PLACEHOLDER);
}

function errorText(error: unknown): string {
  if (error === undefined || error === null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "";
  }
}

/**
 * Turns an error into a short `detail` text: redacted first, then whitespace
 * collapsed, then cut to 200 characters. Returns `undefined` when nothing is left.
 */
export function toDetail(
  error: unknown,
  secrets: readonly (string | null | undefined)[]
): string | undefined {
  const redacted = redactText(errorText(error), secrets);
  const collapsed = redacted.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.slice(0, MAX_DETAIL_CHARS);
}
