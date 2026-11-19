// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FORBIDDEN_ATTRIBUTE_FRAGMENTS } from "@/lib/capture/constants";
import { checkUrlSyntax } from "@/lib/capture/url-check";
import {
  FIXTURE_ALIGNMENT,
  FIXTURE_CLOBBER_NAMES,
  FIXTURE_CLOBBER_TEXT,
  FIXTURE_FORBIDDEN_ORIGIN,
  FIXTURE_RESULTS,
  FIXTURE_TAGS,
  buildAlignmentPage,
  buildBlobWorkerSource,
  buildClobberPage,
  buildFramePage,
  buildMainPage,
  buildPopupPage,
  buildRedirectLocation,
  buildServiceWorkerScript,
  buildSharedWorkerScript,
  buildWorkerScript,
  fixtureResponse,
  fixtureTagUrl,
  readFixtureEnv,
  type FixtureDocument,
} from "@/lib/capture-fixture/pages";
import { TEST_ID_ATTRIBUTE } from "../capture/helpers/forbidden-attribute";

const ALT = "https://alt.example.com";
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const RESULT_LIST = '<ul id="fixture-results">';

const HTML_PAGES: Record<string, string> = {
  main: buildMainPage({ altOrigin: ALT }),
  "main without alt": buildMainPage({}),
  "frame same": buildFramePage("same"),
  "frame cross": buildFramePage("cross"),
  popup: buildPopupPage(),
  alignment: buildAlignmentPage(),
  clobber: buildClobberPage(),
};

const DOCUMENTS: Record<FixtureDocument, string> = {
  main: HTML_PAGES.main,
  "frame-same": HTML_PAGES["frame same"],
  "frame-cross": HTML_PAGES["frame cross"],
  "worker-script": buildWorkerScript(),
  "shared-script": buildSharedWorkerScript(),
  "service-worker-script": buildServiceWorkerScript(),
  "popup-page": HTML_PAGES.popup,
  redirect: buildRedirectLocation(),
};

const ALL_OUTPUTS: Record<string, string> = {
  ...HTML_PAGES,
  worker: DOCUMENTS["worker-script"],
  shared: DOCUMENTS["shared-script"],
  "service worker": DOCUMENTS["service-worker-script"],
  redirect: DOCUMENTS.redirect,
};

