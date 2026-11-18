import { buildMainPage, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only fixture page. Answers 404 unless CAPTURE_FIXTURE_ROUTES is exactly "on".
// The switch is read per request, so the route must never be rendered at build time.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, (env) => ({
    kind: "body",
    contentType: "text/html; charset=utf-8",
    body: buildMainPage({ altOrigin: env.altOrigin }),
  }));
}
