import { buildPopupPage, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only same-origin popup page.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/html; charset=utf-8",
    body: buildPopupPage(),
  }));
}
