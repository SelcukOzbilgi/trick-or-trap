import { describe, expect, it } from "vitest";
import { MAX_HOP_URL_LENGTH, MAX_URL_LENGTH } from "@/lib/capture/constants";
import { checkUrl, checkUrlSyntax, URL_SYNTAX_CHECK_ORDER, type Resolver } from "@/lib/capture/url-check";

function codeOf(input: string, options?: { maxLength?: number }): string {
  const result = checkUrlSyntax(input, options);
  return result.ok ? "ok" : result.code;
}

function padded(length: number): string {
  const prefix = "https://example.com/";
  return prefix + "a".repeat(length - prefix.length);
}

describe("checkUrlSyntax: length and form", () => {
  it("rejects a URL of 2,049 characters", () => {
    const input = padded(MAX_URL_LENGTH + 1);
    expect(input).toHaveLength(2_049);
    expect(codeOf(input)).toBe("url-too-long");
  });

  it("accepts a URL of exactly 2,048 characters", () => {
    const input = padded(MAX_URL_LENGTH);
    expect(input).toHaveLength(2_048);
    expect(codeOf(input)).toBe("ok");
  });

  it("checks the length before anything else", () => {
    expect(codeOf("ftp://" + "a".repeat(MAX_URL_LENGTH))).toBe("url-too-long");
  });

  it("accepts a 3,000-character URL with maxLength 8,192", () => {
    const input = padded(3_000);
    expect(input).toHaveLength(3_000);
    expect(codeOf(input, { maxLength: MAX_HOP_URL_LENGTH })).toBe("ok");
    expect(codeOf(input)).toBe("url-too-long");
  });

  it("accepts 8,192 characters and refuses 8,193 with maxLength 8,192", () => {
    expect(codeOf(padded(8_192), { maxLength: 8_192 })).toBe("ok");
    expect(codeOf(padded(8_193), { maxLength: 8_192 })).toBe("url-too-long");
  });

  it("uses 2,048 when the options hold no maxLength", () => {
    expect(codeOf(padded(2_048), {})).toBe("ok");
    expect(codeOf(padded(2_049), {})).toBe("url-too-long");
  });

  it.each([
    ["whitespace inside", "https://exa mple.com/"],
    ["a tab", "https://example.com/\tx"],
    ["a newline", "https://example.com/\nx"],
    ["leading space", " https://example.com/"],
    ["trailing space", "https://example.com/ "],
    ["a NUL character", "https://example.com/\u0000"],
    ["a DEL character", "https://example.com/\u007f"],
    ["an empty string", ""],
    ["plain words", "not a url"],
    ["a relative path", "/just/a/path"],
    ["a host without a scheme", "example.com"],
  ])("rejects %s as url-invalid", (_label, input) => {
    expect(codeOf(input)).toBe("url-invalid");
  });
});

describe("checkUrlSyntax: scheme", () => {
  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ws://example.com/"])(
    "blocks %s",
    (input) => {
      expect(codeOf(input)).toBe("url-scheme-blocked");
    }
  );

  it("accepts http and https", () => {
    expect(codeOf("http://example.com/")).toBe("ok");
    expect(codeOf("https://example.com/")).toBe("ok");
    expect(codeOf("HTTPS://EXAMPLE.COM/")).toBe("ok");
  });
});

describe("checkUrlSyntax: credentials", () => {
  it.each(["https://user:pw@example.com/", "https://user@example.com/", "https://:pw@example.com/"])(
    "blocks %s",
    (input) => {
      expect(codeOf(input)).toBe("url-credentials-blocked");
    }
  );
});

describe("checkUrlSyntax: ports", () => {
  it.each([
    "https://a.com:8080/",
    "http://a.com:22/",
    "https://a.com:3000/",
    "http://a.com:8443/",
    "https://a.com:65535/",
  ])("blocks %s", (input) => {
    expect(codeOf(input)).toBe("url-port-blocked");
  });

  it.each(["http://a.com:443/", "https://a.com:80/", "https://a.com:443/", "http://a.com:80/", "http://a.com/"])(
    "accepts %s",
    (input) => {
      expect(codeOf(input)).toBe("ok");
    }
  );
});

