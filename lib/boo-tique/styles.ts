import type { CSSProperties } from "react";

/** Boo-tique palette. Lower-case hex. The `--bt-*` tokens in boo-tique.css equal these values. */
export const PALETTE = {
  bg: "#fbf3e4",
  paper: "#fff9ee",
  ink: "#2a1512",
  blood: "#8b1a1a",
  bloodDark: "#6e1212",
  muted: "#6b5a52",
  line: "#e3d2b2",
} as const;

/** Small grey "options" link on the default cookie banner. */
export const OPTIONS_LINK_STYLE: CSSProperties = {
  fontSize: "11px",
  color: "#9a9a9a",
  textDecoration: "underline",
};

/** Large filled "Accept all" button on the default and ghost cookie banners. */
export const ACCEPT_ALL_STYLE: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  padding: "16px 48px",
  minHeight: "56px",
  background: PALETTE.blood,
  color: "#ffffff",
  border: 0,
  borderRadius: "8px",
};

/** The ghost banner uses the same "Accept all" style as the default banner. */
export const GHOST_ACCEPT_STYLE: CSSProperties = { ...ACCEPT_ALL_STYLE };

/** Faded "Reject" button on the ghost banner. */
export const GHOST_REJECT_STYLE: CSSProperties = {
  fontSize: "14px",
  color: "#b3b3b3",
  background: "transparent",
  border: "1px solid #b3b3b3",
  padding: "8px 20px",
  opacity: 0.6,
};

/** One shared style for every accept and decline pair that must look equal. */
export const EQUAL_BUTTON_STYLE: CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  padding: "12px 32px",
  minWidth: "160px",
  minHeight: "48px",
  background: PALETTE.blood,
  color: "#ffffff",
  border: `2px solid ${PALETTE.blood}`,
  borderRadius: "8px",
  opacity: 1,
};

/** Tiny "Almost gone" label on the product page. */
export const ALMOST_GONE_STYLE: CSSProperties = {
  fontSize: "10px",
  color: "#9a9a9a",
};

/** Large "Add crypt keeper bundle" button in the upsell dialog. */
export const UPSELL_ADD_STYLE: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  padding: "16px 32px",
  width: "100%",
  background: PALETTE.blood,
  color: "#ffffff",
};

/** Tiny "x" close button in the upsell dialog. */
export const UPSELL_CLOSE_STYLE: CSSProperties = {
  fontSize: "8px",
  lineHeight: 1,
  color: "#cfc6bc",
  background: "transparent",
  border: 0,
  padding: 0,
};
