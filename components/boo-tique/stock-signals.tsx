import { INVENTORY, PRODUCT_VARIANTS } from "@/lib/boo-tique/content";
import { ALMOST_GONE_STYLE } from "@/lib/boo-tique/styles";

const ALMOST_GONE_LABEL = "Almost gone";

/**
 * The four planted stock and activity claims. The two numbers come from the page factory, so
 * they change on every request. The badge and the tiny label carry no number.
 */
export function StockSignals({
  stockLeft,
  viewers,
}: {
  stockLeft: number;
  viewers: number;
}) {
  return (
    <div>
      <p data-testid="product-low-stock-random">{`Only ${stockLeft} left!`}</p>
      <p data-testid="product-viewers-random">{`${viewers} people are viewing this`}</p>
      <p>
        <span className="bt-badge" data-testid="product-selling-fast-badge">
          Selling fast
        </span>{" "}
        <span
          data-testid="product-almost-gone-tiny"
          data-stock-label={ALMOST_GONE_LABEL}
          style={ALMOST_GONE_STYLE}
        >
          {ALMOST_GONE_LABEL}
        </span>
      </p>
    </div>
  );
}

/**
 * Variant rows. The Travel tin row shows its real, fixed inventory from `INVENTORY`, with no
 * urgency wording around it. The count does not depend on the per-load numbers.
 */
export function VariantRows() {
  return (
    <ul className="bt-list" aria-label="Sizes">
      {PRODUCT_VARIANTS.map((variant) => (
        <li
          key={variant.key}
          className="bt-variant-row"
          data-testid={`bt-variant-${variant.key}`}
        >
          <span>{variant.label}</span>
          {variant.key === "travel-tin" ? (
            <span data-testid="product-real-inventory-3-left">
              {`${INVENTORY["travel-tin"]} left`}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
