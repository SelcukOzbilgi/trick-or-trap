/**
 * Builders of the test-only fixture pages the opt-in live test captures.
 *
 * Pure: strings in, strings out. Nothing here touches the network, the file system or
 * `process.env` (the caller passes the environment). This module imports nothing from the
 * capture code, so the fixture cannot depend on what it exercises.
 *
 * The main page starts one request from every source the browser-level guard has to see.
 * Each source aims at its own "forbidden tag" URL on a blocked port, so a refusal of that
 * URL shows which source was seen. Outcomes are written as list items into
 * `<ul id="fixture-results">`, so the normal page snapshot carries them. The pages carry no
 * attribute that capture or detector code reads as a hook, and no `data-` attribute.
 */

/** Origin of every forbidden tag URL. Port 8443 is refused by the syntax check (`url-port-blocked`). */
export const FIXTURE_FORBIDDEN_ORIGIN = "https://example.org:8443";

/** The URL a fixture source requests for a tag. */
export function fixtureTagUrl(tag: string): string {
  return `${FIXTURE_FORBIDDEN_ORIGIN}/ff/${tag}`;
}

/** The document (builder output) that holds the URL of a tag. */
export type FixtureDocument =
  | "main"
  | "frame-same"
  | "frame-cross"
  | "worker-script"
  | "shared-script"
  | "service-worker-script"
  | "popup-page"
  | "redirect";

/**
 * Which live case a tag belongs to. `same-site` tags are the expected refusals of the main
 * page; `cross-site` tags need an https alt origin; `popup` tags need a gesture;
 * `service-worker` tags are never requested because the script itself is refused;
 * `redirect` is the target of the fixture redirect route.
 */
export type FixtureTagCase = "same-site" | "cross-site" | "popup" | "service-worker" | "redirect";

export type FixtureTag = {
  tag: string;
  url: string;
  /** The request source, in words. */
  source: string;
  document: FixtureDocument;
  case: FixtureTagCase;
};

const TAG_ROWS: ReadonlyArray<readonly [string, string, FixtureDocument, FixtureTagCase]> = [
  ["img", "img element", "main", "same-site"],
  ["fetch", "fetch with no-cors", "main", "same-site"],
  ["beacon", "sendBeacon", "main", "same-site"],
  ["eventsource", "EventSource", "main", "same-site"],
  ["prefetch", "link rel=prefetch", "main", "same-site"],
  ["css-import", "CSS @import", "main", "same-site"],
  ["font", "@font-face source", "main", "same-site"],
  ["frame-img", "image inside a same-site frame", "frame-same", "same-site"],
  ["frame-src", "same-site frame whose src is forbidden", "main", "same-site"],
  ["worker-url", "dedicated worker started from a URL", "worker-script", "same-site"],
  ["worker-blob", "dedicated worker started from a blob", "main", "same-site"],
  ["shared-worker", "shared worker started from a URL", "shared-script", "same-site"],
  ["cross-img", "image inside the cross-site frame", "frame-cross", "cross-site"],
  ["cross-worker", "blob worker inside the cross-site frame", "frame-cross", "cross-site"],
  ["popup-nav", "popup opened with a forbidden URL", "main", "popup"],
  ["popup-img", "image inside the same-origin popup page", "popup-page", "popup"],
  ["sw-script", "service worker script, first statement", "service-worker-script", "service-worker"],
  ["sw-install", "service worker script, install handler", "service-worker-script", "service-worker"],
  ["redirect", "target of the fixture redirect route", "redirect", "redirect"],
];

export const FIXTURE_TAGS: readonly FixtureTag[] = TAG_ROWS.map(([tag, source, document, tagCase]) => ({
  tag,
  url: fixtureTagUrl(tag),
  source,
  document,
  case: tagCase,
}));

/** Names of the outcomes the fixture scripts write as `result <name>` list items. */
export const FIXTURE_RESULTS = {
  workerUrlRan: "worker-url-ran",
  workerBlobRan: "worker-blob-ran",
  sharedWorkerRan: "shared-worker-ran",
  crossWorkerRan: "cross-worker-ran",
  crossFrameLoaded: "cross-frame-loaded",
  swRegistered: "sw-registered",
  swRejected: "sw-rejected",
  swUnavailable: "sw-unavailable",
  wsOpen: "ws-open",
  wsError: "ws-error",
  cspConnectViolation: "csp-connect-violation",
  popupsOpened: "popups-opened",
} as const;

