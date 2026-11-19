import { buildWorkerScript, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only dedicated worker script.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/javascript; charset=utf-8",
    body: buildWorkerScript(),
  }));
}
