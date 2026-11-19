import { buildFramePage, fixtureResponse } from "@/lib/capture-fixture/pages";

// Test-only fixture frame. `?variant=cross` gives the cross-site frame; anything else gives the same-site frame.
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const variant = new URL(request.url).searchParams.get("variant") === "cross" ? "cross" : "same";
  return fixtureResponse(process.env, () => ({
    kind: "body",
    contentType: "text/html; charset=utf-8",
    body: buildFramePage(variant),
  }));
}
