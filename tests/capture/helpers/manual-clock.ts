import type { Clock } from "@/lib/capture/clock";

export interface ManualClock extends Clock {
  /** Moves time forward and fires every due timer in order of due time, then creation. */
  advance(ms: number): void;
  /** Number of timers that are scheduled and not cancelled. */
  readonly pendingTimers: number;
}

type Timer = { id: number; due: number; fn: () => void };

export function createManualClock(start = 1_700_000_000_000): ManualClock {
  let time = start;
  let nextId = 1;
  const timers = new Map<number, Timer>();

  return {
    now: () => time,
    setTimer(ms, fn) {
      const id = nextId++;
      timers.set(id, { id, due: time + Math.max(0, ms), fn });
      return () => {
        timers.delete(id);
      };
    },
    advance(ms) {
      const target = time + ms;
      for (;;) {
        let next: Timer | undefined;
        for (const timer of timers.values()) {
          if (timer.due > target) continue;
          if (!next || timer.due < next.due || (timer.due === next.due && timer.id < next.id)) next = timer;
        }
        if (!next) break;
        timers.delete(next.id);
        time = Math.max(time, next.due);
        next.fn();
      }
      time = target;
    },
    get pendingTimers() {
      return timers.size;
    },
  };
}
