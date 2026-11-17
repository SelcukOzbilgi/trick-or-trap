/** Hero countdown start: 04:59:59. */
export const HERO_COUNTDOWN_SECONDS = 17999;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats whole seconds as "HH:MM:SS". Negative and non-finite values give "00:00:00". */
export function formatCountdown(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
