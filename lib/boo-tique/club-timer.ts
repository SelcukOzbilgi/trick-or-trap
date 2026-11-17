/** Club timer period: 09:59. */
export const CLUB_TIMER_SECONDS = 599;

/** `sessionStorage` key that holds the end time of the current period. */
export const CLUB_TIMER_STORAGE_KEY = "bt-club-timer-end";

/** The offer named in the timer text. It stays the same after every restart. */
export const CLUB_OFFER_TEXT = "20% off";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats whole seconds as "MM:SS". Negative and non-finite values give "00:00". */
export function formatMinutesSeconds(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** Text of `club-timer-session-restart`, for a number of remaining seconds. */
export function clubTimerText(remainingSeconds: number): string {
  return `Join in ${formatMinutesSeconds(remainingSeconds)} for ${CLUB_OFFER_TEXT}`;
}

export type ClubTimerState = { endMs: number; remainingSeconds: number };

/**
 * Decides the timer state from a stored end time. A missing, non-finite or past end starts a
 * new 599 second period. A future end is kept and its remaining seconds are rounded up.
 */
export function nextClubTimerState(
  storedEndMs: number | null,
  nowMs: number,
): ClubTimerState {
  if (
    storedEndMs === null ||
    !Number.isFinite(storedEndMs) ||
    storedEndMs <= nowMs
  ) {
    return {
      endMs: nowMs + CLUB_TIMER_SECONDS * 1000,
      remainingSeconds: CLUB_TIMER_SECONDS,
    };
  }
  return {
    endMs: storedEndMs,
    remainingSeconds: Math.ceil((storedEndMs - nowMs) / 1000),
  };
}
