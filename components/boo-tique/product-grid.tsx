import { PRODUCTS, type Product } from "@/lib/boo-tique/content";

const MAX_STARS = 5;

function Tile() {
  return (
    <div className="bt-tile" aria-hidden="true">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        role="presentation"
        focusable="false"
      >
        <path
          d="M32 6c-11 0-19 8-19 19v27l6-5 6 5 7-5 7 5 6-5 6 5V25C56 14 43 6 32 6z"
          fill="currentColor"
        />
        <circle cx="25" cy="26" r="4" fill="#fff9ee" />
        <circle cx="39" cy="26" r="4" fill="#fff9ee" />
      </svg>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  const full = "★".repeat(rating);
  const empty = "☆".repeat(MAX_STARS - rating);
  return (
    <p className="bt-muted" aria-label={`Rated ${rating} out of ${MAX_STARS}`}>
      {`${full}${empty}`}
    </p>
  );
}

function ProductCard({ product }: { product: Product }) {
  const name = <h3>{product.name}</h3>;
  return (
    <li className="bt-card" data-testid="bt-product-card">
      <Tile />
      {product.href ? <a href={product.href}>{name}</a> : name}
      <p className="bt-price">{`$${product.priceUsd}`}</p>
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
