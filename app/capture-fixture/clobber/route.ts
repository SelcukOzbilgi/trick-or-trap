import { buildClobberPage, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only form whose input names shadow built-in members.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/html; charset=utf-8",
    body: buildClobberPage(),
  }));
}
