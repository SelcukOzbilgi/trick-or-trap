import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeadline, createSystemClock, withTimeout } from "@/lib/capture/clock";
import { CaptureFailure } from "@/lib/capture/types";
import { createManualClock } from "./helpers/manual-clock";

type Tracked<T> = { state: "pending" | "resolved" | "rejected"; value?: T; error?: unknown };

function track<T>(promise: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = { state: "pending" };
  promise.then(
    (value) => {
      tracked.state = "resolved";
      tracked.value = value;
    },
    (error: unknown) => {
      tracked.state = "rejected";
      tracked.error = error;
    },
  );
  return tracked;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function expectFailure(tracked: Tracked<unknown>, code: string) {
  expect(tracked.state).toBe("rejected");
  expect(tracked.error).toBeInstanceOf(CaptureFailure);
  expect((tracked.error as CaptureFailure).code).toBe(code);
}

describe("manual clock helper", () => {
  it("fires due timers in order and honours cancel", () => {
    const clock = createManualClock(1000);
    const fired: string[] = [];
    clock.setTimer(30, () => fired.push("c"));
    clock.setTimer(10, () => fired.push("a"));
    const cancelB = clock.setTimer(20, () => fired.push("b"));
    cancelB();
    expect(clock.pendingTimers).toBe(2);
    clock.advance(25);
    expect(fired).toEqual(["a"]);
    expect(clock.now()).toBe(1025);
    clock.advance(5);
    expect(fired).toEqual(["a", "c"]);
    expect(clock.pendingTimers).toBe(0);
  });

  it("fires a timer that is scheduled by a timer when it falls inside the advance", () => {
    const clock = createManualClock(0);
    const fired: number[] = [];
    clock.setTimer(10, () => {
      fired.push(clock.now());
      clock.setTimer(10, () => fired.push(clock.now()));
    });
    clock.advance(25);
    expect(fired).toEqual([10, 20]);
    expect(clock.now()).toBe(25);
  });
});

describe("createDeadline", () => {
  it("rejects with the stage code after the stage limit", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const tracked = track(deadline.run(new Promise<never>(() => {}), { ms: 10_000, code: "session-create-timeout" }));
    clock.advance(9_999);
    await flush();
    expect(tracked.state).toBe("pending");
    clock.advance(1);
    await flush();
    expectFailure(tracked, "session-create-timeout");
  });

  it("resolves earlier when the operation does, and cancels its timer", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const op = deferred<string>();
    const tracked = track(deadline.run(op.promise, { ms: 10_000, code: "connect-timeout" }));
    expect(clock.pendingTimers).toBe(1);
    clock.advance(3_000);
    op.resolve("done");
    await flush();
    expect(tracked).toMatchObject({ state: "resolved", value: "done" });
    expect(clock.pendingTimers).toBe(0);
  });

  it("passes the original error of the operation through and cancels its timer", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const op = deferred<string>();
    const boom = new Error("boom");
    const tracked = track(deadline.run(op.promise, { ms: 10_000, code: "connect-timeout" }));
    op.reject(boom);
    await flush();
    expect(tracked.state).toBe("rejected");
    expect(tracked.error).toBe(boom);
    expect(clock.pendingTimers).toBe(0);
  });

  it("limits a stage to the remaining time and reports capture-timeout", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    clock.advance(40_000);
    expect(deadline.remainingMs()).toBe(5_000);
    const tracked = track(deadline.run(new Promise<never>(() => {}), { ms: 10_000, code: "session-create-timeout" }));
    clock.advance(4_999);
    await flush();
    expect(tracked.state).toBe("pending");
    clock.advance(1);
    await flush();
    expectFailure(tracked, "capture-timeout");
  });

  it("uses the stage code when the stage limit equals the remaining time", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    clock.advance(35_000);
    const tracked = track(deadline.run(new Promise<never>(() => {}), { ms: 10_000, code: "navigation-timeout" }));
    clock.advance(10_000);
    await flush();
    expectFailure(tracked, "navigation-timeout");
  });

  it("uses the remaining time and capture-timeout when no stage is given", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const tracked = track(deadline.run(new Promise<never>(() => {})));
    clock.advance(44_999);
    await flush();
    expect(tracked.state).toBe("pending");
    clock.advance(1);
    await flush();
    expectFailure(tracked, "capture-timeout");
  });

  it("rejects at once with capture-timeout when nothing remains", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    clock.advance(45_000);
    expect(deadline.remainingMs()).toBe(0);
    const tracked = track(deadline.run(new Promise<never>(() => {}), { ms: 10_000, code: "connect-timeout" }));
    await flush();
    expectFailure(tracked, "capture-timeout");
    expect(clock.pendingTimers).toBe(0);
  });

  it("rejects at once when the budget is overdrawn, and absorbs a rejection of the operation", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 1_000);
    clock.advance(5_000);
    const op = deferred<string>();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const tracked = track(deadline.run(op.promise));
      await flush();
      expectFailure(tracked, "capture-timeout");
      op.reject(new Error("late"));
      await flush();
    } finally {
      process.off("unhandledRejection", listener);
    }
    expect(unhandled).toEqual([]);
  });

  it("raises no unhandled rejection when the operation rejects after the deadline fired", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const op = deferred<string>();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const tracked = track(deadline.run(op.promise, { ms: 1_000, code: "navigation-timeout" }));
      clock.advance(1_000);
      await flush();
      expectFailure(tracked, "navigation-timeout");
      op.reject(new Error("late failure"));
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", listener);
    }
    expect(unhandled).toEqual([]);
  });

  it("ignores a late resolution after the deadline fired", async () => {
    const clock = createManualClock();
    const deadline = createDeadline(clock, 45_000);
    const op = deferred<string>();
    const tracked = track(deadline.run(op.promise, { ms: 1_000, code: "navigation-timeout" }));
    clock.advance(1_000);
    await flush();
    op.resolve("too late");
    await flush();
    expectFailure(tracked, "navigation-timeout");
  });

  it("counts the elapsed time from creation", () => {
    const clock = createManualClock();
    clock.advance(7_000);
    const deadline = createDeadline(clock, 45_000);
    expect(deadline.remainingMs()).toBe(45_000);
    clock.advance(2_500);
    expect(deadline.remainingMs()).toBe(42_500);
  });
});

