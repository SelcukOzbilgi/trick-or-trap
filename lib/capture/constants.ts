/**
 * Named deadlines and limits of the page capture. Every deadline or limit used by
 * `lib/capture` is read from here.
 */

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

/** Height cap of the single clipped image, in CSS px. */
export const SCREENSHOT_MAX_HEIGHT_PX = 8_000;
/** Tiled mode starts when `fullHeight × devicePixelRatio` is above this value. */
export const TILE_MODE_THRESHOLD_PX = 30_000;
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
export const SESSION_TIMEOUT_DEFAULT_MINUTES = 2;
export const SESSION_TIMEOUT_MIN_MINUTES = 1;
export const SESSION_TIMEOUT_MAX_MINUTES = 5;

/** Longest `detail` text of an error, in characters. */
export const MAX_DETAIL_CHARS = 200;
