/**
 * Fixture routes whose page is not finished. A page task removes the routes it finishes and
 * adds the page's `load` line to ROUTE_TABLE in the same step. The last task asserts this
 * list is empty.
 */
export const PENDING_ROUTES: readonly string[] = [
  "/boo-tique/product/ghost-pepper-candle",
  "/boo-tique/cart",
  "/boo-tique/checkout",
  "/boo-tique/checkout?flow=honest",
  "/boo-tique/club",
  "/boo-tique/account/subscription",
  "/boo-tique/account/subscription?plan=honest",
  "/boo-tique?modal=exit-intent",
];
