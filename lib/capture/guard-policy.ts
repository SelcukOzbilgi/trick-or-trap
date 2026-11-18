/**
 * The URL policy of one capture: the syntax checks, the DNS check and the capped
 * verdict cache. The request guard, the input URL check and both final-URL checks of
 * `capturePage` all use the one policy object, so they share one cache.
 *
 * The cache holds one verdict per origin (scheme, host and port), because the checks
 * depend on all three. It never evicts: an origin is resolved at most once per capture.
 * When it holds `maxCacheEntries` origins, a new origin is refused with
 * `host-limit-reached` and is not resolved, so a hostile page cannot turn the capture
 * into a DNS query generator.
 *
 * Resolver error text is never copied into a result. No URL or host name is put in an
 * event.
 */
import { MAX_HOP_URL_LENGTH, MAX_VERDICT_CACHE_ENTRIES } from "./constants";
import type { GuardEvent, PageGuards } from "./seam";
import type { UrlErrorCode } from "./types";
import { checkUrl, checkUrlSyntax, type Resolver } from "./url-check";

/** The result of `GuardPolicy.inspect`: a `UrlCheckResult` whose failure may also be the cache cap. */
export type GuardInspectResult =
  | { ok: true; url: string; hostname: string } // url: normalised, no fragment
  | { ok: false; code: UrlErrorCode | "host-limit-reached" };

export type GuardPolicy = PageGuards & {
  /**
   * Syntax plus the cached DNS verdict of the origin. `maxLength` is the limit of this
   * URL: the input URL keeps the default, a hop or a final URL gets the hop limit.
   */
  inspect(url: string, maxLength?: number): Promise<GuardInspectResult>;
};

export type GuardPolicyOptions = {
  resolver: Resolver;
  /** Receives every event of the guard, and the one `request-host-limit` of the cache cap. */
  report: (event: GuardEvent) => void;
  /** Most origins the cache holds. Default `MAX_VERDICT_CACHE_ENTRIES`. */
  maxCacheEntries?: number;
};

export function createGuardPolicy(options: GuardPolicyOptions): GuardPolicy {
  const { resolver, report } = options;
  const maxCacheEntries = options.maxCacheEntries ?? MAX_VERDICT_CACHE_ENTRIES;
  const urlOptions = { resolver };

  const verdicts = new Map<string, Promise<UrlErrorCode | null>>();
  let limitReported = false;

  function reportQuietly(event: GuardEvent): void {
    try {
      report(event);
    } catch {
      // The caller's handler must not break the policy.
    }
  }

  const inspect = async (candidate: string, maxLength?: number): Promise<GuardInspectResult> => {
    const syntax = checkUrlSyntax(candidate, maxLength === undefined ? undefined : { maxLength });
    if (!syntax.ok) return syntax;
    // The DNS check is made on the origin alone, so a long hop URL does not fail it for its length.
    const origin = new URL(syntax.url).origin;
    let pending = verdicts.get(origin);
    if (!pending) {
      // Check and add happen with no await in between, so checks that start at the same
      // time cannot push the cache past its cap.
      if (verdicts.size >= maxCacheEntries) {
        if (!limitReported) {
          limitReported = true;
          reportQuietly({ kind: "request-host-limit" });
        }
        return { ok: false, code: "host-limit-reached" };
      }
      pending = checkUrl(`${origin}/`, urlOptions).then((result) => (result.ok ? null : result.code));
      verdicts.set(origin, pending);
    }
    const code = await pending;
    return code === null ? syntax : { ok: false, code };
  };

  return {
    checkSyntax(candidate) {
      const syntax = checkUrlSyntax(candidate, { maxLength: MAX_HOP_URL_LENGTH });
      return syntax.ok ? { allowed: true } : { allowed: false, reason: syntax.code };
    },
    async checkHost(candidate) {
      const verdict = await inspect(candidate, MAX_HOP_URL_LENGTH);
      return verdict.ok ? { allowed: true } : { allowed: false, reason: verdict.code };
    },
    report: reportQuietly,
    inspect,
  };
}
