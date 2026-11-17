import type { ReactNode } from "react";
import {
  BOO_TIQUE_BASE_PATH,
  PRODUCTS,
  PRODUCT_PAGE_SLUG,
} from "@/lib/boo-tique/content";
import { perLoadValues } from "@/lib/boo-tique/per-load";
import { EQUAL_BUTTON_STYLE } from "@/lib/boo-tique/styles";
import { Stars, Tile } from "./product-grid";
import { SoldToast } from "./sold-toast";
import { StockSignals, VariantRows } from "./stock-signals";
import { UpsellModal } from "./upsell-modal";

function formatPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(2)}`;
}

function NotAvailable() {
  return (
    <section className="bt-card" aria-labelledby="bt-product-missing-heading">
      <h1 id="bt-product-missing-heading">Nothing here</h1>
      <p>This product is not available in this demo.</p>
      <p>
        <a href={BOO_TIQUE_BASE_PATH}>Back to the shop</a>
      </p>
    </section>
  );
}

/**
 * Builds the async product page function. The random source is injected so tests can fix the
 * per-load numbers. The route file calls this with no argument, which uses `Math.random` on
 * every request (the route is `force-dynamic`).
 */
export function createProductPage(
  random: () => number = Math.random,
): (props: { params: Promise<{ slug: string }> }) => Promise<ReactNode> {
  return async function BooTiqueProductPage({ params }) {
    const { slug } = await params;
    const product = PRODUCTS.find((item) => item.slug === PRODUCT_PAGE_SLUG);
    if (slug !== PRODUCT_PAGE_SLUG || !product) return <NotAvailable />;

    const { stockLeft, viewers } = perLoadValues(random);
    return (
      <>
        <article className="bt-card" aria-labelledby="bt-product-heading">
          <Tile />
          <h1 id="bt-product-heading">{product.name}</h1>
          <p className="bt-price">{formatPrice(product.priceUsd)}</p>
          <Stars rating={product.rating} />
          <p>A smoky, pepper-scented candle in a black glass jar.</p>
          <StockSignals stockLeft={stockLeft} viewers={viewers} />
          <VariantRows />
          <p>
            <button type="button" style={EQUAL_BUTTON_STYLE}>
              Add to cart
            </button>
          </p>
        </article>
        <UpsellModal />
        <SoldToast />
      </>
    );
  };
}
