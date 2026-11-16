import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./boo-tique.css";
import { BooTiqueShell } from "@/components/boo-tique/shell";
import { booTiqueMetadata } from "@/lib/boo-tique/metadata";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-cormorant",
});

const jost = Jost({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jost",
});

export const metadata: Metadata = booTiqueMetadata;

export default function BooTiqueLayout({ children }: { children: ReactNode }) {
  return (
    <BooTiqueShell fontClassName={`${cormorant.variable} ${jost.variable}`}>
      {children}
    </BooTiqueShell>
  );
}
