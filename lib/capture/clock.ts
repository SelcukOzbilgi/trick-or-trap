/**
 * Time source and deadlines of the page capture. Everything that waits goes
 * through a `Clock`, so tests can control time.
 */
import { CaptureFailure, type CaptureErrorCode } from "./types";

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Runs `fn` after `ms` milliseconds. Returns a function that cancels the timer. */
  setTimer(ms: number, fn: () => void): () => void;
}

/** The real clock: `Date.now` and `setTimeout`. */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    setTimer(ms, fn) {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
  };
}

export type StageLimit = { ms: number; code: CaptureErrorCode };

export interface Deadline {
  /** Milliseconds left in the whole budget. Zero or negative once it has expired. */
  remainingMs(): number;
  /** Races `op` against `min(stage.ms, remaining)`. */
  run<T>(op: Promise<T>, stage?: StageLimit): Promise<T>;
}

function noop(): void {}

/**
 * Races `op` against a timer of `ms`. On expiry it rejects with `code` and does not
 * wait for `op`. A later settlement of `op` is absorbed, so it never raises an
 * unhandled rejection. The timer is cancelled when `op` settles first.
 */
function raceWithTimer<T>(clock: Clock, op: Promise<T>, ms: number, code: CaptureErrorCode): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const cancel = clock.setTimer(Math.max(0, ms), () => {
      if (done) return;
      done = true;
      reject(new CaptureFailure(code));
    });
    op.then(
      (value) => {
        if (done) return;
        done = true;
        cancel();
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        cancel();
        reject(error);
      },
    );
  });
}

/**
 * A budget that starts now and lasts `totalMs`.
 *
 * `run` limits a step to `min(stage.ms, remaining)`. When the limit expires and
 * `stage.ms <= remaining` at call time the error is `stage.code`, otherwise
 * `capture-timeout`. When nothing remains it rejects at once.
 */
export function createDeadline(clock: Clock, totalMs: number): Deadline {
  const start = clock.now();
  const remainingMs = () => totalMs - (clock.now() - start);
  return {
    remainingMs,
    run<T>(op: Promise<T>, stage?: StageLimit): Promise<T> {
      const remaining = remainingMs();
      if (remaining <= 0) {
        op.then(noop, noop);
        return Promise.reject(new CaptureFailure("capture-timeout"));
      }
      if (!stage) return raceWithTimer(clock, op, remaining, "capture-timeout");
      const stageFits = stage.ms <= remaining;
      return raceWithTimer(clock, op, Math.min(stage.ms, remaining), stageFits ? stage.code : "capture-timeout");
    },
  };
}

/** The same race without a shared budget. Used for the stop call. */
export function withTimeout<T>(clock: Clock, ms: number, op: Promise<T>, code: CaptureErrorCode): Promise<T> {
  return raceWithTimer(clock, op, ms, code);
}
