/** URL prefix of every Boo-tique route. */
export const BOO_TIQUE_BASE_PATH = "/boo-tique";

/** Shown once, by the shell, on every Boo-tique page. */
export const DEMO_NOTICE_TEXT = "Demo shop, nothing is for sale";

export type NavLink = { readonly label: string; readonly href: string };

/** Header navigation. Plain anchors with relative hrefs. */
export const NAV_LINKS: readonly NavLink[] = [
  { label: "Home", href: BOO_TIQUE_BASE_PATH },
  { label: "Cart", href: `${BOO_TIQUE_BASE_PATH}/cart` },
  { label: "Club", href: `${BOO_TIQUE_BASE_PATH}/club` },
  { label: "Account", href: `${BOO_TIQUE_BASE_PATH}/account/subscription` },
];
