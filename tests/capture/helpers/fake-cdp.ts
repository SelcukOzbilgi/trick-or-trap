import type { CdpSession } from "@/lib/capture/cdp";

export type CdpCall = { method: string; params: unknown; targetSessionId: string | undefined };

/** What a scripted method does: resolve with a value, reject with an `Error`, or never settle. */
export type CdpAnswer = unknown;
export type CdpScript = Record<string, CdpAnswer | ((call: CdpCall) => CdpAnswer)>;

export type CdpEventHandler = Parameters<CdpSession["onEvent"]>[0];

export interface FakeCdp extends CdpSession {
  /** Every `send` call, in order. */
  readonly calls: CdpCall[];
  /** Number of registered event handlers. */
  readonly handlerCount: number;
  /** Number of handlers registered when the first `send` call was made, or `undefined` before it. */
  readonly handlersAtFirstSend: number | undefined;
  /** Calls of one method, in order. */
  callsOf(method: string): CdpCall[];
  /** Replaces or adds the answer of one method. */
  script(method: string, answer: CdpAnswer | ((call: CdpCall) => CdpAnswer)): void;
  /** Calls the registered handlers and resolves when they have all settled. */
  emit(method: string, params: unknown, targetSessionId?: string): Promise<void>;
}

/**
 * A scripted `CdpSession`. A method with no script entry resolves with `{}`. A script
 * entry is a value, an `Error` (rejects), the string `"hang"` (never settles), or a
 * function of the call that returns one of those.
 */
export function createFakeCdp(initial: CdpScript = {}): FakeCdp {
  const scripts = new Map<string, CdpAnswer | ((call: CdpCall) => CdpAnswer)>(Object.entries(initial));
  const handlers: CdpEventHandler[] = [];
  const calls: CdpCall[] = [];
  let handlersAtFirstSend: number | undefined;

  return {
    calls,
    get handlerCount() {
      return handlers.length;
    },
    get handlersAtFirstSend() {
      return handlersAtFirstSend;
    },
    callsOf: (method) => calls.filter((call) => call.method === method),
    script: (method, answer) => {
      scripts.set(method, answer);
    },
    send(method, params, targetSessionId) {
      handlersAtFirstSend ??= handlers.length;
      const call: CdpCall = { method, params, targetSessionId };
      calls.push(call);
      const entry = scripts.get(method);
      const answer = typeof entry === "function" ? (entry as (c: CdpCall) => CdpAnswer)(call) : entry;
      if (answer === "hang") return new Promise<unknown>(() => {});
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer === undefined && !scripts.has(method) ? {} : answer);
    },
    onEvent(handler) {
      handlers.push(handler);
    },
    async emit(method, params, targetSessionId) {
      const event = targetSessionId === undefined ? { method, params } : { method, params, targetSessionId };
      await Promise.all(handlers.map((handler) => handler(event)));
    },
  };
}
