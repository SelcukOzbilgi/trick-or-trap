/**
 * The public "could not scan" outcome of a capture.
 *
 * Pure: no I/O. The reason is the error code itself. The `Record` keyed by every
 * `CaptureErrorCode` makes `tsc` fail when a code is added without a deliberate decision
 * here. `CaptureError.detail` is internal and never leaves this module.
 */
import {
  ERROR_MESSAGES,
  type CaptureErrorCode,
  type CaptureResult,
  type CouldNotScanReason,
  type ScanOutcome,
} from "./types";

export const COULD_NOT_SCAN_REASONS: Readonly<Record<CaptureErrorCode, CouldNotScanReason>> = {
  "url-invalid": "url-invalid",
  "url-too-long": "url-too-long",
  "url-scheme-blocked": "url-scheme-blocked",
  "url-credentials-blocked": "url-credentials-blocked",
  "url-port-blocked": "url-port-blocked",
  "url-host-blocked": "url-host-blocked",
  "url-address-blocked": "url-address-blocked",
  "dns-failed": "dns-failed",
  "config-invalid": "config-invalid",
  "browser-mode-unsupported": "browser-mode-unsupported",
  "session-create-failed": "session-create-failed",
  "session-create-timeout": "session-create-timeout",
  "connect-failed": "connect-failed",
  "connect-timeout": "connect-timeout",
  "navigation-failed": "navigation-failed",
  "navigation-timeout": "navigation-timeout",
  "navigation-blocked": "navigation-blocked",
  "page-read-failed": "page-read-failed",
  "screenshot-failed": "screenshot-failed",
  "screenshot-too-large": "screenshot-too-large",
  "snapshot-invalid": "snapshot-invalid",
  "snapshot-too-large": "snapshot-too-large",
  "capture-timeout": "capture-timeout",
  "internal-error": "internal-error",
  "guard-lost": "guard-lost",
};

/** Maps a capture result to the public outcome. A failure never carries `detail`. */
export function toScanOutcome(result: CaptureResult): ScanOutcome {
  if (result.ok) {
    return {
      status: "captured",
      snapshot: result.snapshot,
      images: result.images,
      warnings: result.warnings,
    };
  }
  const code = result.error.code;
  return {
    status: "could-not-scan",
    reason: COULD_NOT_SCAN_REASONS[code],
    message: ERROR_MESSAGES[code],
    warnings: result.warnings,
  };
}
