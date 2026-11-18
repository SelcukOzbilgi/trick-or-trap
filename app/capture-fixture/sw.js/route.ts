import { buildServiceWorkerScript, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only service worker script. The guard refuses its registration.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/javascript; charset=utf-8",
    body: buildServiceWorkerScript(),
  }));
}