describe("withTimeout", () => {
  it("rejects with its code after the limit, without waiting for the operation", async () => {
    const clock = createManualClock();
    const tracked = track(withTimeout(clock, 10_000, new Promise<never>(() => {}), "session-create-timeout"));
    clock.advance(9_999);
    await flush();
    expect(tracked.state).toBe("pending");
    clock.advance(1);
    await flush();
    expectFailure(tracked, "session-create-timeout");
  });

  it("resolves with the value and cancels its timer when the operation is faster", async () => {
    const clock = createManualClock();
    const op = deferred<number>();
    const tracked = track(withTimeout(clock, 10_000, op.promise, "capture-timeout"));
    op.resolve(7);
    await flush();
    expect(tracked).toMatchObject({ state: "resolved", value: 7 });
    expect(clock.pendingTimers).toBe(0);
  });

  it("absorbs a late rejection of the operation", async () => {
    const clock = createManualClock();
    const op = deferred<number>();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const tracked = track(withTimeout(clock, 100, op.promise, "capture-timeout"));
      clock.advance(100);
      await flush();
      expectFailure(tracked, "capture-timeout");
      op.reject(new Error("late"));
      await flush();
    } finally {
      process.off("unhandledRejection", listener);
    }
    expect(unhandled).toEqual([]);
  });
});

describe("createSystemClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads Date.now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-04T05:06:07.000Z"));
    expect(createSystemClock().now()).toBe(Date.parse("2025-03-04T05:06:07.000Z"));
  });

  it("schedules with setTimeout and cancels", () => {
    vi.useFakeTimers();
    const clock = createSystemClock();
    const fired: string[] = [];
    clock.setTimer(100, () => fired.push("a"));
    const cancelB = clock.setTimer(100, () => fired.push("b"));
    cancelB();
    vi.advanceTimersByTime(99);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(["a"]);
  });
});
