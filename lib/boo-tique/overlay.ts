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

/** Delay between a confirmed click ("Subscribe") and the dialog closing. */
export const EXIT_CONFIRM_DELAY_MS = 1500;

/** Text shown in place of the dialog body after a confirmed click. Nothing is sent. */
export const EXIT_CONFIRM_TEXT = "Demo shop: nothing was sent";

/** The part of a DOM element that `dialogClickAction` needs. */
export type ClosestNode = { closest(selector: string): unknown } | null;

export type DialogClickAction = "ignore" | "close" | "confirm-then-close";

/**
 * What a click inside a dialog should do. A clicked node inside `[data-bt-confirm]` confirms and
 * then closes, even when it is also inside `[data-bt-close]`. A node inside `[data-bt-close]` only
 * closes. Anything else is ignored.
 */
export function dialogClickAction(node: ClosestNode): DialogClickAction {
  if (node === null) return "ignore";
  if (node.closest("[data-bt-confirm]") !== null) return "confirm-then-close";
  if (node.closest("[data-bt-close]") !== null) return "close";
  return "ignore";
}
