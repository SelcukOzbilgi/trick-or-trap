import type { CdpSession } from "@/lib/capture/cdp";

export type CdpCall = { method: string; params: unknown };

/** What a scripted method does: resolve with a value, reject with an `Error`, or never settle. */
export type CdpAnswer = unknown;
export type CdpScript = Record<string, CdpAnswer | ((call: CdpCall) => CdpAnswer)>;

export interface FakeCdp extends CdpSession {
  /** Every valid `send` call, in order. A call that broke the protocol is not in the list. */
  readonly calls: CdpCall[];
  /** One text per protocol violation: a third `send` argument or a `sessionId` in the parameters. */
  readonly violations: string[];
  /** Calls of one method, in order. */
  callsOf(method: string): CdpCall[];
  /** Replaces or adds the answer of one method. */
  script(method: string, answer: CdpAnswer | ((call: CdpCall) => CdpAnswer)): void;
  /** Throws when any protocol violation was recorded. */
  assertNoViolations(): void;
}

/**
 * A scripted page `CdpSession`. A method with no script entry resolves with `{}`. A script
 * entry is a value, an `Error` (rejects), the string `"hang"` (never settles), or a
 * function of the call that returns one of those.
 *
 * It fails where the real client fails: `send` with a third argument, or with parameters
 * that hold a `sessionId`, throws and is recorded. The page session has no child sessions.
 */
export function createFakeCdp(initial: CdpScript = {}): FakeCdp {
  const scripts = new Map<string, CdpAnswer | ((call: CdpCall) => CdpAnswer)>(Object.entries(initial));
  const calls: CdpCall[] = [];
  const violations: string[] = [];

  function violate(text: string): never {
    violations.push(text);
    throw new Error(`Fake CDP session protocol violation: ${text}`);
  }

  function send(...args: unknown[]): Promise<unknown> {
    const method = String(args[0]);
    if (args.length > 2) {
      violate(`send("${method}") got ${args.length} arguments; the page session takes at most two arguments.`);
    }
    const params = args[1];
    if (typeof params === "object" && params !== null && "sessionId" in params) {
      violate(`send("${method}") got a sessionId in its parameters; the page session has no child sessions.`);
    }
    const call: CdpCall = { method, params };
    calls.push(call);
    const entry = scripts.get(method);
    const answer = typeof entry === "function" ? (entry as (c: CdpCall) => CdpAnswer)(call) : entry;
    if (answer === "hang") return new Promise<unknown>(() => {});
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer === undefined && !scripts.has(method) ? {} : answer);
  }

  return {
    calls,
    violations,
    callsOf: (method) => calls.filter((call) => call.method === method),
    script: (method, answer) => {
      scripts.set(method, answer);
    },
    send: send as CdpSession["send"],
    assertNoViolations() {
      if (violations.length > 0) {
        throw new Error(`The fake CDP session recorded protocol violations:\n${violations.join("\n")}`);
      }
    },
  };
}
