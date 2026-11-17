/**
 * Index of the element that should take focus after Tab (or Shift+Tab) inside a dialog.
 * `current` is the index of the focused element in the dialog's focusable list, or -1 when
 * the dialog itself has focus. The result wraps at both ends. A count of 0 returns -1.
 */
export function nextFocusIndex(
  current: number,
  count: number,
  shiftKey: boolean,
): number {
  if (count <= 0) return -1;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  return current >= count - 1 ? 0 : current + 1;
}

/** True only for the Escape key. */
export function shouldCloseOnKey(key: string): boolean {
  return key === "Escape";
}
