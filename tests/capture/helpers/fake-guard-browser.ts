import type { GuardBrowser, GuardSession } from "@/lib/capture/guard-types";

/** The frame id a paused request carries when the test names none. Tests use it as the main frame id. */
export const DEFAULT_MAIN_FRAME_ID = "MAIN";

export type GuardCall = { method: string; params: unknown };

/**
 * What a scripted method does: resolve with a value, reject with an `Error`, or never
 * settle (`"hang"`). A function chooses per call; when it returns `undefined`, the
 * default behaviour of the fake applies.
 */
export type GuardAnswer = unknown;
export type GuardScriptEntry = GuardAnswer | ((call: GuardCall) => GuardAnswer);

export type PausedInit = {
  url: string;
  /** Default `"Document"`. */
  resourceType?: string;
  /** Default `DEFAULT_MAIN_FRAME_ID`. */
  frameId?: string;
  /** Request headers as the Chrome DevTools Protocol sends them: a name-to-value map. */
  headers?: Record<string, string>;
  redirectedRequestId?: string;
  /** Default: a generated id. */
  requestId?: string;
  /** Where the request came from (page, iframe, worker, popup, ...). Informational only: the event does not carry it. */
  source?: string;
  /** Present: the request is paused at the response stage, with these response fields. Absent: request stage. */
  response?: PausedResponseInit;
};

export type FakeHeaderEntry = { name: string; value: string };

export type PausedResponseInit = {
  /** Default 200, unless `errorReason` is set (then no status code is sent). */
  status?: number;
  statusText?: string;
  errorReason?: string;
  /** Response headers as a list of entries, so repeated names are kept. */
  headers?: FakeHeaderEntry[];
  /** What `Fetch.getResponseBody` returns. Default: an empty, not base64-encoded body. */
  body?: string;
  base64Encoded?: boolean;
};

export type FakeRequestState = "pending" | "continued" | "failed" | "fulfilled" | "gone-out";

export type FakeFulfilment = {
  responseCode: number;
  responsePhrase?: string;
  responseHeaders?: FakeHeaderEntry[];
  /** Base64 text, as sent. */
  body?: string;
};

export type FakeRequest = {
  readonly requestId: string;
  readonly url: string;
  readonly source: string | undefined;
  /** `"response"` when the event carried response fields. */
  readonly stage: "request" | "response";
  state: FakeRequestState;
  /** The `errorReason` of the `Fetch.failRequest` that answered it. */
  errorReason?: string;
  /** What the `Fetch.fulfillRequest` that answered it carried. */
  fulfilled?: FakeFulfilment;
};

export type PausedHandle = {
  readonly requestId: string;
  /** Settles when every event handler has settled. Never rejects; handler errors go to `handlerErrors`. */
  readonly handled: Promise<void>;
};

export interface FakeGuardBrowser extends GuardBrowser {
  /** Every valid `send` call on the guard session, in order. A call that broke the protocol is not in the list. */
  readonly calls: GuardCall[];
  /** Number of `openGuardSession` calls. */
  readonly openCalls: number;
  /** One text per protocol violation: a third `send` argument or a `sessionId` in the parameters. */
  readonly violations: string[];
  /** Registered handler counts now. */
  readonly handlerCounts: { event: number; close: number; disconnected: number };
  /** The handler counts when the first valid `send` was made, or `undefined` before it. */
  readonly handlersAtFirstSend: { event: number; close: number; disconnected: number } | undefined;
  /** Errors thrown or rejected by event handlers. */
  readonly handlerErrors: Error[];
  /** Every paused request the fake emitted, in order. */
  readonly requests: readonly FakeRequest[];
  callsOf(method: string): GuardCall[];
  /** Replaces or adds the answer of one method. */
  script(method: string, answer: GuardScriptEntry): void;
  /** Sets what `openGuardSession` does: `"hang"`, an `Error` (rejects), or nothing (the default). */
  scriptOpen(answer: "hang" | Error | undefined): void;
  /** Emits a `Fetch.requestPaused` event on the one guard session. The request stays pending until answered. */
  emitPaused(init: PausedInit): PausedHandle;
  /** Sends any event to the guard session's handlers. */
  emitEvent(method: string, params: unknown): Promise<void>;
  /** Requests that have been emitted and not answered. */
  pending(): FakeRequest[];
  /** Requests that were pending when the connection was lost: Chromium sends them on unguarded. */
  wentOut(): FakeRequest[];
  /** The guard session is detached: pending requests go out and `close` is emitted. */
  detach(): void;
  /** The connection drops: as `detach`, plus `disconnected` on the browser. */
  dropConnection(): void;
  /** Throws when any protocol violation was recorded. */
  assertNoViolations(): void;
}

type EventHandler = Parameters<GuardSession["onEvent"]>[0];

