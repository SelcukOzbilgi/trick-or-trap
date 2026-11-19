import { buildRedirectLocation, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only redirect: 302 to a forbidden tag URL.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return fixtureResponse(process.env, () => ({
    kind: "redirect",
    location: buildRedirectLocation(),
  }));
}
