import type { ReactNode } from "react";
import {
  BOO_TIQUE_BASE_PATH,
  DEMO_NOTICE_TEXT,
  NAV_LINKS,
} from "@/lib/boo-tique/content";

export function BooTiqueShell({
  children,
  fontClassName,
}: {
  children?: ReactNode;
  fontClassName?: string;
}) {
  const className = ["bt-root", fontClassName].filter(Boolean).join(" ");
  return (
    <div className={className}>
      <div className="bt-notice" data-testid="bt-demo-notice">
        {DEMO_NOTICE_TEXT}
      </div>
      <header className="bt-header">
        <a href={BOO_TIQUE_BASE_PATH}>The Boo-tique</a>
        <nav className="bt-nav" aria-label="Shop">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="bt-page">{children}</main>
      <footer className="bt-footer">
        The Boo-tique is a fictional shop. It has no real products, orders or
        payments.
      </footer>
    </div>
  );
}
