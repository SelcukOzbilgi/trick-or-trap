"use client";

import { useEffect, useState } from "react";
import {
  SOLD_TOAST_INTERVAL_MS,
  SOLD_TOAST_MESSAGES,
  nextToastIndex,
} from "@/lib/boo-tique/countdown";

/**
 * Sold toast, fixed to the bottom-left corner. The server and the first client render both
 * show the first message. After mount it rotates every 6000 ms. The dismiss button removes
 * it. Nothing is stored.
 */
export function SoldToast() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => nextToastIndex(current, SOLD_TOAST_MESSAGES.length));
    }, SOLD_TOAST_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="bt-toast" role="status" data-testid="product-sold-toast">
      <span>{SOLD_TOAST_MESSAGES[index]}</span>{" "}
      <button
        type="button"
        className="bt-toast-dismiss"
        aria-label="Dismiss"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  );
}
