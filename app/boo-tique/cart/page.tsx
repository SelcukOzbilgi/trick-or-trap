import { CartAddons } from "@/components/boo-tique/cart-addons";
import { Phase2Preview } from "@/components/boo-tique/phase2-preview";

const CART_LINES: ReadonlyArray<{ readonly name: string; readonly price: string }> = [
  { name: "Ghost Pepper Candle", price: "$18.00" },
  { name: "Moon-Phase Mug", price: "$22.00" },
];

export default function BooTiqueCartPage() {
  return (
    <>
      <section className="bt-card" aria-labelledby="bt-cart-heading">
        <h1 id="bt-cart-heading">Your cart</h1>
        <ul className="bt-list">
          {CART_LINES.map((line) => (
            <li key={line.name} className="bt-variant-row">
              <span>{line.name}</span>
              <span className="bt-price">{line.price}</span>
            </li>
          ))}
          <Phase2Preview id="cart-insurance-sneaked" as="li">
            Insurance $4.00
          </Phase2Preview>
        </ul>
      </section>

      <CartAddons />

      <section className="bt-card" aria-labelledby="bt-cart-summary-heading">
        <h2 id="bt-cart-summary-heading">Summary</h2>
        <p>Items $40.00</p>
        <p>Estimated tax $3.20</p>
      </section>
    </>
  );
}
