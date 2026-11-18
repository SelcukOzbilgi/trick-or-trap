/**
 * A structural view of one Chrome DevTools Protocol session, and the helpers that call
 * the protocol: hiding scrollbars, running a function in an isolated world and reading
 * the page metrics. Nothing here imports a browser-automation library, so the modules
 * that use it load nothing and unit tests can pass a fake.
 *
 * Page content is untrusted. Page scripts run in the main world; the functions here
 * run in an isolated world of the main frame, where the built-ins that a page script
 * may have replaced are the original ones. The page can still shape its own DOM, text
 * and styles, which is what the capture reports on.
 */

export interface CdpSession {
  /**
   * Sends one protocol command. `targetSessionId` addresses a child target that was
   * attached with `flatten: true`; without it the command goes to the page session.
   */
  send(method: string, params?: Record<string, unknown>, targetSessionId?: string): Promise<unknown>;
  /** Registers a handler for every protocol event of the page session and its attached children. */
  onEvent(
    handler: (event: { method: string; params: unknown; targetSessionId?: string }) => void | Promise<void>,
  ): void;
}

/** Name given to every isolated world this module creates. */
export const ISOLATED_WORLD_NAME = "trick-or-trap-capture";

/** Page metrics as the protocol reported them. Unchecked: `sanitiseMetrics` makes them safe. */
export type RawMetrics = {
  innerWidth: unknown;
  innerHeight: unknown;
  scrollX: unknown;
  scrollY: unknown;
  scrollWidth: unknown;
  scrollHeight: unknown;
  layoutWidth: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Hides the scrollbars, so the layout width of a read and of a full-page screenshot is
 * the same. Rejects when the command fails.
 */
export async function hideScrollbars(session: CdpSession): Promise<void> {
  await session.send("Emulation.setScrollbarsHidden", { hidden: true });
}

/**
 * Creates a fresh isolated world for the main frame and calls `fn(arg)` in it. A new
 * world per call avoids a stale execution context after a navigation or a reload.
 * `fn` is serialised with `String(fn)`, so it must be self-contained, and `arg` and the
 * result must be JSON values. Rejects when a protocol call fails or the function throws.
 */
export async function runInIsolatedWorld<A, R>(session: CdpSession, fn: (arg: A) => R, arg: A): Promise<R> {
  const tree = asRecord(await session.send("Page.getFrameTree"));
  const frameId = asRecord(asRecord(tree?.frameTree)?.frame)?.id;
  if (typeof frameId !== "string" || frameId === "") throw new Error("The page reported no main frame id.");

  const world = asRecord(await session.send("Page.createIsolatedWorld", { frameId, worldName: ISOLATED_WORLD_NAME }));
  const executionContextId = world?.executionContextId;
  if (typeof executionContextId !== "number") throw new Error("The isolated world has no execution context.");

  const answer = asRecord(
    await session.send("Runtime.callFunctionOn", {
      executionContextId,
      functionDeclaration: String(fn),
      arguments: [{ value: arg }],
      returnByValue: true,
      awaitPromise: true,
    }),
  );
  if (answer === undefined) throw new Error("The isolated world returned no answer.");

  const exception = asRecord(answer.exceptionDetails);
  if (exception !== undefined) {
    const description = asRecord(exception.exception)?.description;
    const text = typeof description === "string" && description !== "" ? description : exception.text;
    throw new Error(`The page function failed: ${typeof text === "string" ? text : "unknown error"}`);
  }
  return asRecord(answer.result)?.value as R;
}

/**
 * Reads viewport size, layout width, scroll position and content size from
 * `Page.getLayoutMetrics`, in CSS px. The values are not checked. A missing or odd
 * answer gives `undefined` fields and does not throw; a failing command rejects.
 */
export async function readPageMetrics(session: CdpSession): Promise<RawMetrics> {
  const metrics = asRecord(await session.send("Page.getLayoutMetrics"));
  const viewport = asRecord(metrics?.cssLayoutViewport);
  const content = asRecord(metrics?.cssContentSize);
  return {
    innerWidth: viewport?.clientWidth,
    innerHeight: viewport?.clientHeight,
    layoutWidth: viewport?.clientWidth,
    scrollX: viewport?.pageX,
    scrollY: viewport?.pageY,
    scrollWidth: content?.width,
    scrollHeight: content?.height,
  };
}

/**
 * Scrolls the document to `target` and resolves with the `scrollY` read back, because
 * the browser may clamp it. Runs in the page through `runInIsolatedWorld`, serialised
 * with `String(fn)`, so it must stay self-contained: no imports, no closures over
 * module scope and no named inner functions.
 */
export function scrollInPage(target: number): Promise<number> {
  return new Promise<number>((resolve) => {
    window.scrollTo(0, target);
    // One animation frame lets the scroll settle; the timer is the fallback for a page
    // that does not paint. The second resolve call has no effect.
    requestAnimationFrame(() => resolve(window.scrollY));
    setTimeout(() => resolve(window.scrollY), 250);
  });
}
