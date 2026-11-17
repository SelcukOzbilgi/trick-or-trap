"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { nextFocusIndex, shouldCloseOnKey } from "@/lib/boo-tique/overlay";

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
  color: "#2a1512",
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
  children: ReactNode;
};

/**
 * Modal dialog with a backdrop. It renders open on the server and on the first client render.
 * After mount it takes focus, keeps Tab inside the dialog, and closes on Escape or on the
 * close button. Closing removes the dialog and the backdrop and returns focus to the element
 * that had it before. Nothing is stored.
 */
export function OverlayDialog({
  testId,
  label,
  closeText = "×",
  closeStyle = DEFAULT_CLOSE_STYLE,
  children,
}: OverlayDialogProps) {
  const [open, setOpen] = useState(true);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    previousFocus.current?.focus();
  }, []);

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
        {children}
      </section>
    </>
  );
}
