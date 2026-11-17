import { Phase2Preview } from "./phase2-preview";

/**
 * The checkout order summary. One static view, no steps, no payment fields.
 * The default view shows the items line, the labelled fee preview and the total. The honest
 * view shows the same shipping and tax figures as the cart in a visible `<dl>`.
 */
export function OrderSummary({ variant }: { variant: "default" | "honest" }) {
  if (variant === "honest") {
    return (
      <section className="bt-card" aria-labelledby="bt-checkout-summary-heading">
        <h2 id="bt-checkout-summary-heading">Order summary</h2>
        <dl data-testid="checkout-consistent-shipping-tax" className="bt-list">
          <div className="bt-variant-row">
            <dt>Items</dt>
            <dd className="bt-price">$40.00</dd>
          </div>
          <div className="bt-variant-row">
            <dt>Shipping</dt>
            <dd className="bt-price">$4.00</dd>
          </div>
          <div className="bt-variant-row">
            <dt>Tax</dt>
            <dd className="bt-price">$3.20</dd>
          </div>
          <div className="bt-variant-row">
            <dt>Total</dt>
            <dd className="bt-price">$47.20</dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="bt-card" aria-labelledby="bt-checkout-summary-heading">
      <h2 id="bt-checkout-summary-heading">Order summary</h2>
      <ul className="bt-list">
        <li className="bt-variant-row">Items $40.00</li>
        <Phase2Preview id="checkout-handling-fees-drip" as="li">
          <span>Handling $6.99</span> <span>Haunting fee $3.00</span>
        </Phase2Preview>
        <li className="bt-variant-row">Total $49.99</li>
      </ul>
    </section>
  );
}
