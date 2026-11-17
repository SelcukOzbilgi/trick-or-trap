import type { ReactNode } from "react";
import {
  PRODUCTS,
  PRODUCT_ICONS,
  type Product,
  type ProductIcon,
} from "@/lib/boo-tique/content";
import { formatUsd } from "@/lib/boo-tique/cart";
import { PALETTE } from "@/lib/boo-tique/styles";

const MAX_STARS = 5;

/** Decorative shapes per icon: at most six, `currentColor` fill, highlights from the palette. */
const ICON_SHAPES: Readonly<Record<ProductIcon, ReactNode>> = {
  candle: (
    <>
      <rect x="22" y="26" width="20" height="30" rx="2" fill="currentColor" />
      <path d="M32 6c5 7 7 10 7 14a7 7 0 0 1-14 0c0-4 2-7 7-14z" fill="currentColor" />
      <rect x="31" y="22" width="2" height="6" fill="currentColor" />
      <rect x="26" y="34" width="12" height="3" fill={PALETTE.paper} />
    </>
  ),
  hoodie: (
    <>
      <path d="M20 18l12-8 12 8 12 8-5 8-7-4v28H20V30l-7 4-5-8z" fill="currentColor" />
      <path d="M24 18l8 8 8-8-8-6z" fill={PALETTE.paper} />
      <rect x="25" y="42" width="14" height="8" rx="2" fill={PALETTE.paper} />
    </>
  ),
  mug: (
    <>
      <rect x="12" y="18" width="30" height="34" rx="4" fill="currentColor" />
      <path
        d="M42 26h6a6 6 0 0 1 0 14h-6v-4h6a2 2 0 0 0 0-6h-6z"
        fill="currentColor"
      />
      <circle cx="27" cy="35" r="7" fill={PALETTE.paper} />
      <circle cx="30" cy="33" r="6" fill="currentColor" />
    </>
  ),
  tote: (
    <>
      <path d="M20 26h24l4 30H16z" fill="currentColor" />
      <path
        d="M24 26v-6a8 8 0 0 1 16 0v6h-3v-6a5 5 0 0 0-10 0v6z"
        fill="currentColor"
      />
      <circle cx="32" cy="40" r="5" fill={PALETTE.paper} />
    </>
  ),
  quill: (
    <>
      <path d="M52 6C34 8 20 22 18 40l6 6C42 44 54 28 52 6z" fill="currentColor" />
      <path d="M22 42L8 58l2 2 16-14z" fill="currentColor" />
      <path d="M26 40C32 30 40 20 48 12" stroke={PALETTE.paper} strokeWidth="2" fill="none" />
    </>
  ),
};

export function Tile({ slug }: { slug: string }) {
  const icon: ProductIcon = PRODUCT_ICONS[slug] ?? "candle";
  return (
    <div className={`bt-tile bt-tile--${icon}`} aria-hidden="true">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        role="presentation"
        focusable="false"
      >
        {ICON_SHAPES[icon]}
      </svg>
    </div>
  );
}

export function Stars({ rating }: { rating: number }) {
  const full = "★".repeat(rating);
  const empty = "☆".repeat(MAX_STARS - rating);
  return (
    <p
      className="bt-muted"
      role="img"
      aria-label={`Rated ${rating} out of ${MAX_STARS}`}
    >
      {`${full}${empty}`}
    </p>
  );
}

function ProductCard({ product }: { product: Product }) {
  const name = <h3>{product.name}</h3>;
  return (
    <li className="bt-card" data-testid="bt-product-card">
      <Tile slug={product.slug} />
      {product.href ? <a href={product.href}>{name}</a> : name}
      <p className="bt-price">{formatUsd(product.priceUsd * 100)}</p>
      <Stars rating={product.rating} />
    </li>
  );
}

export function ProductGrid() {
  return (
    <section aria-labelledby="bt-products-heading">
      <h2 id="bt-products-heading">Shop the crypt</h2>
      <ul className="bt-grid">
        {PRODUCTS.map((product) => (
          <ProductCard key={product.slug} product={product} />
        ))}
      </ul>
    </section>
  );
}
