"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  EXIT_CONFIRM_DELAY_MS,
  dialogClickAction,
  nextFocusIndex,
  shouldCloseOnKey,
} from "@/lib/boo-tique/overlay";
import { PALETTE } from "@/lib/boo-tique/styles";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const DEFAULT_CLOSE_STYLE: CSSProperties = {
  fontSize: "20px",
  lineHeight: 1,
  color: PALETTE.ink,
  background: "transparent",
  border: 0,
  padding: "4px 8px",
  cursor: "pointer",
};

type OverlayDialogProps = {
  /** Test id of the dialog root. */
  testId: string;
  /** Accessible name of the dialog. */
  label: string;
  /** Text of the close button. */
  closeText?: string;
  /** Inline style of the close button. */
  closeStyle?: CSSProperties;
  /**
   * Text shown in place of the children after a click on an element marked `data-bt-confirm`.
   * The dialog closes `EXIT_CONFIRM_DELAY_MS` later. Without it, a confirm click closes at once.
   */
  confirmText?: string;
  children: ReactNode;
};

/**
 * Modal dialog with a backdrop. It renders open on the server and on the first client render.
 * After mount it takes focus, keeps Tab inside the dialog, and closes on Escape, on the
 * close button, or on a click inside a `data-bt-close` element. A click inside a
 * `data-bt-confirm` element first shows `confirmText`, then closes. Closing removes the dialog
 * and the backdrop and returns focus to the element that had it before. Nothing is stored or sent.
 */
export function OverlayDialog({
  testId,
  label,
  closeText = "×",
  closeStyle = DEFAULT_CLOSE_STYLE,
  confirmText,
  children,
}: OverlayDialogProps) {
  const [open, setOpen] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setConfirming(false);
    setOpen(false);
    previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!confirming) return undefined;
    const id = setTimeout(close, EXIT_CONFIRM_DELAY_MS);
    return () => clearTimeout(id);
  }, [confirming, close]);

  function onDialogClick(event: MouseEvent<HTMLElement>) {
    const origin = event.nativeEvent.composedPath()[0];
    const clicked = origin instanceof Element ? origin : null;
    const action = dialogClickAction(clicked);
    if (action === "ignore") return;
    if (action === "close" || confirmText === undefined) {
      close();
      return;
    }
    setConfirming(true);
    dialogRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const active = document.activeElement;
    previousFocus.current = active instanceof HTMLElement ? active : null;
    dialog.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (!dialog) return;
      if (shouldCloseOnKey(event.key)) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      event.preventDefault();
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, focusable.length, event.shiftKey);
      if (next === -1) dialog.focus();
      else focusable[next]?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div className="bt-backdrop" data-testid="bt-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="bt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-testid={testId}
        onClick={onDialogClick}
      >
        <button
          type="button"
          className="bt-dialog-close"
          aria-label="Close"
          style={closeStyle}
          onClick={close}
        >
          {closeText}
        </button>
        {confirming ? (
          <p role="status" data-testid="bt-dialog-confirm">
            {confirmText}
          </p>
        ) : (
          children
        )}
      </section>
    </>
  );
}
