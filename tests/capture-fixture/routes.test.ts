import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_FORBIDDEN_ORIGIN, FIXTURE_TAGS } from "@/lib/capture-fixture/pages";

type RouteModule = {
  GET: (request: Request) => Response | Promise<Response>;
  dynamic?: string;
};

type RouteCase = {
  name: string;
  /** Path of the route, relative to the site root. */
  path: string;
  /** Folder of the route file under `app/`. */
  folder: string;
  load: () => Promise<RouteModule>;
  /** Expected status with the switch on. */
  status: 200 | 302;
  /** Expected content type prefix; absent for the redirect. */
  contentType?: string;
  html: boolean;
};

const HTML = "text/html";
const JS = "text/javascript";

const ROUTES: readonly RouteCase[] = [
  {
    name: "main page",
    path: "/capture-fixture",
    folder: "capture-fixture",
    load: () => import("@/app/capture-fixture/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
  {
    name: "frame (same)",
    path: "/capture-fixture/frame?variant=same",
    folder: "capture-fixture/frame",
    load: () => import("@/app/capture-fixture/frame/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
  {
    name: "frame (cross)",
    path: "/capture-fixture/frame?variant=cross",
    folder: "capture-fixture/frame",
    load: () => import("@/app/capture-fixture/frame/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
  {
    name: "worker script",
    path: "/capture-fixture/worker.js",
    folder: "capture-fixture/worker.js",
    load: () => import("@/app/capture-fixture/worker.js/route"),
    status: 200,
    contentType: JS,
    html: false,
  },
  {
    name: "shared worker script",
    path: "/capture-fixture/shared.js",
    folder: "capture-fixture/shared.js",
    load: () => import("@/app/capture-fixture/shared.js/route"),
    status: 200,
    contentType: JS,
    html: false,
  },
  {
    name: "service worker script",
    path: "/capture-fixture/sw.js",
    folder: "capture-fixture/sw.js",
    load: () => import("@/app/capture-fixture/sw.js/route"),
    status: 200,
    contentType: JS,
    html: false,
  },
  {
    name: "popup page",
    path: "/capture-fixture/popup",
    folder: "capture-fixture/popup",
    load: () => import("@/app/capture-fixture/popup/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
  {
    name: "redirect",
    path: "/capture-fixture/redirect",
    folder: "capture-fixture/redirect",
    load: () => import("@/app/capture-fixture/redirect/route"),
    status: 302,
    html: false,
  },
  {
    name: "alignment page",
    path: "/capture-fixture/alignment",
    folder: "capture-fixture/alignment",
    load: () => import("@/app/capture-fixture/alignment/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
  {
    name: "clobbering page",
    path: "/capture-fixture/clobber",
    folder: "capture-fixture/clobber",
    load: () => import("@/app/capture-fixture/clobber/route"),
    status: 200,
    contentType: HTML,
    html: true,
  },
];

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const ALT = "https://alt.example.com";
const SWITCH = "CAPTURE_FIXTURE_ROUTES";
const ALT_NAME = "CAPTURE_FIXTURE_ALT_ORIGIN";
const ROOT = process.cwd();

function request(path: string): Request {
  return new Request(`https://app.example.com${path}`);
}

async function call(route: RouteCase): Promise<Response> {
  const routeModule = await route.load();
  return routeModule.GET(request(route.path));
}

const saved = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  saved.clear();
  setEnv(SWITCH, undefined);
  setEnv(ALT_NAME, undefined);
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe("fixture routes: switch not exactly on", () => {
  const SWITCH_VALUES: ReadonlyArray<readonly [string, string | undefined]> = [
    ["unset", undefined],
    ["off", "off"],
    ["On", "On"],
    ["empty", ""],
    ["padded", " on"],
  ];

  describe.each(SWITCH_VALUES)("with the switch %s", (_label, value) => {
    it.each(ROUTES.map((route) => [route.name, route] as const))("%s answers 404 with an empty body", async (_name, route) => {
      setEnv(SWITCH, value);
      const response = await call(route);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Location")).toBeNull();
    });
  });
});

describe("fixture routes: switch on", () => {
  it.each(ROUTES.map((route) => [route.name, route] as const))("%s answers as required", async (_name, route) => {
    setEnv(SWITCH, "on");
    const response = await call(route);
    expect(response.status).toBe(route.status);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (route.contentType !== undefined) {
      expect(response.headers.get("Content-Type")?.startsWith(route.contentType)).toBe(true);
      const body = await response.text();
      expect(body.length).toBeGreaterThan(0);
      if (route.html) expect(body).toContain(ROBOTS_META);
    }
  });

  it("redirects to a forbidden tag URL with 302", async () => {
    setEnv(SWITCH, "on");
    const redirect = ROUTES.find((route) => route.name === "redirect");
    if (redirect === undefined) throw new Error("redirect case missing");
    const response = await call(redirect);
    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    expect(location).toBe(FIXTURE_TAGS.find((tag) => tag.tag === "redirect")?.url);
    expect(location?.startsWith(`${FIXTURE_FORBIDDEN_ORIGIN}/`)).toBe(true);
    expect(await response.text()).toBe("");
  });

  it("serves the frame variant that the query names", async () => {
    setEnv(SWITCH, "on");
    const frame = await import("@/app/capture-fixture/frame/route");
    const same = await (await frame.GET(request("/capture-fixture/frame?variant=same"))).text();
    const cross = await (await frame.GET(request("/capture-fixture/frame?variant=cross"))).text();
    expect(same).toContain("fixture-results");
    expect(same).not.toContain("loaded");
    expect(cross).toContain("loaded");
    expect(cross).not.toEqual(same);
  });

  it("serves the same frame when the variant is missing or unknown", async () => {
    setEnv(SWITCH, "on");
    const frame = await import("@/app/capture-fixture/frame/route");
    const same = await (await frame.GET(request("/capture-fixture/frame?variant=same"))).text();
    expect(await (await frame.GET(request("/capture-fixture/frame"))).text()).toBe(same);
    expect(await (await frame.GET(request("/capture-fixture/frame?variant=other"))).text()).toBe(same);
  });

  it("serves the worker scripts with their own tag", async () => {
    setEnv(SWITCH, "on");
    const worker = await (await call(ROUTES.find((r) => r.name === "worker script") as RouteCase)).text();
    const shared = await (await call(ROUTES.find((r) => r.name === "shared worker script") as RouteCase)).text();
    const sw = await (await call(ROUTES.find((r) => r.name === "service worker script") as RouteCase)).text();
    expect(worker).toContain("/ff/worker-url");
    expect(shared).toContain("/ff/shared-worker");
    expect(sw).toContain("/ff/sw-script");
  });
});

describe("fixture routes: environment is read at request time", () => {
  it("follows a change of the switch between two calls of the same handler", async () => {
    const main = ROUTES[0];
    setEnv(SWITCH, "on");
    expect((await call(main)).status).toBe(200);
    setEnv(SWITCH, "off");
    expect((await call(main)).status).toBe(404);
    setEnv(SWITCH, "on");
    expect((await call(main)).status).toBe(200);
  });

  it("embeds the cross-site frame only while the alt origin is an https origin", async () => {
    const main = ROUTES[0];
    setEnv(SWITCH, "on");
    expect(await (await call(main)).text()).not.toContain("variant=cross");
    setEnv(ALT_NAME, ALT);
    expect(await (await call(main)).text()).toContain(`${ALT}/capture-fixture/frame?variant=cross`);
    setEnv(ALT_NAME, "http://alt.example.com");
    expect(await (await call(main)).text()).not.toContain("variant=cross");
    setEnv(ALT_NAME, undefined);
    expect(await (await call(main)).text()).not.toContain("variant=cross");
  });
});

describe("fixture routes: files", () => {
  function routeFolders(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...routeFolders(full));
      else if (entry === "route.ts") out.push(relative(join(ROOT, "app"), dir));
    }
    return out.sort();
  }

  it("has a test case for every route file under app/capture-fixture", () => {
    const expected = [...new Set(ROUTES.map((route) => route.folder))].sort();
    expect(routeFolders(join(ROOT, "app", "capture-fixture"))).toEqual(expected);
  });

  it.each([...new Set(ROUTES.map((route) => route.folder))])("%s exports dynamic force-dynamic and GET", async (folder) => {
    const route = ROUTES.find((candidate) => candidate.folder === folder) as RouteCase;
    const routeModule = await route.load();
    expect(routeModule.dynamic).toBe("force-dynamic");
    expect(typeof routeModule.GET).toBe("function");
  });

  it("imports nothing from lib/capture in any route file", () => {
    for (const folder of new Set(ROUTES.map((route) => route.folder))) {
      const source = readFileSync(join(ROOT, "app", folder, "route.ts"), "utf8");
      expect(source).not.toMatch(/lib\/capture["'/]/);
      expect(source).not.toContain("playwright");
    }
  });

  it("lists no fixture route in a sitemap and disallows them in a robots file when those files exist", () => {
    for (const base of ["app", "public"]) {
      for (const name of ["sitemap.ts", "sitemap.xml", "sitemap.js"]) {
        const file = join(ROOT, base, name);
        if (existsSync(file)) expect(readFileSync(file, "utf8")).not.toContain("capture-fixture");
      }
      for (const name of ["robots.ts", "robots.txt", "robots.js"]) {
        const file = join(ROOT, base, name);
        if (existsSync(file)) expect(readFileSync(file, "utf8")).toContain("/capture-fixture");
      }
    }
  });
});
