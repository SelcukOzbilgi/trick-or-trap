// Opt-in live test: captures the Boo-tique home page through Browser Use Cloud.
// It is skipped unless RUN_REMOTE_CAPTURE=1 and both BROWSER_USE_API_KEY and
// NEXT_PUBLIC_APP_URL are set, so `npm test` stays offline.
// The owner runs it with:
//   RUN_REMOTE_CAPTURE=1 npx vitest run tests/capture/remote-capture.test.ts --maxWorkers=2
// The test never prints the API key, cdpUrl, liveUrl or a session id, and no
// assertion message contains them.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage } from "@/lib/capture/capture";
import { MAX_BASE64_LENGTH } from "@/lib/capture/constants";
import { PageSnapshotSchema } from "@/lib/types";

const enabled = Boolean(
  process.env.RUN_REMOTE_CAPTURE === "1" &&
    process.env.BROWSER_USE_API_KEY &&
    process.env.NEXT_PUBLIC_APP_URL,
);

describe.skipIf(!enabled)("remote capture of the Boo-tique (live)", () => {
  it(
    "captures the home page with the default dependencies",
    async () => {
      const result = await capturePage(`${process.env.NEXT_PUBLIC_APP_URL}/boo-tique`);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        // Only the closed error code is shown, never detail or any URL.
        throw new Error(`capture failed with code ${result.error.code}`);
      }

      expect(PageSnapshotSchema.safeParse(result.snapshot).success).toBe(true);

      expect(result.images.length).toBeGreaterThanOrEqual(1);
      const first = result.images[0];
      expect(first.bytes[0]).toBe(0xff);
      expect(first.bytes[1]).toBe(0xd8);
      expect(result.images.every((image) => image.width >= 1)).toBe(true);
      const base64Sum = result.images.reduce((sum, image) => sum + image.base64Length, 0);
      expect(base64Sum).toBeLessThanOrEqual(MAX_BASE64_LENGTH);

      const warningCodes = result.warnings.map((warning) => warning.code);
      const reloadOutcomeKnown =
        result.snapshot.afterReload !== undefined ||
        warningCodes.includes("reload-skipped") ||
        warningCodes.includes("reload-failed");
      expect(reloadOutcomeKnown).toBe(true);

      expect(warningCodes.includes("session-stop-failed")).toBe(false);
    },
    60_000,
  );
});
