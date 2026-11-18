import { CartAddons } from "@/components/boo-tique/cart-addons";
import { SummaryList } from "@/components/boo-tique/summary-list";
import { CART, formatUsd, summaryRows, type CartOption } from "@/lib/boo-tique/cart";

function CartLine({ line, testId }: { line: CartOption; testId?: string }) {
  return (
    <li className="bt-line-row" data-testid={testId}>
      <span>{line.name}</span>
      <span className="bt-price">{formatUsd(line.cents)}</span>
      <button
        type="button"
        className="bt-button bt-button--quiet"
        aria-label={`Remove ${line.name}`}
      >
        Remove
      </button>
    </li>
  );
}

export default function BooTiqueCartPage() {
  return (
    <>
      <section className="bt-card" aria-labelledby="bt-cart-heading">
        <h1 id="bt-cart-heading">Your cart</h1>
        <ul className="bt-list">
          {CART.lines.map((line) => (
            <CartLine key={line.id} line={line} />
          ))}
          <CartLine line={CART.insurance} testId="cart-insurance-sneaked" />
        </ul>
      </section>

      <CartAddons />

      <section className="bt-card" aria-labelledby="bt-cart-summary-heading">
        <h2 id="bt-cart-summary-heading">Summary</h2>
        <SummaryList rows={summaryRows("cart")} testId="bt-cart-summary" />
        <p>
          <a className="bt-button" href="/boo-tique/checkout">
            Checkout
          </a>
        </p>
      </section>
    </>
  );
}
