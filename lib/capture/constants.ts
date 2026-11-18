/**
 * Named deadlines and limits of the page capture. Every deadline or limit used by
 * `lib/capture` is read from here.
 */

import type { CollectLimits } from "./types";

/** Deadline for each Browser Use API call (create and stop). */
export const API_FETCH_TIMEOUT_MS = 10_000;
/** Deadline for the CDP connection. */
export const CDP_CONNECT_TIMEOUT_MS = 15_000;
/** Deadline for one navigation. */
export const NAVIGATION_TIMEOUT_MS = 15_000;
/** Deadline for the whole capture, counted from the start of `capturePage`. */
export const CAPTURE_TIMEOUT_MS = 45_000;
/** Short wait after `load` for late scripts such as countdown starts. */
export const SETTLE_DELAY_MS = 500;
/** The reload sample is taken only when at least this much of the budget remains. */
export const RELOAD_MIN_REMAINING_MS = 12_000;

/** Longest accepted input URL, in characters. */
export const MAX_URL_LENGTH = 2_048;
/** Ports a URL may name explicitly. */
export const ALLOWED_PORTS: readonly number[] = [80, 443];

/** Element cap of the full sample. */
export const MAX_ELEMENTS = 1_500;
/** Element cap of the reload sample. */
export const MAX_ELEMENTS_LIGHT = 750;
/** Text cap per element in the full sample. */
export const MAX_TEXT_CHARS = 300;
/** Text cap per element in the reload sample. */
export const MAX_TEXT_CHARS_LIGHT = 120;
/** Cap for each recorded attribute value. */
export const MAX_ATTR_CHARS = 200;
/** Longest `tag`, `role`, style string and attribute name kept, in characters. */
export const MAX_TAG_CHARS = 64;
export const MAX_ROLE_CHARS = 64;
export const MAX_STYLE_CHARS = 64;
export const MAX_ATTR_NAME_CHARS = 64;
/** Most attributes kept per element. */
export const MAX_ATTRS_PER_ELEMENT = 32;
/** Deepest element path kept, and the largest child index kept in a path. */
export const MAX_PATH_DEPTH = 256;
export const MAX_PATH_INDEX = 100_000;
/** Longest element id, in characters. `el-` plus 256 indices of 6 digits and a dash is 1,795. */
export const MAX_ELEMENT_ID_CHARS = 2_048;
/** Raw entries examined outside the page, as a multiple of the element cap. */
export const RAW_SCAN_FACTOR = 2;
/** Largest JSON text of an assembled snapshot, in UTF-8 bytes. */
export const MAX_SNAPSHOT_BYTES = 1_500_000;
/** Box movement between the read and the screenshots that counts as a layout shift, in CSS px. */
export const LAYOUT_DRIFT_PX = 4;
/** Largest device pixel ratio and page size taken as real. Larger values are replaced. */
export const MAX_PLAUSIBLE_DPR = 8;
export const MAX_PLAUSIBLE_PX = 1_000_000;

/** Limits the in-page collector applies, so less data crosses CDP. */
export const COLLECT_LIMITS: CollectLimits = {
  maxTagChars: MAX_TAG_CHARS,
  maxRoleChars: MAX_ROLE_CHARS,
  maxStyleChars: MAX_STYLE_CHARS,
  maxAttrsPerElement: MAX_ATTRS_PER_ELEMENT,
  maxAttrNameChars: MAX_ATTR_NAME_CHARS,
  maxPathDepth: MAX_PATH_DEPTH,
};

/** Longest URL of a redirect hop or a final URL, in characters. User input stays at `MAX_URL_LENGTH`. */
export const MAX_HOP_URL_LENGTH = 8_192;
/** A paused request that has no verdict after this long is failed. */
export const GUARD_DECISION_TIMEOUT_MS = 5_000;
/** Most distinct hosts a capture checks for non-document requests. */
export const MAX_REQUEST_HOSTS = 100;
/** The guard sends one `Browser.getVersion` on its session this often. */
export const GUARD_HEARTBEAT_INTERVAL_MS = 2_000;
/** A heartbeat with no answer after this long counts as a lost guard. */
export const GUARD_HEARTBEAT_TIMEOUT_MS = 5_000;
/** Deadline for the whole stop chain (stop call and disconnect). */
export const STOP_TIMEOUT_MS = 10_000;
/** A tagged session older than this is stopped by the sweep helper. */
export const STALE_SESSION_AGE_MS = 120_000;

/**
 * Attribute names that name an outcome. A name that holds one of these fragments is
 * dropped from a snapshot, also when it starts with `aria-`.
 */
export const FORBIDDEN_ATTRIBUTE_FRAGMENTS: readonly string[] = [
  "verdict",
  "pattern",
  "no-flag",
  "lookalike",
  "expected",
  "ground-truth",
];

/** Height cap of the single clipped image, in CSS px. */
export const SCREENSHOT_MAX_HEIGHT_PX = 8_000;
/** Tiled mode starts when `fullHeight`, in CSS px, is above this value. */
export const TILE_MODE_THRESHOLD_CSS_PX = 20_000;
/** Most tiles taken in tiled mode, counted from the top. */
export const MAX_TILES = 10;
/** No further tile starts with less than this left in the whole-capture budget. */
export const TILE_MIN_REMAINING_MS = 3_000;
/** JPEG quality of every screenshot. */
export const SCREENSHOT_JPEG_QUALITY = 70;
/** Limit for the sum of the base64 lengths of all images (4 MiB). */
export const MAX_BASE64_LENGTH = 4_194_304;

/** Viewport requested from the remote browser, in CSS px. */
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

/** Session timeout in minutes: default, smallest and largest accepted value. */
export const SESSION_TIMEOUT_DEFAULT_MINUTES = 1;
export const SESSION_TIMEOUT_MIN_MINUTES = 1;
export const SESSION_TIMEOUT_MAX_MINUTES = 5;

/** Longest `detail` text of an error, in characters. */
export const MAX_DETAIL_CHARS = 200;
