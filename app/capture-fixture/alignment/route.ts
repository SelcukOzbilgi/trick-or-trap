import { buildAlignmentPage, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only tall page with a solid marker for the box-against-pixels check.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/html; charset=utf-8",
    body: buildAlignmentPage(),
  }));
}
