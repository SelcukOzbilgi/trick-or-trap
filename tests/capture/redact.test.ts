import { describe, expect, it } from "vitest";
import { redactText, toDetail } from "@/lib/capture/redact";

const API_KEY = "sk-test-sentinel";
const SESSION_ID = "sess-sentinel-0001";
const CDP_URL = "wss://sentinel.cdp.browser-use.com/devtools/browser/abcd";
const LIVE_URL = "https://live.example-vendor.test/view/sentinel-live";
const SECRETS = [API_KEY, SESSION_ID, CDP_URL, LIVE_URL];

describe("redactText: websocket and vendor hosts", () => {
  it("removes a wss:// URL", () => {
    const out = redactText("failed wss://abc.cdp.browser-use.com/devtools/x now", []);
    expect(out).not.toContain("wss://");
    expect(out).not.toContain("browser-use.com");
    expect(out).toContain("failed");
    expect(out).toContain("now");
  });

  it("removes a ws:// URL", () => {
    const out = redactText("connect ws://127.0.0.1:9222/y refused", []);
    expect(out).not.toContain("ws://");
    expect(out).not.toContain("9222");
    expect(out).toContain("refused");
  });

  it("removes a bare cdp.browser-use.com host", () => {
    const out = redactText("host abc.cdp.browser-use.com unreachable", []);
    expect(out).not.toContain("cdp.browser-use.com");
    expect(out).toContain("unreachable");
  });

  it("removes an https URL on a cdp.browser-use.com host with port and path", () => {
    const out = redactText("GET https://abc.cdp.browser-use.com:443/p failed", []);
    expect(out).not.toContain("cdp.browser-use.com");
    expect(out).not.toContain("/p");
    expect(out).toContain("failed");
  });

  it("removes several URLs in one string", () => {
    const out = redactText("a wss://one.test/x b ws://two.test/y c", []);
    expect(out).not.toContain("one.test");
    expect(out).not.toContain("two.test");
  });

  it("keeps the ordinary API host", () => {
    const text = "POST https://api.browser-use.com/api/v4/browsers failed";
    expect(redactText(text, [])).toBe(text);
  });
});

describe("redactText: known secrets", () => {
  it("replaces the API key", () => {
    const out = redactText(`bad key ${API_KEY} rejected`, SECRETS);
    expect(out).not.toContain(API_KEY);
    expect(out).toContain("rejected");
  });

  it("replaces the session id", () => {
    expect(redactText(`session ${SESSION_ID} gone`, SECRETS)).not.toContain(SESSION_ID);
  });

  it("replaces the cdpUrl", () => {
    const out = redactText(`connecting to ${CDP_URL} failed`, SECRETS);
    expect(out).not.toContain(CDP_URL);
    expect(out).not.toContain("devtools");
  });

  it("replaces the liveUrl", () => {
    const out = redactText(`see ${LIVE_URL} for more`, SECRETS);
    expect(out).not.toContain("sentinel-live");
    expect(out).not.toContain(LIVE_URL);
  });

  it("replaces a secret that occurs twice in one string", () => {
    const out = redactText(`${API_KEY} and again ${API_KEY}`, SECRETS);
    expect(out).not.toContain(API_KEY);
    expect(out).not.toContain("sentinel");
  });

  it("replaces a secret that is contained in another secret without leaving a rest", () => {
    const out = redactText(`url ${CDP_URL}`, [SESSION_ID, "devtools/browser/abcd", CDP_URL]);
    expect(out).not.toContain("abcd");
    expect(out).not.toContain("devtools");
  });

  it("ignores empty secrets", () => {
    expect(redactText("plain text", ["", "   "])).toBe("plain text");
  });

  it("ignores secrets shorter than 4 characters", () => {
    expect(redactText("a key abc and abc again", ["abc"])).toBe("a key abc and abc again");
  });

  it("ignores null and undefined secrets", () => {
    expect(redactText("plain text", [null, undefined])).toBe("plain text");
  });

  it("leaves ordinary text unchanged", () => {
    const text = "Timeout 15000ms exceeded while waiting for the load event";
    expect(redactText(text, SECRETS)).toBe(text);
  });

  it("does not treat regex characters in a secret as a pattern", () => {
    const secret = "a.b*c+d?";
    const out = redactText(`x ${secret} y axbbcd z`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain("axbbcd");
  });
});

describe("toDetail", () => {
  it("redacts before anything else", () => {
    const out = toDetail(new Error(`bad key ${API_KEY} at ${CDP_URL}`), SECRETS);
    expect(out).toBeDefined();
    expect(out).not.toContain(API_KEY);
    expect(out).not.toContain("wss://");
    expect(out).not.toContain("cdp.browser-use.com");
  });

  it("collapses whitespace", () => {
    expect(toDetail(new Error("one\n\n  two\t three"), [])).toBe("one two three");
  });

  it("cuts to 200 characters", () => {
    const out = toDetail(new Error("x".repeat(500)), []);
    expect(out).toHaveLength(200);
  });

  it("keeps a text of exactly 200 characters", () => {
    expect(toDetail("y".repeat(200), [])).toHaveLength(200);
  });

  it("accepts a string", () => {
    expect(toDetail(`token ${API_KEY} used`, SECRETS)).not.toContain(API_KEY);
    expect(toDetail("plain failure", [])).toBe("plain failure");
  });

  it("accepts undefined", () => {
    expect(toDetail(undefined, SECRETS)).toBeUndefined();
  });

  it("returns undefined for an empty message", () => {
    expect(toDetail(new Error("   "), [])).toBeUndefined();
  });

  it("redacts a secret that would be cut by the length limit", () => {
    const out = toDetail(`${"z".repeat(190)} ${API_KEY}`, SECRETS);
    expect(out).toBeDefined();
    expect(out).not.toContain("sk-test");
    expect((out ?? "").length).toBeLessThanOrEqual(200);
  });
});