/** The geometry of the alignment page, for the live test that compares boxes with pixels. */
export const FIXTURE_ALIGNMENT = {
  pageHeightPx: 5000,
  markerTopPx: 2500,
  markerWidthPx: 200,
  markerHeightPx: 40,
  markerColor: "rgb(255, 0, 0)",
} as const;

/** Input names that shadow built-in members of a form element. */
export const FIXTURE_CLOBBER_NAMES: readonly string[] = [
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
];

/** The paragraph inside the clobbering form. The live test looks for it in the snapshot. */
export const FIXTURE_CLOBBER_TEXT = "Clobber check text inside the form";

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const RESULT_LIST = '<ul id="fixture-results"></ul>';
const NO_CORS = '{ mode: "no-cors" }';

/** Escapes a value for a double-quoted HTML attribute or text. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A JSON string literal that is safe inside an inline script element. */
function js(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

type ShellOptions = { title: string; head?: string; style?: string; body: string };

function shell(options: ShellOptions): string {
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    ROBOTS_META,
    `<title>${escapeHtml(options.title)}</title>`,
  ];
  if (options.head !== undefined) lines.push(options.head);
  if (options.style !== undefined) lines.push(`<style>\n${options.style}\n</style>`);
  lines.push("</head>", "<body>", options.body, "</body>", "</html>");
  return lines.join("\n");
}

/** `fetch` of a tag URL, as the first statement of a script. */
function fetchStatement(tag: string): string {
  return `fetch(${JSON.stringify(fixtureTagUrl(tag))}, ${NO_CORS}).catch(function () {});`;
}

/** Source of a blob worker: fetch its tag first, then report that it ran. */
export function buildBlobWorkerSource(tag: string): string {
  return `${fetchStatement(tag)}postMessage("RAN");`;
}

/** Script text of the dedicated worker, served at `/capture-fixture/worker.js`. */
export function buildWorkerScript(): string {
  return `${fetchStatement("worker-url")}\npostMessage("RAN");\n`;
}

/** Script text of the shared worker, served at `/capture-fixture/shared.js`. */
export function buildSharedWorkerScript(): string {
  return `${fetchStatement("shared-worker")}\nonconnect = function (event) {\n  event.ports[0].postMessage("RAN");\n};\n`;
}

/** Script text of the service worker, served at `/capture-fixture/sw.js`. */
export function buildServiceWorkerScript(): string {
  return [
    fetchStatement("sw-script"),
    'self.addEventListener("install", function (event) {',
    `  event.waitUntil(fetch(${JSON.stringify(fixtureTagUrl("sw-install"))}, ${NO_CORS}).catch(function () {}));`,
    "});",
    "",
  ].join("\n");
}

/** Target of the fixture redirect route. */
export function buildRedirectLocation(): string {
  return fixtureTagUrl("redirect");
}

/**
 * The alt origin the cross-site frame is loaded from: an `https` origin with nothing after
 * it but an optional bare slash. Anything else gives `undefined`, so no frame is embedded.
 */
function parseAltOrigin(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (value !== url.origin && value !== `${url.origin}/`) return undefined;
  return url.origin;
}

export type MainPageOptions = { altOrigin?: string };