describe("checkUrlSyntax: host names", () => {
  it.each([
    "http://localhost/",
    "http://LOCALHOST./",
    "http://localhost./",
    "http://x.localhost/",
    "http://a.b.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://metadata.google.internal/",
    "http://db.internal./",
    "http://localhost../",
    "http://LOCALHOST.../",
    "http://a.local../",
    "http://b.internal../",
    "http://x.localhost../",
  ])("blocks %s", (input) => {
    expect(codeOf(input)).toBe("url-host-blocked");
  });

  it.each(["https://localhost.example.com/", "https://mylocal.com/", "https://internal.example.com/", "https://notlocalhost.com/"])(
    "accepts %s",
    (input) => {
      expect(codeOf(input)).toBe("ok");
    }
  );

  it("checks the port before the host name", () => {
    expect(codeOf("http://localhost:3000/")).toBe("url-port-blocked");
  });
});

describe("checkUrlSyntax: IP literals", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://168.63.129.16/",
    "http://172.16.0.1/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[2001:db8::1]/",
  ])("blocks %s", (input) => {
    expect(codeOf(input)).toBe("url-address-blocked");
  });

  it.each([
    ["decimal", "http://2130706433/"],
    ["octal", "http://0177.0.0.1/"],
    ["hex dotted", "http://0x7f.0.0.1/"],
    ["hex number", "http://0x7f000001/"],
    ["short form", "http://127.1/"],
    ["decimal metadata", "http://2852039166/"],
    ["hex metadata", "http://0xa9fea9fe/"],
    ["octal 10/8", "http://012.0.0.1/"],
  ])("blocks the %s spelling %s", (_label, input) => {
    expect(codeOf(input)).toBe("url-address-blocked");
  });

  it.each(["http://8.8.8.8/", "https://93.184.216.34/", "http://[2606:4700:4700::1111]/", "https://[2a00:1450:4001::1]/"])(
    "accepts the public literal %s",
    (input) => {
      expect(codeOf(input)).toBe("ok");
    }
  );
});

describe("checkUrlSyntax: normalisation", () => {
  it("drops the fragment", () => {
    const result = checkUrlSyntax("https://example.com/p?q=1#frag");
    expect(result).toEqual({ ok: true, url: "https://example.com/p?q=1", hostname: "example.com" });
  });

  it("drops an empty fragment marker", () => {
    const result = checkUrlSyntax("https://example.com/#");
    expect(result.ok && result.url).toBe("https://example.com/");
  });

  it("returns the normalised form of the URL", () => {
    const result = checkUrlSyntax("HTTP://Example.COM:80/a/../b");
    expect(result).toEqual({ ok: true, url: "http://example.com/b", hostname: "example.com" });
  });

  it("returns the canonical form of a public IPv4 spelled as a number", () => {
    const result = checkUrlSyntax("http://134744072/");
    expect(result).toEqual({ ok: true, url: "http://8.8.8.8/", hostname: "8.8.8.8" });
  });
});

describe("checkUrlSyntax: no allowed-origin bypass", () => {
  it("takes no allowed origin: a second argument holds only options", () => {
    expect(checkUrlSyntax.length).toBeLessThanOrEqual(2);
    expect(codeOf("http://localhost/")).toBe("url-host-blocked");
    expect(codeOf("http://127.0.0.1/")).toBe("url-address-blocked");
  });

  it("applies the host name rules to every host", () => {
    expect(codeOf("https://demo.example.com/boo-tique")).toBe("ok");
    expect(codeOf("http://localhost/")).toBe("url-host-blocked");
  });

  it("still applies the port rule to a local name", () => {
    expect(codeOf("http://localhost:3000/")).toBe("url-port-blocked");
  });

  it("still applies the credentials rule", () => {
    expect(codeOf("https://user@demo.example.com/")).toBe("url-credentials-blocked");
  });

  it("still applies the scheme rule", () => {
    expect(codeOf("ftp://demo.example.com/")).toBe("url-scheme-blocked");
  });

  it("still applies the length rule", () => {
    expect(codeOf("https://demo.example.com/" + "a".repeat(MAX_URL_LENGTH))).toBe("url-too-long");
  });
});

