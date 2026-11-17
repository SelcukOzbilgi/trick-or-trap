import { describe, expect, it } from "vitest";
import { MAX_URL_LENGTH } from "@/lib/capture/constants";
import { checkUrlSyntax, URL_SYNTAX_CHECK_ORDER } from "@/lib/capture/url-check";

function codeOf(input: string, allowOrigin: string | null = null): string {
  const result = checkUrlSyntax(input, allowOrigin);
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
    const result = checkUrlSyntax("https://example.com/p?q=1#frag", null);
    expect(result).toEqual({ ok: true, url: "https://example.com/p?q=1", hostname: "example.com" });
  });

  it("drops an empty fragment marker", () => {
    const result = checkUrlSyntax("https://example.com/#", null);
    expect(result.ok && result.url).toBe("https://example.com/");
  });

  it("returns the normalised form of the URL", () => {
    const result = checkUrlSyntax("HTTP://Example.COM:80/a/../b", null);
    expect(result).toEqual({ ok: true, url: "http://example.com/b", hostname: "example.com" });
  });

  it("returns the canonical form of a public IPv4 spelled as a number", () => {
    const result = checkUrlSyntax("http://134744072/", null);
    expect(result).toEqual({ ok: true, url: "http://8.8.8.8/", hostname: "8.8.8.8" });
  });
});

describe("checkUrlSyntax: allow origin", () => {
  const origin = "https://demo.example.com";

  it("skips the host name rules for the exact origin", () => {
    expect(codeOf("https://demo.example.com/boo-tique", origin)).toBe("ok");
  });

  it("skips the host name and address rules for an allowed local name", () => {
    expect(codeOf("http://localhost/", "http://localhost")).toBe("ok");
    expect(codeOf("http://127.0.0.1/", "http://127.0.0.1")).toBe("ok");
  });

  it("still applies the port rule to the allowed origin", () => {
    expect(codeOf("http://localhost:3000/", "http://localhost:3000")).toBe("url-port-blocked");
  });

  it("still applies the credentials rule", () => {
    expect(codeOf("https://user@demo.example.com/", origin)).toBe("url-credentials-blocked");
  });

  it("still applies the scheme rule", () => {
    expect(codeOf("ftp://demo.example.com/", origin)).toBe("url-scheme-blocked");
  });

  it("still applies the length rule", () => {
    expect(codeOf("https://demo.example.com/" + "a".repeat(MAX_URL_LENGTH), origin)).toBe("url-too-long");
  });

  it("does not extend the entry to another scheme, subdomain, parent domain or port", () => {
    expect(codeOf("http://localhost/", "https://localhost")).toBe("url-host-blocked");
    expect(codeOf("https://x.localhost/", "https://localhost")).toBe("url-host-blocked");
    expect(codeOf("https://localhost/", "https://x.localhost")).toBe("url-host-blocked");
    expect(codeOf("http://127.0.0.1/", "https://127.0.0.1")).toBe("url-address-blocked");
    expect(codeOf("https://10.0.0.1/", "https://10.0.0.2")).toBe("url-address-blocked");
  });

  it("applies every rule when there is no allow entry", () => {
    expect(codeOf("http://localhost/", null)).toBe("url-host-blocked");
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