function mainScript(altOrigin: string | undefined): string {
  const names = FIXTURE_RESULTS;
  return [
    "(function () {",
    '  var list = document.getElementById("fixture-results");',
    "  function add(name) {",
    '    var item = document.createElement("li");',
    '    item.textContent = "result " + name;',
    "    list.appendChild(item);",
    "  }",
    `  var altOrigin = ${altOrigin === undefined ? "null" : js(altOrigin)};`,
    '  document.addEventListener("securitypolicyviolation", function (event) {',
    `    if (String(event.violatedDirective).indexOf("connect-src") === 0) add(${js(names.cspConnectViolation)});`,
    "  });",
    '  window.addEventListener("message", function (event) {',
    `    if (altOrigin !== null && event.origin === altOrigin && event.data === "loaded") add(${js(names.crossFrameLoaded)});`,
    "  });",
    `  fetch(${js(fixtureTagUrl("fetch"))}, ${NO_CORS}).catch(function () {});`,
    `  try { navigator.sendBeacon(${js(fixtureTagUrl("beacon"))}, "x"); } catch (error) {}`,
    "  try {",
    `    var events = new EventSource(${js(fixtureTagUrl("eventsource"))});`,
    "    events.onerror = function () { events.close(); };",
    "  } catch (error) {}",
    "  try {",
    '    var dedicated = new Worker("/capture-fixture/worker.js");',
    `    dedicated.onmessage = function (event) { if (event.data === "RAN") add(${js(names.workerUrlRan)}); };`,
    "  } catch (error) {}",
    "  try {",
    `    var blob = new Blob([${js(buildBlobWorkerSource("worker-blob"))}], { type: "text/javascript" });`,
    "    var blobWorker = new Worker(URL.createObjectURL(blob));",
    `    blobWorker.onmessage = function (event) { if (event.data === "RAN") add(${js(names.workerBlobRan)}); };`,
    "  } catch (error) {}",
    "  try {",
    '    var shared = new SharedWorker("/capture-fixture/shared.js");',
    `    shared.port.onmessage = function (event) { if (event.data === "RAN") add(${js(names.sharedWorkerRan)}); };`,
    "    shared.port.start();",
    "  } catch (error) {}",
    "  if (navigator.serviceWorker) {",
    '    navigator.serviceWorker.register("/capture-fixture/sw.js").then(',
    `      function () { add(${js(names.swRegistered)}); },`,
    `      function () { add(${js(names.swRejected)}); }`,
    "    );",
    "  } else {",
    `    add(${js(names.swUnavailable)});`,
    "  }",
    "  try {",
    '    var socket = new WebSocket("wss://echo.websocket.org/");',
    `    socket.onopen = function () { add(${js(names.wsOpen)}); socket.close(); };`,
    `    socket.onerror = function () { add(${js(names.wsError)}); };`,
    `  } catch (error) { add(${js(names.wsError)}); }`,
    "  window.openFixturePopups = function () {",
    '    window.open("/capture-fixture/popup");',
    `    window.open(${js(fixtureTagUrl("popup-nav"))});`,
    `    add(${js(names.popupsOpened)});`,
    "  };",
    "})();",
  ].join("\n");
}

/** The main page: one request from every source of the fixture table. */
export function buildMainPage(options: MainPageOptions): string {
  const altOrigin = parseAltOrigin(options.altOrigin);
  const frames = [
    '<iframe src="/capture-fixture/frame?variant=same" title="Same-site frame" width="300" height="60"></iframe>',
    `<iframe src="${fixtureTagUrl("frame-src")}" title="Forbidden frame" width="300" height="60"></iframe>`,
  ];
  if (altOrigin !== undefined) {
    frames.push(
      `<iframe src="${escapeHtml(altOrigin)}/capture-fixture/frame?variant=cross" title="Cross-site frame" width="300" height="60"></iframe>`,
    );
  }
  return shell({
    title: "Capture fixture",
    head: `<link rel="prefetch" href="${fixtureTagUrl("prefetch")}">`,
    style: [
      `@import url("${fixtureTagUrl("css-import")}");`,
      `@font-face { font-family: "FixtureFont"; src: url("${fixtureTagUrl("font")}"); }`,
      '.font-probe { font-family: "FixtureFont", serif; }',
    ].join("\n"),
    body: [
      "<h1>Capture fixture</h1>",
      "<p>Test-only page. It starts requests that the capture guard has to refuse.</p>",
      '<p class="font-probe">Font probe text</p>',
      RESULT_LIST,
      `<img src="${fixtureTagUrl("img")}" alt="" width="1" height="1">`,
      ...frames,
      `<script>\n${mainScript(altOrigin)}\n</script>`,
    ].join("\n"),
  });
}

/** A frame page. `cross` also starts a blob worker and tells its parent that it loaded. */
export function buildFramePage(variant: "same" | "cross"): string {
  const image = variant === "same" ? fixtureTagUrl("frame-img") : fixtureTagUrl("cross-img");
  const body = [`<p>${variant === "same" ? "Same-site" : "Cross-site"} frame</p>`, RESULT_LIST, `<img src="${image}" alt="" width="1" height="1">`];
  if (variant === "cross") {
    body.push(
      `<script>\n${[
        "(function () {",
        '  var list = document.getElementById("fixture-results");',
        "  function add(name) {",
        '    var item = document.createElement("li");',
        '    item.textContent = "result " + name;',
        "    list.appendChild(item);",
        "  }",
        "  try {",
        `    var blob = new Blob([${js(buildBlobWorkerSource("cross-worker"))}], { type: "text/javascript" });`,
        "    var worker = new Worker(URL.createObjectURL(blob));",
        `    worker.onmessage = function (event) { if (event.data === "RAN") add(${js(FIXTURE_RESULTS.crossWorkerRan)}); };`,
        "  } catch (error) {}",
        '  window.addEventListener("load", function () {',
        '    parent.postMessage("loaded", "*");',
        "  });",
        "})();",
      ].join("\n")}\n</script>`,
    );
  }
  return shell({ title: `Capture fixture frame (${variant})`, body: body.join("\n") });
}

