/**
 * A structural view of one Chrome DevTools Protocol session. Nothing here imports a
 * browser-automation library, so the modules that use it load nothing and unit tests
 * can pass a fake.
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