/** The browser target does not know these domains; Playwright's real session answers `'<method>' wasn't found`. */
const PAGE_ONLY_DOMAINS: readonly string[] = ["Network.", "Page.", "Runtime.", "Emulation."];

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * A faithful stand-in for the guard's browser-target CDP session and the browser that
 * opens it. It fails where the real client fails: a third `send` argument and a
 * `sessionId` parameter throw (and are recorded), page-domain commands are not found,
 * an answer for an unknown or already answered request is `Invalid InterceptionId`,
 * and an unanswered request stays paused. Losing the connection lets every pending
 * request go out, as Chromium does when interception is released.
 *
 * Every guard test file calls `assertNoViolations()` in `afterEach`.
 */
export function createFakeGuardBrowser(): FakeGuardBrowser {
  const calls: GuardCall[] = [];
  const violations: string[] = [];
  const handlerErrors: Error[] = [];
  const requests: FakeRequest[] = [];
  /** The response fields of each response-stage request, by request id. */
  const responses = new Map<string, PausedResponseInit>();
  const scripts = new Map<string, GuardScriptEntry>();
  const eventHandlers: EventHandler[] = [];
  const closeHandlers: Array<() => void> = [];
  const disconnectedHandlers: Array<() => void> = [];

  let openCalls = 0;
  let openScript: "hang" | Error | undefined;
  let session: GuardSession | undefined;
  let connectionLost = false;
  let closeEmitted = false;
  let disconnectedEmitted = false;
  let nextRequestNumber = 1;
  let handlersAtFirstSend: { event: number; close: number; disconnected: number } | undefined;

  function counts() {
    return { event: eventHandlers.length, close: closeHandlers.length, disconnected: disconnectedHandlers.length };
  }

  function violate(text: string): never {
    violations.push(text);
    throw new Error(`Fake guard session protocol violation: ${text}`);
  }

  function findPending(params: unknown): FakeRequest | undefined {
    const requestId = (params as { requestId?: unknown } | undefined)?.requestId;
    if (typeof requestId !== "string") return undefined;
    const request = requests.find((candidate) => candidate.requestId === requestId);
    return request?.state === "pending" ? request : undefined;
  }

  /** The built-in behaviour of one method. */
  function defaultAnswer(method: string, params: unknown): Promise<unknown> {
    if (method === "Browser.getVersion") {
      return Promise.resolve({
        protocolVersion: "1.3",
        product: "Chrome/156.0.0.0",
        userAgent: "fake",
        jsVersion: "0",
      });
    }
    if (method === "Fetch.continueRequest" || method === "Fetch.failRequest") {
      const request = findPending(params);
      if (!request) return Promise.reject(new Error("Invalid InterceptionId"));
      if (method === "Fetch.continueRequest") {
        request.state = "continued";
      } else {
        request.state = "failed";
        const reason = (params as { errorReason?: unknown }).errorReason;
        if (typeof reason === "string") request.errorReason = reason;
      }
      return Promise.resolve({});
    }
    if (method === "Fetch.getResponseBody") {
      const request = findPending(params);
      if (!request) return Promise.reject(new Error("Invalid InterceptionId"));
      const response = responses.get(request.requestId);
      if (request.stage !== "response" || !response || response.errorReason !== undefined) {
        return Promise.reject(new Error("Can only get response body on requests captured after headers received."));
      }
      return Promise.resolve({ body: response.body ?? "", base64Encoded: response.base64Encoded ?? false });
    }
    if (method === "Fetch.fulfillRequest") {
      const request = findPending(params);
      if (!request) return Promise.reject(new Error("Invalid InterceptionId"));
      const fields = params as Record<string, unknown>;
      const code = fields.responseCode;
      if (typeof code !== "number" || !Number.isInteger(code)) {
        return Promise.reject(new Error("Invalid parameters: responseCode: integer value expected"));
      }
      const fulfilment: FakeFulfilment = { responseCode: code };
      if (typeof fields.responsePhrase === "string") fulfilment.responsePhrase = fields.responsePhrase;
      if (Array.isArray(fields.responseHeaders)) fulfilment.responseHeaders = fields.responseHeaders as FakeHeaderEntry[];
      if (typeof fields.body === "string") fulfilment.body = fields.body;
      request.state = "fulfilled";
      request.fulfilled = fulfilment;
      return Promise.resolve({});
    }
    if (method === "Fetch.continueResponse") {
      const request = findPending(params);
      if (!request) return Promise.reject(new Error("Invalid InterceptionId"));
      if (request.stage !== "response") {
        return Promise.reject(new Error("Can only continue a response of a request paused at the response stage."));
      }
      const fields = params as Record<string, unknown>;
      if (fields.responseHeaders !== undefined && fields.responseCode === undefined) {
        // Chromium leaves the request paused in this case; the fake rejects so a test sees it.
        return Promise.reject(new Error("Invalid parameters: responseCode must be set when responseHeaders is set"));
      }
      request.state = "continued";
      return Promise.resolve({});
    }
    return Promise.resolve({});
  }

  function send(...args: unknown[]): Promise<unknown> {
    const method = String(args[0]);
    if (args.length > 2) {
      violate(`send("${method}") got ${args.length} arguments; the guard session takes at most two arguments.`);
    }
    const params = args[1];
    if (typeof params === "object" && params !== null && "sessionId" in params) {
      violate(`send("${method}") got a sessionId in its parameters; the guard session has no child sessions.`);
    }

    handlersAtFirstSend ??= counts();
    const call: GuardCall = { method, params };
    calls.push(call);

    if (connectionLost) return Promise.reject(new Error(`Protocol error (${method}): Target closed`));
    if (PAGE_ONLY_DOMAINS.some((prefix) => method.startsWith(prefix))) {
      return Promise.reject(new Error(`'${method}' wasn't found`));
    }

    const entry = scripts.get(method);
    const answer = typeof entry === "function" ? (entry as (c: GuardCall) => GuardAnswer)(call) : entry;
    if (answer === "hang") return new Promise<unknown>(() => {});
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer !== undefined) return Promise.resolve(answer);
    return defaultAnswer(method, params);
  }

  const guardSession: GuardSession = {
    send: send as GuardSession["send"],
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
  };

  /** Calls one handler; a sync throw and a rejection both end in `handlerErrors`. */
  async function runHandler(handler: () => void | Promise<void>): Promise<void> {
    try {
      await handler();
    } catch (error) {
      handlerErrors.push(asError(error));
    }
  }

  function deliver(method: string, params: unknown): Promise<void> {
    const event = { method, params };
    return Promise.all(eventHandlers.map((handler) => runHandler(() => handler(event)))).then(() => undefined);
  }

  function loseConnection(withDisconnected: boolean): void {
    if (!connectionLost) {
      connectionLost = true;
      for (const request of requests) {
        if (request.state === "pending") request.state = "gone-out";
      }
    }
    if (!closeEmitted) {
      closeEmitted = true;
      for (const handler of closeHandlers) void runHandler(handler);
    }
    if (withDisconnected && !disconnectedEmitted) {
      disconnectedEmitted = true;
      for (const handler of disconnectedHandlers) void runHandler(handler);
    }
  }

  return {
    calls,
    violations,
    handlerErrors,
    requests,
    get openCalls() {
      return openCalls;
    },
    get handlerCounts() {
      return counts();
    },
    get handlersAtFirstSend() {
      return handlersAtFirstSend;
    },
    callsOf: (method) => calls.filter((call) => call.method === method),
    script(method, answer) {
      scripts.set(method, answer);
    },
    scriptOpen(answer) {
      openScript = answer;
    },
    openGuardSession() {
      openCalls += 1;
      if (openScript === "hang") return new Promise<GuardSession>(() => {});
      if (openScript instanceof Error) return Promise.reject(openScript);
      session ??= guardSession;
      return Promise.resolve(session);
    },
    onDisconnected(handler) {
      disconnectedHandlers.push(handler);
    },
    emitPaused(init) {
      if (!session) throw new Error("The fake guard browser has no open session; call openGuardSession first.");
      const requestId = init.requestId ?? `REQ-${nextRequestNumber++}`;
      requests.push({
        requestId,
        url: init.url,
        source: init.source,
        stage: init.response ? "response" : "request",
        state: "pending",
      });
      const params: Record<string, unknown> = {
        requestId,
        request: { url: init.url, method: "GET", headers: { ...(init.headers ?? {}) } },
        frameId: init.frameId ?? DEFAULT_MAIN_FRAME_ID,
        resourceType: init.resourceType ?? "Document",
      };
      if (init.redirectedRequestId !== undefined) params.redirectedRequestId = init.redirectedRequestId;
      if (init.response) {
        const response = init.response;
        responses.set(requestId, response);
        if (response.errorReason !== undefined) params.responseErrorReason = response.errorReason;
        if (response.status !== undefined || response.errorReason === undefined) {
          params.responseStatusCode = response.status ?? 200;
        }
        if (response.statusText !== undefined) params.responseStatusText = response.statusText;
        if (response.headers !== undefined) params.responseHeaders = response.headers.map((entry) => ({ ...entry }));
      }
      return { requestId, handled: deliver("Fetch.requestPaused", params) };
    },
    emitEvent: (method, params) => deliver(method, params),
    pending: () => requests.filter((request) => request.state === "pending"),
    wentOut: () => requests.filter((request) => request.state === "gone-out"),
    detach: () => loseConnection(false),
    dropConnection: () => loseConnection(true),
    assertNoViolations() {
      if (violations.length > 0) {
        throw new Error(`The fake guard session recorded protocol violations:\n${violations.join("\n")}`);
      }
    },
  };
}
