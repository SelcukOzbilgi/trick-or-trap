import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { capturePage, type CaptureDeps } from "@/lib/capture/capture";
import type { CaptureConfig } from "@/lib/capture/config";
import { NAVIGATION_TIMEOUT_MS } from "@/lib/capture/constants";
import type { GetBrowserResult } from "@/lib/capture/seam";
import { ERROR_MESSAGES, WARNING_MESSAGES, type CaptureResult } from "@/lib/capture/types";
import type { Resolver } from "@/lib/capture/url-check";
import { PageSnapshotSchema } from "@/lib/types";
import { createFakeBrowser, createRawPageRead, type FakeBrowser, type FakeScript } from "./helpers/fake-browser";
import { createManualClock, type ManualClock } from "./helpers/manual-clock";

const URL_OK = "https://shop.example.com/";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const config: CaptureConfig = {
  browserMode: "remote",
  apiKey: "sk-test-sentinel",
  proxy: "off",
  sessionTimeoutMinutes: 2,
  allowOrigin: null,
};

const resolver: Resolver = {
  async resolveAddresses() {
    return ["93.184.216.34"];
  },
};

type Control = {
  /** Loses the guard now and remembers the stop calls and the clock time at that moment. */
  lose(): void;
  readonly lossCount: number;
  readonly stopCallsAtLoss: number | undefined;
  readonly lostAt: number | undefined;
};

/**
 * Builds a capture with a fake browser. `scriptFor` receives `lose`, so a script step can
 * lose the guard from inside the stage that then hangs or returns.
 */
function setup(scriptFor: (control: Control) => FakeScript = () => ({})) {
  const clock = createManualClock();
  let fake!: FakeBrowser;
  const state = { lossCount: 0, stopCallsAtLoss: undefined as number | undefined, lostAt: undefined as number | undefined };
  const control: Control = {
    lose() {
      state.lossCount += 1;
      state.lostAt ??= clock.now();
      fake.loseGuard();
      // The stop must have started inside this call, before any stage settles.
      state.stopCallsAtLoss ??= fake.stopCalls;
    },
    get lossCount() {
      return state.lossCount;
    },
    get stopCallsAtLoss() {
      return state.stopCallsAtLoss;
    },
    get lostAt() {
      return state.lostAt;
    },
  };
  fake = createFakeBrowser(scriptFor(control));
  const deps: Partial<CaptureDeps> = {
    config,
    getBrowser: (): GetBrowserResult => ({ ok: true, browser: fake.provider }),
    resolver,
    clock,
  };
  return { clock, fake, deps, control };
}

/** Runs a capture to the end, advancing the manual clock whenever it waits on a timer. */
async function drive(promise: Promise<CaptureResult>, clock: ManualClock): Promise<CaptureResult> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 400 && !done; i++) {
    await tick();
    if (done) break;
    if (clock.pendingTimers > 0) clock.advance(500);
  }
  return promise;
}

