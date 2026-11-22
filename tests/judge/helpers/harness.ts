/**
 * A manual clock and timer for the orchestrator tests. Nothing here reads the
 * real clock or starts a real timer: time moves only when a test says so.
 */

/** Let pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

export function createHarness(start = 1_000_000) {
  let current = start;
  type Timer = { at: number; fn: () => void; cancelled: boolean };
  const timers: Timer[] = [];
  return {
    now: (): number => current,
    /** Move the clock without firing any timer. */
    moveClock(ms: number): void {
      current += ms;
    },
    setTimer(ms: number, fn: () => void): () => void {
      const timer: Timer = { at: current + ms, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    /** Move the clock and fire the timers that fall due, in order. */
    async advance(ms: number): Promise<void> {
      const target = current + ms;
      for (;;) {
        const due = timers
          .filter((timer) => !timer.cancelled && timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        due.cancelled = true;
        current = Math.max(current, due.at);
        due.fn();
        await flush();
      }
      current = target;
      await flush();
    },
    pendingTimers: (): number => timers.filter((timer) => !timer.cancelled).length,
  };
}

export type Harness = ReturnType<typeof createHarness>;