/** Number of documents that name the URL, where the URL is not the start of a longer one. */
function documentsNaming(url: string): string[] {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}(?![\\w-])`);
  return Object.entries(DOCUMENTS)
    .filter(([, text]) => pattern.test(text))
    .map(([name]) => name);
}

describe("fixture constants", () => {
  it("keeps the forbidden origin on a blocked port", () => {
    expect(FIXTURE_FORBIDDEN_ORIGIN).toBe("https://example.org:8443");
  });

  it("builds a tag URL under /ff/", () => {
    expect(fixtureTagUrl("img")).toBe("https://example.org:8443/ff/img");
  });

  it("lists distinct tags, each refused by the real syntax check", () => {
    const tags = FIXTURE_TAGS.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const entry of FIXTURE_TAGS) {
      expect(entry.url).toBe(fixtureTagUrl(entry.tag));
      expect(checkUrlSyntax(entry.url)).toEqual({ ok: false, code: "url-port-blocked" });
    }
  });

  it("gives every tag a case and the document that holds it", () => {
    const cases = new Set(FIXTURE_TAGS.map((entry) => entry.case));
    expect([...cases].sort()).toEqual(["cross-site", "popup", "redirect", "same-site", "service-worker"]);
    for (const entry of FIXTURE_TAGS) {
      expect(entry.source.length).toBeGreaterThan(0);
      expect(Object.keys(DOCUMENTS)).toContain(entry.document);
    }
  });

  it("names every result once", () => {
    const names = Object.values(FIXTURE_RESULTS);
    expect(new Set(names).size).toBe(names.length);
    expect(FIXTURE_RESULTS.workerUrlRan).toBe("worker-url-ran");
    expect(FIXTURE_RESULTS.wsError).toBe("ws-error");
    expect(FIXTURE_RESULTS.cspConnectViolation).toBe("csp-connect-violation");
  });
});

describe("every HTML builder", () => {
  it.each(Object.keys(HTML_PAGES))("%s has the robots meta tag and the result list", (name) => {
    const html = HTML_PAGES[name];
    expect(html).toContain(ROBOTS_META);
    expect(html).toContain(RESULT_LIST);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});

describe("main page: sources", () => {
  const html = HTML_PAGES.main;

  it("holds every same-site source with its own tag", () => {
    const sameSite = FIXTURE_TAGS.filter((entry) => entry.case === "same-site" && entry.document === "main");
    expect(sameSite.map((entry) => entry.tag).sort()).toEqual(
      ["beacon", "css-import", "eventsource", "fetch", "font", "frame-src", "img", "prefetch", "worker-blob"].sort(),
    );
    for (const entry of sameSite) {
      expect(html).toContain(entry.url);
    }
  });

  it("holds the markup sources", () => {
    expect(html).toContain(`<img `);
    expect(html).toContain(`rel="prefetch"`);
    expect(html).toContain(`@import url("${fixtureTagUrl("css-import")}")`);
    expect(html).toContain("@font-face");
    expect(html).toContain(`<iframe src="${fixtureTagUrl("frame-src")}"`);
    expect(html).toContain(`<iframe src="/capture-fixture/frame?variant=same"`);
  });

  it("holds the script sources", () => {
    for (const needle of [
      "fetch(",
      "sendBeacon(",
      "new EventSource(",
      "new Worker(",
      "new SharedWorker(",
      "serviceWorker.register(",
      "new WebSocket(",
      "securitypolicyviolation",
      "openFixturePopups",
    ]) {
      expect(html).toContain(needle);
    }
  });

  it("starts both dedicated workers and the shared worker from their own files", () => {
    expect(html).toContain('"/capture-fixture/worker.js"');
    expect(html).toContain('"/capture-fixture/shared.js"');
    expect(html).toContain('"/capture-fixture/sw.js"');
    expect(html).toContain(JSON.stringify(buildBlobWorkerSource("worker-blob")));
  });

  it("opens a WebSocket to a wss address", () => {
    expect(html).toMatch(/new WebSocket\("wss:\/\/[a-z0-9.-]+\//);
  });

  it("writes outcomes as list items into the result list", () => {
    expect(html).toContain('getElementById("fixture-results")');
    expect(html).toContain('createElement("li")');
    expect(html).toContain('"result "');
    const frame = HTML_PAGES["frame cross"];
    for (const name of Object.values(FIXTURE_RESULTS)) {
      expect(html.includes(name) || frame.includes(name)).toBe(true);
    }
  });

  it("defines the popup opener as a plain global function", () => {
    expect(html).toContain("window.openFixturePopups = function");
    expect(html).toContain(JSON.stringify(fixtureTagUrl("popup-nav")));
    expect(html).toContain('"/capture-fixture/popup"');
  });
});

describe("cross-site frame", () => {
  it("appears for an https alt origin", () => {
    const html = buildMainPage({ altOrigin: ALT });
    expect(html).toContain(`<iframe src="${ALT}/capture-fixture/frame?variant=cross"`);
    expect(html).toContain(JSON.stringify(ALT));
  });

  it("is absent without an alt origin", () => {
    const html = buildMainPage({});
    expect(html).not.toContain("variant=cross");
    expect(html).not.toContain("alt.example.com");
  });

  it.each(["http://alt.example.com", "alt.example.com", "", "https://alt.example.com/path", "https://user:pw@alt.example.com", "javascript:alert(1)"])(
    "is absent for the alt origin %j",
    (value) => {
      const html = buildMainPage({ altOrigin: value });
      expect(html).not.toContain("variant=cross");
    },
  );

  it("is not embedded for an alt origin with a trailing slash that carries a path", () => {
    expect(buildMainPage({ altOrigin: "https://alt.example.com/x/" })).not.toContain("variant=cross");
  });

  it("posts loaded to its parent", () => {
    const frame = buildFramePage("cross");
    expect(frame).toContain('parent.postMessage("loaded", "*")');
    expect(frame).toContain(fixtureTagUrl("cross-img"));
    expect(frame).toContain(JSON.stringify(buildBlobWorkerSource("cross-worker")));
  });

  it("is listened for by the main page", () => {
    const html = buildMainPage({ altOrigin: ALT });
    expect(html).toContain('addEventListener("message"');
    expect(html).toContain('"loaded"');
    expect(html).toContain(FIXTURE_RESULTS.crossFrameLoaded);
  });

  it("is a same-site frame with one forbidden image for the same variant", () => {
    const frame = buildFramePage("same");
    expect(frame).toContain(fixtureTagUrl("frame-img"));
    expect(frame).not.toContain("postMessage");
    expect(frame).not.toContain(fixtureTagUrl("cross-img"));
  });
});

describe("tags and documents", () => {
  it.each(FIXTURE_TAGS.map((entry) => [entry.tag, entry] as const))("tag %s sits in exactly its own document", (_tag, entry) => {
    expect(documentsNaming(entry.url)).toEqual([entry.document]);
  });

  it("popup page holds its own image tag", () => {
    expect(buildPopupPage()).toContain(fixtureTagUrl("popup-img"));
  });

  it("redirect target is a tag URL", () => {
    expect(buildRedirectLocation()).toBe(fixtureTagUrl("redirect"));
  });
});

describe("scripts fetch their tag first", () => {
  it("dedicated worker script", () => {
    const script = buildWorkerScript();
    expect(script.trimStart().startsWith(`fetch(${JSON.stringify(fixtureTagUrl("worker-url"))}`)).toBe(true);
    expect(script).toContain('postMessage("RAN")');
    expect(script.indexOf("fetch(")).toBeLessThan(script.indexOf("postMessage"));
  });

  it("shared worker script", () => {
    const script = buildSharedWorkerScript();
    expect(script.trimStart().startsWith(`fetch(${JSON.stringify(fixtureTagUrl("shared-worker"))}`)).toBe(true);
    expect(script).toContain("onconnect");
    expect(script).toContain('postMessage("RAN")');
  });

  it("service worker script fetches on load and in install", () => {
    const script = buildServiceWorkerScript();
    expect(script.trimStart().startsWith(`fetch(${JSON.stringify(fixtureTagUrl("sw-script"))}`)).toBe(true);
    expect(script).toContain('addEventListener("install"');
    expect(script).toContain(fixtureTagUrl("sw-install"));
  });

  it.each(["worker-blob", "cross-worker"])("blob worker source of %s", (tag) => {
    const source = buildBlobWorkerSource(tag);
    expect(source.startsWith(`fetch(${JSON.stringify(fixtureTagUrl(tag))}`)).toBe(true);
    expect(source).toContain('postMessage("RAN")');
  });
});

describe("alignment page", () => {
  const html = buildAlignmentPage();

  it("is 5,000 px tall with a 100vh hero", () => {
    expect(FIXTURE_ALIGNMENT.pageHeightPx).toBe(5000);
    expect(html).toContain("height: 5000px");
    expect(html).toContain("height: 100vh");
  });

  it("has wrapping paragraphs", () => {
    expect((html.match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("has a solid red 200 by 40 marker centred at y 2,500 with its own text", () => {
    expect(FIXTURE_ALIGNMENT).toMatchObject({ markerTopPx: 2500, markerWidthPx: 200, markerHeightPx: 40, markerColor: "rgb(255, 0, 0)" });
    expect(html).toContain("background: rgb(255, 0, 0)");
    expect(html).toContain("left: 50%");
    expect(html).toContain("top: 2500px");
    expect(html).toContain("width: 200px");
    expect(html).toContain("height: 40px");
    expect(html).toMatch(/<div id="marker"[^>]*>[^<]+<\/div>/);
  });
});

describe("clobber page", () => {
  const html = buildClobberPage();

  it("has a form with an input for each clobbering name", () => {
    expect(FIXTURE_CLOBBER_NAMES).toEqual([
      "tagName",
      "children",
      "childNodes",
      "attributes",
      "getAttribute",
      "hasAttribute",
      "getBoundingClientRect",
      "textContent",
      "innerText",
      "nodeType",
      "parentElement",
    ]);
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    for (const name of FIXTURE_CLOBBER_NAMES) {
      expect(form).toContain(`<input type="text" name="${name}">`);
    }
  });

  it("holds a paragraph of known text inside the form", () => {
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    expect(form).toContain(`<p>${FIXTURE_CLOBBER_TEXT}</p>`);
    expect(FIXTURE_CLOBBER_TEXT.length).toBeGreaterThan(20);
  });
});

describe("what no output holds", () => {
  it.each(Object.keys(ALL_OUTPUTS))("%s has no test-id attribute and no data- attribute", (name) => {
    const text = ALL_OUTPUTS[name];
    expect(text.toLowerCase()).not.toContain(TEST_ID_ATTRIBUTE);
    expect(text).not.toMatch(/\bdata-/i);
  });

  it.each(Object.keys(HTML_PAGES))("%s has no attribute name that the capture code treats as a hook", (name) => {
    const parsed = new DOMParser().parseFromString(HTML_PAGES[name], "text/html");
    for (const element of parsed.querySelectorAll("script, style")) {
      element.remove();
    }
    const names: string[] = [];
    for (const element of parsed.querySelectorAll("*")) {
      for (const attr of Array.from(element.attributes)) {
        names.push(attr.name.toLowerCase());
      }
    }
    expect(names.length).toBeGreaterThan(0);
    for (const attrName of names) {
      for (const fragment of FORBIDDEN_ATTRIBUTE_FRAGMENTS) {
        expect(attrName).not.toContain(fragment);
      }
    }
  });

  it("has no word that names an outcome in the markup attributes of the main page", () => {
    expect(HTML_PAGES.main).not.toMatch(/\s(verdict|expected|no-flag|ground-truth|lookalike)=/i);
  });
});

describe("source of pages.ts", () => {
  const source = readFileSync("lib/capture-fixture/pages.ts", "utf8");

  it("imports nothing from lib/capture", () => {
    const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    const dynamic = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    for (const specifier of [...specifiers, ...dynamic]) {
      expect(specifier).not.toMatch(/(^|\/)capture(\/|$)/);
    }
  });

  it("does not name the test-id attribute", () => {
    expect(source.toLowerCase()).not.toContain(TEST_ID_ATTRIBUTE);
  });
});

describe("readFixtureEnv", () => {
  it("turns routes off and sets no alt origin for an empty environment", () => {
    expect(readFixtureEnv({})).toEqual({ enabled: false, altOrigin: undefined });
  });

  it("turns routes on only for exactly `on`", () => {
    expect(readFixtureEnv({ CAPTURE_FIXTURE_ROUTES: "on" }).enabled).toBe(true);
    for (const value of ["", "off", "On", "ON", " on", "on ", "true", "1", "yes"]) {
      expect(readFixtureEnv({ CAPTURE_FIXTURE_ROUTES: value }).enabled).toBe(false);
    }
  });

  it("accepts an https origin, with or without a bare slash", () => {
    expect(readFixtureEnv({ CAPTURE_FIXTURE_ALT_ORIGIN: ALT }).altOrigin).toBe(ALT);
    expect(readFixtureEnv({ CAPTURE_FIXTURE_ALT_ORIGIN: `${ALT}/` }).altOrigin).toBe(ALT);
  });

  it.each(["", "http://alt.example.com", "alt.example.com", "https://alt.example.com/p", "https://alt.example.com/?q=1", "https://u:p@alt.example.com", "ftp://alt.example.com", "not a url"])(
    "ignores the alt origin %j",
    (value) => {
      expect(readFixtureEnv({ CAPTURE_FIXTURE_ALT_ORIGIN: value }).altOrigin).toBeUndefined();
    },
  );

  it("reads the alt origin whatever the routes switch says", () => {
    expect(readFixtureEnv({ CAPTURE_FIXTURE_ROUTES: "off", CAPTURE_FIXTURE_ALT_ORIGIN: ALT })).toEqual({ enabled: false, altOrigin: ALT });
  });
});

describe("fixtureResponse", () => {
  const body = { kind: "body", contentType: "text/html; charset=utf-8", body: "<p>x</p>" } as const;

  it.each([{}, { CAPTURE_FIXTURE_ROUTES: "off" }, { CAPTURE_FIXTURE_ROUTES: "On" }, { CAPTURE_FIXTURE_ROUTES: "" }])(
    "answers 404 with an empty body for %j and never runs the producer",
    async (env) => {
      const produce = vi.fn(() => body);
      const response = fixtureResponse(env, produce);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(produce).not.toHaveBeenCalled();
    },
  );

  it("answers 200 with the body and the headers when the switch is on", async () => {
    const produce = vi.fn(() => body);
    const response = fixtureResponse({ CAPTURE_FIXTURE_ROUTES: "on", CAPTURE_FIXTURE_ALT_ORIGIN: ALT }, produce);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>x</p>");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(produce).toHaveBeenCalledWith({ enabled: true, altOrigin: ALT });
  });

  it("answers 302 with a Location for a redirect", async () => {
    const response = fixtureResponse({ CAPTURE_FIXTURE_ROUTES: "on" }, () => ({ kind: "redirect", location: fixtureTagUrl("redirect") }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(fixtureTagUrl("redirect"));
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("reads the switch at call time", () => {
    const env: Record<string, string | undefined> = {};
    expect(fixtureResponse(env, () => body).status).toBe(404);
    env.CAPTURE_FIXTURE_ROUTES = "on";
    expect(fixtureResponse(env, () => body).status).toBe(200);
  });
});
