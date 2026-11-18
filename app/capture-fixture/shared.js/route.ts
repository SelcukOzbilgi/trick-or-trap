import { buildSharedWorkerScript, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only shared worker script.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/javascript; charset=utf-8",
    body: buildSharedWorkerScript(),
  }));
}
