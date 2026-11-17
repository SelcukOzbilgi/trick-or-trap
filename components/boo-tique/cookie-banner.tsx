"use client";

import { useState } from "react";
import {
  ACCEPT_ALL_STYLE,
  EQUAL_BUTTON_STYLE,
  GHOST_ACCEPT_STYLE,
  GHOST_REJECT_STYLE,
  OPTIONS_LINK_STYLE,
} from "@/lib/boo-tique/styles";

export type CookieBannerVariant = "default" | "ghost" | "equal";

const TEST_IDS: Record<CookieBannerVariant, string> = {
  default: "home-cookie-accept-dominant",
  ghost: "home-cookie-ghost-reject",
  equal: "home-cookie-equal-buttons",
};

/**
 * Cookie banner fixed to the bottom of the viewport. It renders open on the server and on the
 * first client render. Any banner button hides it. Nothing is stored.
 */
export function CookieBanner({ variant }: { variant: CookieBannerVariant }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <div
      className="bt-banner"
      role="region"
      aria-label="Cookie preferences"
      data-testid={TEST_IDS[variant]}
    >
      <p>We use cookies to remember your basket and to count visits.</p>
      {variant === "default" ? (
        <>
          <a href="#cookie-options" style={OPTIONS_LINK_STYLE}>
            options
          </a>
          <button type="button" style={ACCEPT_ALL_STYLE} onClick={close}>
            Accept all
          </button>
        </>
      ) : null}
      {variant === "ghost" ? (
        <>
          <button type="button" style={GHOST_ACCEPT_STYLE} onClick={close}>
            Accept all
          </button>
          <button type="button" style={GHOST_REJECT_STYLE} onClick={close}>
            Reject
          </button>
        </>
      ) : null}
      {variant === "equal" ? (
        <>
          <button type="button" style={EQUAL_BUTTON_STYLE} onClick={close}>
            Accept all
          </button>
          <button type="button" style={EQUAL_BUTTON_STYLE} onClick={close}>
            Reject all
          </button>
        </>
      ) : null}
    </div>
  );
}
