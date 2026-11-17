"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLUB_TIMER_SECONDS,
  CLUB_TIMER_STORAGE_KEY,
  clubTimerText,
  nextClubTimerState,
} from "@/lib/boo-tique/club-timer";

/** Reads the stored end time. Blocked storage or a bad value counts as missing. */
function readStoredEnd(): number | null {
  try {
    const raw = window.sessionStorage.getItem(CLUB_TIMER_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredEnd(endMs: number): void {
  try {
    window.sessionStorage.setItem(CLUB_TIMER_STORAGE_KEY, String(endMs));
  } catch {
    // Storage is blocked. The end time stays in the ref.
  }
}

/**
 * Club offer timer. The server and the first client render both show 09:59. After mount it
 * reads `sessionStorage`, ticks once per second, and starts a new period with the same offer
 * after zero. When storage is blocked it keeps the end time in memory.
 */
export function ClubTimer() {
  const [remaining, setRemaining] = useState(CLUB_TIMER_SECONDS);
  const endRef = useRef<number | null>(null);

  useEffect(() => {
    endRef.current = readStoredEnd();
    const tick = () => {
      const state = nextClubTimerState(endRef.current, Date.now());
      if (state.endMs !== endRef.current) {
        endRef.current = state.endMs;
        writeStoredEnd(state.endMs);
      }
      setRemaining(state.remainingSeconds);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return <p data-testid="club-timer-session-restart">{clubTimerText(remaining)}</p>;
}
