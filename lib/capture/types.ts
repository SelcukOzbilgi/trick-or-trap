/**
 * Shared types, fixed messages and raw page shapes of the page capture.
 *
 * Page text and attributes in a `PageSnapshot` are untrusted input. Every
 * consumer, in particular the LLM judge, must treat them as quoted data and
 * never follow instructions found in them.
 */
import type { PageSnapshot } from "@/lib/types";

export type UrlErrorCode =
  | "url-invalid"
  | "url-too-long"
  | "url-scheme-blocked"
  | "url-credentials-blocked"
  | "url-port-blocked"
  | "url-host-blocked"
  | "url-address-blocked"
  | "dns-failed";

export type CaptureErrorCode =
  | UrlErrorCode
  | "config-invalid"
  | "browser-mode-unsupported"
  | "session-create-failed"
  | "session-create-timeout"
  | "connect-failed"
  | "connect-timeout"
  | "navigation-failed"
  | "navigation-timeout"
  | "navigation-blocked"
  | "page-read-failed"
  | "screenshot-failed"
  | "screenshot-too-large"
  | "snapshot-invalid"
  | "snapshot-too-large"
  | "capture-timeout"
  | "internal-error";

export type CaptureWarningCode =
  | "session-stop-failed"
  | "reload-skipped"
  | "reload-failed"
  | "redirected"
  | "elements-truncated"
  | "screenshot-truncated"
  | "tall-page-tiled"
  | "download-refused"
  | "popup-closed"
  | "request-blocked"
  | "request-host-limit"
  | "layout-shifted";

/** Fixed text per error code. The only source of `CaptureError.message`. */
export const ERROR_MESSAGES: Record<CaptureErrorCode, string> = {
  "url-invalid": "The address is not a valid web address.",
  "url-too-long": "The address is too long.",
  "url-scheme-blocked": "The address scheme is not accepted. Only plain and secure web addresses can be scanned.",
  "url-credentials-blocked": "Addresses that contain a user name or a password are not accepted.",
  "url-port-blocked": "The address uses a port that is not accepted.",
  "url-host-blocked": "The host name is not accepted.",
  "url-address-blocked": "The host points to an address that is not accepted.",
  "dns-failed": "The host name could not be resolved.",
  "config-invalid": "The capture configuration is invalid.",
  "browser-mode-unsupported": "The configured browser mode is not supported.",
  "session-create-failed": "The remote browser session could not be created.",
  "session-create-timeout": "The remote browser session was not created in time.",
  "connect-failed": "The connection to the remote browser failed.",
  "connect-timeout": "The connection to the remote browser took too long.",
  "navigation-failed": "The page could not be opened.",
  "navigation-timeout": "The page took too long to load.",
  "navigation-blocked": "The page navigation was blocked by a safety check.",
  "page-read-failed": "The page content could not be read.",
  "screenshot-failed": "The screenshot could not be taken.",
  "screenshot-too-large": "The screenshots are too large.",
  "snapshot-invalid": "The captured page data is invalid.",
  "snapshot-too-large": "The captured page data is too large.",
  "capture-timeout": "The capture took too long.",
  "internal-error": "An internal error occurred during the capture.",
};

/** Fixed text per warning code. The only source of `CaptureWarning.message`. */
export const WARNING_MESSAGES: Record<CaptureWarningCode, string> = {
  "session-stop-failed": "The remote browser session may not have stopped.",
  "reload-skipped": "The second read after a reload was skipped because little time was left.",
  "reload-failed": "The second read after a reload failed and is missing.",
  redirected: "The page address after loading differs from the requested address.",
  "elements-truncated": "The page has more elements than the cap, so the element list is incomplete.",
  "screenshot-truncated": "The screenshots do not cover the whole page.",
  "tall-page-tiled": "The page is very tall, so it was captured as viewport tiles.",
  "download-refused": "A download started and was cancelled.",
  "popup-closed": "A pop-up page opened and was closed.",
  "request-blocked": "A navigation request was blocked by a safety check.",
  "request-host-limit": "The page contacted more hosts than the limit, so further requests to new hosts were blocked.",
  "layout-shifted": "The page layout moved while it was captured, so markers may be off.",
};

/**
 * `detail` may contain text controlled by the page or by target URLs. It is for
 * server logs only and must never be shown to a user.
 */
export type CaptureError = { code: CaptureErrorCode; message: string; detail?: string };
/** `reason` and `count` are set on `request-blocked`. No warning field holds a URL or host. */
export type CaptureWarning = {
  code: CaptureWarningCode;
  message: string;
  reason?: UrlErrorCode;
  count?: number;
};

/** One JPEG image. All sizes are CSS px (image px equal CSS px with `scale: "css"`). */
export type CaptureImage = {
  offsetY: number; // document Y of the image's top edge
  width: number;
  height: number;
  bytes: Uint8Array;
  base64Length: number; // 4 * ceil(bytes / 3)
};

export type CaptureResult =
  | { ok: true; snapshot: PageSnapshot; images: CaptureImage[]; warnings: CaptureWarning[] }
  | { ok: false; error: CaptureError; warnings: CaptureWarning[] };

/** Thrown inside lib/capture only. `capturePage` catches it and never rethrows. */
export class CaptureFailure extends Error {
  readonly code: CaptureErrorCode;
  readonly detail?: string; // already redacted
  /** True only for an aborted create or a fetch failure with no HTTP response. Default false. */
  readonly reclaim: boolean;

  constructor(code: CaptureErrorCode, detail?: string, options?: { reclaim?: boolean }) {
    super(ERROR_MESSAGES[code]);
    this.name = "CaptureFailure";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
    this.reclaim = options?.reclaim === true;
  }
}

/** Limits the in-page collector applies to what it returns. */
export type CollectLimits = {
  maxTagChars: number;
  maxRoleChars: number;
  maxStyleChars: number;
  maxAttrsPerElement: number;
  maxAttrNameChars: number;
  maxPathDepth: number;
};

export type CollectOptions = {
  maxElements: number;
  maxTextChars: number;
  maxAttrChars: number;
  attributeNames: readonly string[] | "full"; // "full" = the full allowlist
};

export type RawElement = {
  path: number[]; // element-child indices from <html>
  tag: string;
  role: string | null;
  text: string;
  textTruncated: boolean;
  rect: { left: number; top: number; width: number; height: number }; // viewport-relative
  style: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    opacity: string;
    display: string;
    visibility: string;
    position: string;
  };
  checked: boolean;
  selected: boolean;
  attrs: Record<string, string>;
};

export type RawPageRead = {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  /** Optional so old fixtures and fakes stay valid; absent means `innerWidth`. */
  layoutWidth?: number;
  eligibleCount: number;
  elements: RawElement[];
};

/** What the in-page collector returns. Metrics come from CDP, not from the page. */
export type RawCollection = {
  devicePixelRatio: number;
  eligibleCount: number;
  elements: RawElement[];
};