function failureOf(result: CaptureResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failure");
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePage: the guard is lost during a stage", () => {
  type Stage = {
    name: string;
    script: (control: Control) => FakeScript;
    /** A call that must not happen once the guard was lost in this stage. */
    notCalled?: string;
  };
  const stages: Stage[] = [
    { name: "goto", script: ({ lose }) => ({ goto: () => (lose(), "hang") }), notCalled: "collect" },
    {
      name: "the first collect",
      script: ({ lose }) => ({ collect: (n) => (n === 1 ? (lose(), "hang") : createRawPageRead()) }),
      notCalled: "screenshot",
    },
    { name: "the screenshots", script: ({ lose }) => ({ screenshot: () => (lose(), "hang") }), notCalled: "reload" },
    {
      name: "the layout drift re-read",
      script: ({ lose }) => ({ collect: (n) => (n === 2 ? (lose(), "hang") : createRawPageRead()) }),
      notCalled: "reload",
    },
    { name: "the reload", script: ({ lose }) => ({ reload: () => (lose(), "hang") }) },
    {
      name: "the reload sample read",
      script: ({ lose }) => ({ collect: (n) => (n === 3 ? (lose(), "hang") : createRawPageRead()) }),
    },
  ];

  it.each(stages)("$name: ends with guard-lost, no snapshot, no images", async ({ script, notCalled }) => {
    const { clock, fake, deps, control } = setup(script);

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(control.lossCount).toBe(1);
    expect(result.error.code).toBe("guard-lost");
    expect(result.error.message).toBe(ERROR_MESSAGES["guard-lost"]);
    expect(result.error.detail).toBeUndefined();
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("images");
    if (notCalled) expect(fake.calls).not.toContain(notCalled);
  });

  it.each(stages)("$name: does not wait for the hanging stage", async ({ script }) => {
    const { clock, deps, control } = setup(script);

    await drive(capturePage(URL_OK, deps), clock);

    expect(control.lostAt).toBeDefined();
    const waited = clock.now() - (control.lostAt ?? 0);
    // A hanging goto would end at 15,000 ms and any other stage at the 45,000 ms budget.
    expect(waited).toBeLessThan(NAVIGATION_TIMEOUT_MS / 3);
  });

  it.each(stages)("$name: starts the stop at once and calls it once", async ({ script }) => {
    const { clock, fake, deps, control } = setup(script);

    await drive(capturePage(URL_OK, deps), clock);

    // The stop had started inside the call that lost the guard, while the stage still hung.
    expect(control.stopCallsAtLoss).toBe(1);
    expect(fake.stopCalls).toBe(1);
  });

  it("settles before the manual clock reaches any stage timeout", async () => {
    const { clock, fake, deps } = setup(({ lose }) => ({ goto: () => (lose(), "hang") }));
    const promise = capturePage(URL_OK, deps);
    let settled = false;
    void promise.then(() => (settled = true));

    // No clock advance at all: the loss alone ends the capture.
    for (let i = 0; i < 20 && !settled; i++) await tick();

    expect(settled).toBe(true);
    expect(failureOf(await promise).error.code).toBe("guard-lost");
    expect(fake.stopCalls).toBe(1);
  });

  it("a stage that returns at the moment of the loss still fails the capture", async () => {
    const { clock, deps } = setup(({ lose }) => ({
      collect: (n) => {
        if (n === 1) lose();
        return createRawPageRead();
      },
    }));

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("guard-lost");
  });

  it("losing the guard twice calls the stop once", async () => {
    const { clock, fake, deps, control } = setup(({ lose }) => ({
      goto: () => {
        lose();
        lose();
        return "hang";
      },
    }));

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(control.lossCount).toBe(2);
    expect(result.error.code).toBe("guard-lost");
    expect(fake.stopCalls).toBe(1);
  });

  it("a stop that fails after the loss adds session-stop-failed and keeps guard-lost", async () => {
    const { clock, fake, deps } = setup(({ lose }) => ({
      goto: () => (lose(), "hang"),
      stop: new Error("stop failed"),
    }));

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("guard-lost");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["session-stop-failed"]);
    expect(fake.stopCalls).toBe(1);
  });
});

describe("capturePage: the guard is lost after the last stage", () => {
  it("still gives guard-lost and no snapshot", async () => {
    const { clock, fake, deps } = setup();
    const original = PageSnapshotSchema.safeParse.bind(PageSnapshotSchema);
    // The validation is the last step before the result is built; no stage can notice a loss there.
    vi.spyOn(PageSnapshotSchema, "safeParse").mockImplementation((value) => {
      const parsed = original(value);
      fake.loseGuard();
      return parsed;
    });

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("guard-lost");
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("images");
    expect(fake.stopCalls).toBe(1);
  });

  it("a loss reported only after the whole capture ended changes nothing", async () => {
    const { clock, fake, deps } = setup();

    const result = await drive(capturePage(URL_OK, deps), clock);
    fake.loseGuard();

    expect(result.ok).toBe(true);
    expect(fake.stopCalls).toBe(1);
  });
});

describe("capturePage: warnings and codes around guard-lost", () => {
  it("keeps the warning codes collected before the loss", async () => {
    const { clock, deps } = setup(({ lose }) => ({
      goto: { finalUrl: "https://shop.example.com/landing" },
      reload: () => (lose(), "hang"),
    }));

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("guard-lost");
    expect(result.warnings.map((warning) => warning.code)).toEqual(["redirected"]);
  });

  it("keeps a blocked-request warning reported before the loss", async () => {
    const { clock, fake, deps } = setup(({ lose }) => ({
      collect: (n) => {
        if (n === 1) {
          fake.emit({ kind: "request-blocked", reason: "url-address-blocked", mainFrame: false });
          lose();
          return "hang";
        }
        return createRawPageRead();
      },
    }));

    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.error.code).toBe("guard-lost");
    expect(result.warnings).toMatchObject([{ code: "request-blocked", reason: "url-address-blocked", count: 1 }]);
  });

  it("never turns guard-lost into a warning", async () => {
    expect(Object.keys(WARNING_MESSAGES)).not.toContain("guard-lost");

    const { clock, deps } = setup(({ lose }) => ({ goto: () => (lose(), "hang") }));
    const result = failureOf(await drive(capturePage(URL_OK, deps), clock));

    expect(result.warnings.map((warning) => warning.code)).not.toContain("guard-lost");
  });

  it("a capture without a loss is unchanged", async () => {
    const { clock, fake, deps } = setup();

    const result = await drive(capturePage(URL_OK, deps), clock);

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(fake.stopCalls).toBe(1);
  });
});
