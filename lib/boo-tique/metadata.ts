import type { Metadata } from "next";

/** Metadata for every Boo-tique page. The demo shop must stay out of search results. */
export const booTiqueMetadata: Metadata = {
  title: "The Boo-tique (demo shop)",
  description:
    "A fictional shop built to test Trick or Trap. Nothing here is for sale.",
  robots: { index: false, follow: false },
};
