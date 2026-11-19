import { describe, expect, it } from "vitest";
import { MAX_HOP_URL_LENGTH, MAX_URL_LENGTH, MAX_VERDICT_CACHE_ENTRIES } from "@/lib/capture/constants";
import { createGuardPolicy } from "@/lib/capture/guard-policy";
import type { GuardEvent } from "@/lib/capture/seam";
import type { Resolver } from "@/lib/capture/url-check";

type ResolverSetup = { resolver: Resolver; calls: string[] };

/** A resolver that answers a public address, a private one or an error per host name, and records every call. */
function createResolver(answers: Record<string, readonly string[] | Error> = {}): ResolverSetup {
  const calls: string[] = [];
  const resolver: Resolver = {
    async resolveAddresses(hostname) {
      calls.push(hostname);
      const answer = answers[hostname] ?? ["93.184.216.34"];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { resolver, calls };
}

function setup(options: { answers?: Record<string, readonly string[] | Error>; maxCacheEntries?: number } = {}) {
  const { resolver, calls } = createResolver(options.answers);
  const events: GuardEvent[] = [];
  const policy = createGuardPolicy({
    resolver,
    report: (event) => events.push(event),
    ...(options.maxCacheEntries === undefined ? {} : { maxCacheEntries: options.maxCacheEntries }),
  });
  return { policy, calls, events };
}

describe("createGuardPolicy: verdict cache", () => {
  it("resolves one origin once for any number of checks", async () => {
    const { policy, calls } = setup();
    expect(await policy.checkHost("https://cdn.example.net/a.js")).toEqual({ allowed: true });
    expect(await policy.checkHost("https://cdn.example.net/b.css")).toEqual({ allowed: true });
    expect(await policy.checkHost("https://cdn.example.net/c/d?e=1")).toEqual({ allowed: true });
    expect(calls).toEqual(["cdn.example.net"]);
  });

  it("resolves requests that are checked at the same time once", async () => {
    const { policy, calls } = setup();
    const verdicts = await Promise.all([
      policy.checkHost("https://cdn.example.net/1"),
      policy.checkHost("https://cdn.example.net/2"),
      policy.checkHost("https://cdn.example.net/3"),
    ]);
    expect(verdicts).toEqual([{ allowed: true }, { allowed: true }, { allowed: true }]);
    expect(calls).toEqual(["cdn.example.net"]);
  });

  it("keys the cache by origin: scheme and port make another entry", async () => {
    const { policy, calls } = setup();
    await policy.checkHost("https://cdn.example.net/a");
    await policy.checkHost("http://cdn.example.net/a");
    await policy.checkHost("https://cdn.example.net:443/b");
    expect(calls).toEqual(["cdn.example.net", "cdn.example.net"]);
  });

  it("reuses a refusing verdict without a second lookup", async () => {
    const { policy, calls } = setup({ answers: { "internal.example.net": ["10.0.0.5"] } });
    expect(await policy.checkHost("https://internal.example.net/a")).toEqual({
      allowed: false,
      reason: "url-address-blocked",
    });
    expect(await policy.checkHost("https://internal.example.net/b")).toEqual({
      allowed: false,
      reason: "url-address-blocked",
    });
    expect(calls).toEqual(["internal.example.net"]);
  });

  it("caches a failed lookup as dns-failed", async () => {
    const { policy, calls } = setup({ answers: { "gone.example.net": new Error("ENOTFOUND") } });
    expect(await policy.checkHost("https://gone.example.net/a")).toEqual({ allowed: false, reason: "dns-failed" });
    expect(await policy.checkHost("https://gone.example.net/b")).toEqual({ allowed: false, reason: "dns-failed" });
    expect(calls).toEqual(["gone.example.net"]);
  });

  it("does not resolve a URL that fails the syntax check, and does not use a cache entry for it", async () => {
    const { policy, calls } = setup({ maxCacheEntries: 1 });
    expect(await policy.checkHost("https://shop.example.net:8443/")).toEqual({ allowed: false, reason: "url-port-blocked" });
    expect(await policy.checkHost("ftp://shop.example.net/")).toEqual({ allowed: false, reason: "url-scheme-blocked" });
    expect(calls).toEqual([]);
    // The one entry of the cache is still free.
    expect(await policy.checkHost("https://shop.example.net/")).toEqual({ allowed: true });
    expect(calls).toEqual(["shop.example.net"]);
  });
});

describe("createGuardPolicy: cache cap", () => {
  it("refuses a new origin with host-limit-reached and no lookup once the cache holds the cap", async () => {
    const { policy, calls } = setup({ maxCacheEntries: 3 });
    for (const n of [1, 2, 3]) expect(await policy.checkHost(`https://h${n}.example.net/`)).toEqual({ allowed: true });
    expect(calls).toEqual(["h1.example.net", "h2.example.net", "h3.example.net"]);

    expect(await policy.checkHost("https://h4.example.net/")).toEqual({ allowed: false, reason: "host-limit-reached" });
    expect(await policy.checkHost("https://h5.example.net/")).toEqual({ allowed: false, reason: "host-limit-reached" });
    expect(calls).toHaveLength(3);
  });

  it("still answers an origin that is in the cache from the cache at the cap", async () => {
    const { policy, calls } = setup({ maxCacheEntries: 2, answers: { "bad.example.net": ["127.0.0.1"] } });
    await policy.checkHost("https://ok.example.net/");
    await policy.checkHost("https://bad.example.net/");
    expect(await policy.checkHost("https://ok.example.net/again")).toEqual({ allowed: true });
    expect(await policy.checkHost("https://bad.example.net/again")).toEqual({ allowed: false, reason: "url-address-blocked" });
    expect(calls).toEqual(["ok.example.net", "bad.example.net"]);
  });

  it("never evicts an entry, so no origin is resolved twice", async () => {
    const { policy, calls } = setup({ maxCacheEntries: 2 });
    for (let round = 0; round < 3; round += 1) {
      for (const n of [1, 2, 3, 4]) await policy.checkHost(`https://h${n}.example.net/`);
    }
    expect(calls).toEqual(["h1.example.net", "h2.example.net"]);
  });

  it("applies the cap to requests that are checked at the same time", async () => {
    const { policy, calls } = setup({ maxCacheEntries: 2 });
    const verdicts = await Promise.all(
      [1, 2, 3, 4].map((n) => policy.checkHost(`https://h${n}.example.net/`)),
    );
    expect(verdicts.filter((verdict) => verdict.allowed)).toHaveLength(2);
    expect(verdicts.filter((verdict) => !verdict.allowed && verdict.reason === "host-limit-reached")).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("uses MAX_VERDICT_CACHE_ENTRIES (1,200) as the default cap", async () => {
    const { policy, calls } = setup();
    expect(MAX_VERDICT_CACHE_ENTRIES).toBe(1_200);
    for (let n = 0; n < MAX_VERDICT_CACHE_ENTRIES; n += 1) {
      expect(await policy.checkHost(`https://h${n}.example.net/`)).toEqual({ allowed: true });
    }
    expect(calls).toHaveLength(MAX_VERDICT_CACHE_ENTRIES);
    expect(await policy.checkHost("https://one-more.example.net/")).toEqual({
      allowed: false,
      reason: "host-limit-reached",
    });
    expect(calls).toHaveLength(MAX_VERDICT_CACHE_ENTRIES);
  });

  it("reports request-host-limit once, however many origins are refused", async () => {
    const { policy, events } = setup({ maxCacheEntries: 1 });
    await policy.checkHost("https://a.example.net/");
    expect(events).toEqual([]);
    await policy.checkHost("https://b.example.net/");
    await policy.checkHost("https://c.example.net/");
    expect(events).toEqual([{ kind: "request-host-limit" }]);
  });

  it("does not throw when the report callback throws", async () => {
    const { resolver } = createResolver();
    const policy = createGuardPolicy({
      resolver,
      maxCacheEntries: 0,
      report: () => {
        throw new Error("report failed");
      },
    });
    expect(await policy.checkHost("https://a.example.net/")).toEqual({ allowed: false, reason: "host-limit-reached" });
  });
});

describe("createGuardPolicy: the input URL check shares the cache", () => {
  it("answers inspect and checkHost for one origin with one lookup, in either order", async () => {
    const first = setup();
    const inspected = await first.policy.inspect("https://shop.example.com/page?x=1#frag");
    expect(inspected).toEqual({ ok: true, url: "https://shop.example.com/page?x=1", hostname: "shop.example.com" });
    expect(await first.policy.checkHost("https://shop.example.com/other")).toEqual({ allowed: true });
    expect(first.calls).toEqual(["shop.example.com"]);

    const second = setup();
    expect(await second.policy.checkHost("https://shop.example.com/other")).toEqual({ allowed: true });
    expect((await second.policy.inspect("https://shop.example.com/")).ok).toBe(true);
    expect(second.calls).toEqual(["shop.example.com"]);
  });

  it("fits the input URL in the cache because it is checked first", async () => {
    const { policy } = setup({ maxCacheEntries: 1 });
    expect((await policy.inspect("https://shop.example.com/")).ok).toBe(true);
    expect(await policy.inspect("https://other.example.com/")).toEqual({ ok: false, code: "host-limit-reached" });
    // The input origin is still answered at the cap.
    expect((await policy.inspect("https://shop.example.com/again")).ok).toBe(true);
  });

  it("returns the code of a refusing verdict and of a failed syntax check", async () => {
    const { policy } = setup({ answers: { "internal.example.net": ["192.168.1.1"] } });
    expect(await policy.inspect("https://internal.example.net/")).toEqual({ ok: false, code: "url-address-blocked" });
    expect(await policy.inspect("not a url")).toEqual({ ok: false, code: "url-invalid" });
  });

  it("limits the length by maxLength, and by MAX_URL_LENGTH when none is given", async () => {
    const { policy } = setup();
    const long = (length: number) => "https://shop.example.com/" + "a".repeat(length - "https://shop.example.com/".length);
    expect(await policy.inspect(long(MAX_URL_LENGTH + 1))).toEqual({ ok: false, code: "url-too-long" });
    expect((await policy.inspect(long(MAX_URL_LENGTH))).ok).toBe(true);
    expect((await policy.inspect(long(3_000), MAX_HOP_URL_LENGTH)).ok).toBe(true);
    expect(await policy.inspect(long(MAX_HOP_URL_LENGTH + 1), MAX_HOP_URL_LENGTH)).toEqual({
      ok: false,
      code: "url-too-long",
    });
  });
});

describe("createGuardPolicy: PageGuards", () => {
  it("checks syntax with the hop length limit and without DNS", async () => {
    const { policy, calls } = setup();
    const long = (length: number) => "https://shop.example.com/" + "a".repeat(length - "https://shop.example.com/".length);
    expect(policy.checkSyntax(long(MAX_HOP_URL_LENGTH))).toEqual({ allowed: true });
    expect(policy.checkSyntax(long(MAX_HOP_URL_LENGTH + 1))).toEqual({ allowed: false, reason: "url-too-long" });
    expect(policy.checkSyntax("https://shop.example.com:8443/")).toEqual({ allowed: false, reason: "url-port-blocked" });
    expect(calls).toEqual([]);
  });

  it("passes the events of the guard on to the report callback", () => {
    const { policy, events } = setup();
    policy.report({ kind: "request-blocked", reason: "url-port-blocked", mainFrame: false });
    policy.report({ kind: "popup-closed" });
    expect(events).toEqual([
      { kind: "request-blocked", reason: "url-port-blocked", mainFrame: false },
      { kind: "popup-closed" },
    ]);
  });
});
