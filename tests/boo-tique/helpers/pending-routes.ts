/**
 * Fixture routes whose page is not finished. A page task removes the routes it finishes and
 * adds the page's `load` line to ROUTE_TABLE in the same step. The last task asserts this
 * list is empty.
 */
export const PENDING_ROUTES: readonly string[] = [];
