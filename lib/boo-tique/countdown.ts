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

/** The four fixed messages of the sold toast, in rotation order. */
export const SOLD_TOAST_MESSAGES: readonly string[] = [
  "Morgan from Ohio just bought the Cursed Candle Set",
  "Riley from Texas just bought the Phantom Hoodie",
  "Sam from Maine just bought the Moon-Phase Mug",
  "Jo from Oregon just bought the Crypt Keeper Tote",
];

/** Time between two toast messages, in milliseconds. */
export const SOLD_TOAST_INTERVAL_MS = 6000;

/** Index of the next toast message. Wraps to 0; an empty list or a bad index gives 0. */
export function nextToastIndex(current: number, length: number): number {
  if (!Number.isInteger(current) || length <= 0) return 0;
  const next = current + 1;
  return next < 0 || next >= length ? 0 : next;
}
