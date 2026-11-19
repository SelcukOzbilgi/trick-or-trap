/**
 * The single entry point to a browser. `capturePage` obtains its browser only here.
 *
 * Only the `remote` mode (Browser Use Cloud over CDP) exists. Every other mode,
 * `local` and `bundled` included, returns `browser-mode-unsupported` and opens
 * nothing. Adding a mode later means adding a case; the seam interfaces stay as they are.
 */
import "server-only";
import type { CaptureConfig } from "./config";
import { createRemoteBrowser, type RemoteBrowserDeps } from "./remote-browser";
import type { GetBrowserResult } from "./seam";
import { ERROR_MESSAGES } from "./types";

/** What `getBrowser` accepts: the adapter's dependencies without the live-test-only `onPageReady`. */
export type GetBrowserDeps = Omit<RemoteBrowserDeps, "onPageReady">;

export function getBrowser(config: CaptureConfig, deps: GetBrowserDeps): GetBrowserResult {
  switch (config.browserMode) {
    case "remote":
      if (config.apiKey === null) {
        return { ok: false, error: { code: "config-invalid", message: ERROR_MESSAGES["config-invalid"] } };
      }
      // The adapter gets its dependencies field by field, so an `onPageReady` that a caller
      // slipped in despite the type never reaches it: a capture has no gesture control.
      return {
        ok: true,
        browser: createRemoteBrowser(config, {
          fetch: deps.fetch,
          clock: deps.clock,
          ...(deps.loadPlaywright ? { loadPlaywright: deps.loadPlaywright } : {}),
        }),
      };
    default:
      return {
        ok: false,
        error: { code: "browser-mode-unsupported", message: ERROR_MESSAGES["browser-mode-unsupported"] },
      };
  }
}