describe("URL_SYNTAX_CHECK_ORDER", () => {
  it("lists the failure codes in the order the checks run", () => {
    expect(URL_SYNTAX_CHECK_ORDER).toEqual([
      "url-too-long",
      "url-invalid",
      "url-scheme-blocked",
      "url-credentials-blocked",
      "url-port-blocked",
      "url-host-blocked",
      "url-address-blocked",
    ]);
  });
});

type Answer = readonly string[] | Error;

/** A fake resolver: a map from host name to addresses or an error, with a call log. */
function fakeResolver(answers: Record<string, Answer>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolveAddresses(hostname: string): Promise<readonly string[]> {
      calls.push(hostname);
      const answer = answers[hostname];
      if (answer === undefined) throw new Error("no answer scripted for " + hostname);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

async function checkedCode(input: string, resolver: Resolver): Promise<string> {
  const result = await checkUrl(input, { resolver });
  return result.ok ? "ok" : result.code;
}

describe("checkUrl: DNS answers", () => {
  it("accepts a name that resolves to a public IPv4 address", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("ok");
    expect(resolver.calls).toEqual(["example.com"]);
  });

  it("returns the normalised URL and host name on success", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34"] });
    const result = await checkUrl("HTTPS://Example.COM/a#frag", { resolver });
    expect(result).toEqual({ ok: true, url: "https://example.com/a", hostname: "example.com" });
  });

  it("blocks a name when one of several answers is private", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34", "10.0.0.5"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks a name when the private answer comes first", async () => {
    const resolver = fakeResolver({ "example.com": ["10.0.0.5", "93.184.216.34"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("accepts a public IPv6 answer", async () => {
    const resolver = fakeResolver({ "example.com": ["2606:4700:4700::1111"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("ok");
  });

  it("accepts a mix of public IPv4 and IPv6 answers", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34", "2606:4700:4700::1111"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("ok");
  });

  it("blocks an IPv6 loopback answer", async () => {
    const resolver = fakeResolver({ "example.com": ["::1"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks a public IPv4 answer next to a blocked IPv6 answer", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34", "fe80::1"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks an IPv4-mapped private IPv6 answer", async () => {
    const resolver = fakeResolver({ "example.com": ["::ffff:10.0.0.1"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks an IPv4-mapped IPv6 answer in hex spelling", async () => {
    const resolver = fakeResolver({ "example.com": ["::ffff:a00:1"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("accepts an IPv4-mapped public IPv6 answer", async () => {
    const resolver = fakeResolver({ "example.com": ["::ffff:8.8.8.8"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("ok");
  });

  it("blocks the cloud metadata address as an answer", async () => {
    const resolver = fakeResolver({ "example.com": ["169.254.169.254"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks a loopback answer for a name that only looks public", async () => {
    const resolver = fakeResolver({ "localhost.localdomain": ["127.0.0.1"] });
    expect(await checkedCode("http://localhost.localdomain/", resolver)).toBe("url-address-blocked");
  });

  it("blocks an answer that is not an IP address", async () => {
    const resolver = fakeResolver({ "example.com": ["banana"] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("blocks an empty answer string", async () => {
    const resolver = fakeResolver({ "example.com": [""] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("url-address-blocked");
  });

  it("gives dns-failed when the resolver rejects", async () => {
    const resolver = fakeResolver({ "example.com": new Error("ENOTFOUND") });
    expect(await checkedCode("https://example.com/", resolver)).toBe("dns-failed");
  });

  it("gives dns-failed when the resolver returns no address", async () => {
    const resolver = fakeResolver({ "example.com": [] });
    expect(await checkedCode("https://example.com/", resolver)).toBe("dns-failed");
  });

  it("does not put the resolver error text into the result", async () => {
    const resolver = fakeResolver({ "example.com": new Error("sk-test-sentinel") });
    const result = await checkUrl("https://example.com/", { resolver });
    expect(JSON.stringify(result)).not.toContain("sk-test-sentinel");
  });
});

describe("checkUrl: when the resolver is not called", () => {
  it.each(["http://8.8.8.8/", "https://93.184.216.34/", "http://[2606:4700:4700::1111]/", "http://134744072/"])(
    "never resolves the public IP literal %s",
    async (input) => {
      const resolver = fakeResolver({});
      expect(await checkedCode(input, resolver)).toBe("ok");
      expect(resolver.calls).toHaveLength(0);
    }
  );

  it.each([
    ["a blocked IP literal", "http://127.0.0.1/", "url-address-blocked"],
    ["a blocked host name", "http://localhost/", "url-host-blocked"],
    ["a bad scheme", "ftp://example.com/", "url-scheme-blocked"],
    ["credentials", "https://user@example.com/", "url-credentials-blocked"],
    ["a bad port", "https://example.com:8080/", "url-port-blocked"],
    ["an unparsable URL", "not a url", "url-invalid"],
    ["a long URL", "https://example.com/" + "a".repeat(MAX_URL_LENGTH), "url-too-long"],
  ])("never resolves after a syntax failure: %s", async (_label, input, code) => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34"] });
    expect(await checkedCode(input, resolver)).toBe(code);
    expect(resolver.calls).toHaveLength(0);
  });

  it("resolves exactly once for a name", async () => {
    const resolver = fakeResolver({ "example.com": ["93.184.216.34"] });
    await checkedCode("https://example.com/", resolver);
    expect(resolver.calls).toHaveLength(1);
  });
});

describe("checkUrl: no allowed-origin bypass", () => {
  it("has no allowOrigin option in its options type", () => {
    const options: Parameters<typeof checkUrl>[1] = { resolver: fakeResolver({}) };
    expect(Object.keys(options)).toEqual(["resolver"]);
  });

  it("blocks a host that resolves to a private address, whatever the host is", async () => {
    const resolver = fakeResolver({ "demo.example.com": ["10.0.0.1"] });
    expect(await checkedCode("https://demo.example.com/boo-tique", resolver)).toBe("url-address-blocked");
    expect(resolver.calls).toEqual(["demo.example.com"]);
  });

  it("accepts a host that resolves to a public address", async () => {
    const resolver = fakeResolver({ "demo.example.com": ["93.184.216.34"] });
    expect(await checkedCode("https://demo.example.com/", resolver)).toBe("ok");
  });

  it("requires every host to resolve", async () => {
    const resolver = fakeResolver({ "demo.example.com": new Error("ENOTFOUND") });
    expect(await checkedCode("https://demo.example.com/", resolver)).toBe("dns-failed");
  });

  it("requires an answer for every host", async () => {
    const resolver = fakeResolver({ "demo.example.com": [] });
    expect(await checkedCode("https://demo.example.com/", resolver)).toBe("dns-failed");
  });

  it("blocks credentials before any lookup", async () => {
    const resolver = fakeResolver({ "demo.example.com": ["93.184.216.34"] });
    expect(await checkedCode("https://user@demo.example.com/", resolver)).toBe("url-credentials-blocked");
    expect(resolver.calls).toHaveLength(0);
  });

  it("blocks a non-default port before any lookup", async () => {
    const resolver = fakeResolver({ "demo.example.com": ["93.184.216.34"] });
    expect(await checkedCode("https://demo.example.com:8443/", resolver)).toBe("url-port-blocked");
    expect(resolver.calls).toHaveLength(0);
  });

  it("blocks a host name with trailing dots before any lookup", async () => {
    const resolver = fakeResolver({});
    expect(await checkedCode("http://localhost../", resolver)).toBe("url-host-blocked");
    expect(resolver.calls).toHaveLength(0);
  });
});