/** The same-origin popup page. */
export function buildPopupPage(): string {
  return shell({
    title: "Capture fixture popup",
    body: ["<p>Popup page</p>", RESULT_LIST, `<img src="${fixtureTagUrl("popup-img")}" alt="" width="1" height="1">`].join("\n"),
  });
}

/** A tall page with a solid red marker whose box the live test compares with its pixels. */
export function buildAlignmentPage(): string {
  const a = FIXTURE_ALIGNMENT;
  const paragraph =
    "This paragraph repeats a plain sentence so that the line wraps inside the page width and gives the layout something to measure. ";
  return shell({
    title: "Capture fixture alignment",
    style: [
      `body { margin: 0; position: relative; height: ${a.pageHeightPx}px; font: 16px/1.5 sans-serif; background: rgb(255, 255, 255); color: rgb(20, 20, 20); }`,
      ".hero { height: 100vh; background: rgb(230, 230, 240); }",
      "p { margin: 0 0 16px 0; padding: 0 24px; }",
      `#marker { position: absolute; top: ${a.markerTopPx}px; left: 50%; transform: translateX(-50%); width: ${a.markerWidthPx}px; height: ${a.markerHeightPx}px; line-height: ${a.markerHeightPx}px; text-align: center; background: ${a.markerColor}; color: rgb(255, 255, 255); }`,
    ].join("\n"),
    body: [
      '<div class="hero"></div>',
      ...Array.from({ length: 6 }, () => `<p>${paragraph.repeat(4).trim()}</p>`),
      '<div id="marker">Marker</div>',
      RESULT_LIST,
    ].join("\n"),
  });
}

/** A form whose inputs are named like built-in members, with a paragraph of known text inside. */
export function buildClobberPage(): string {
  const inputs = FIXTURE_CLOBBER_NAMES.map((name) => `<input type="text" name="${name}">`);
  return shell({
    title: "Capture fixture clobbering",
    body: ['<form id="clobber-form">', ...inputs, `<p>${FIXTURE_CLOBBER_TEXT}</p>`, "</form>", RESULT_LIST].join("\n"),
  });
}

/** Environment variables, as a plain record. `process.env` fits. */
export type FixtureEnvSource = Readonly<Record<string, string | undefined>>;

export type FixtureEnv = {
  /** True only when `CAPTURE_FIXTURE_ROUTES` is exactly `on`. */
  enabled: boolean;
  /** The validated `https` origin of `CAPTURE_FIXTURE_ALT_ORIGIN`, or `undefined`. */
  altOrigin: string | undefined;
};

/** Reads the fixture switch and the alt origin. Call it per request, never at build time. */
export function readFixtureEnv(source: FixtureEnvSource): FixtureEnv {
  return {
    enabled: source.CAPTURE_FIXTURE_ROUTES === "on",
    altOrigin: parseAltOrigin(source.CAPTURE_FIXTURE_ALT_ORIGIN),
  };
}

export type FixtureContent =
  | { kind: "body"; contentType: string; body: string }
  | { kind: "redirect"; location: string };

/**
 * The answer of one fixture route. With the switch not exactly `on` it is a 404 with an
 * empty body and `produce` is not called. Every answer carries `X-Robots-Tag` and
 * `Cache-Control: no-store`.
 */
export function fixtureResponse(source: FixtureEnvSource, produce: (env: FixtureEnv) => FixtureContent): Response {
  const env = readFixtureEnv(source);
  const headers = new Headers({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" });
  if (!env.enabled) return new Response(null, { status: 404, headers });
  const content = produce(env);
  if (content.kind === "redirect") {
    headers.set("Location", content.location);
    return new Response(null, { status: 302, headers });
  }
  headers.set("Content-Type", content.contentType);
  return new Response(content.body, { status: 200, headers });
}
