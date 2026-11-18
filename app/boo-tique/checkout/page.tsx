import { OrderSummary } from "@/components/boo-tique/order-summary";
import { pickVariant, type SearchParamsRecord } from "@/lib/boo-tique/variants";

const FLOW_VARIANTS = ["default", "honest"] as const;

export default async function BooTiqueCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const query = await searchParams;
  const flow = pickVariant(query.flow, FLOW_VARIANTS, "default");

  return (
    <>
      <h1>Checkout</h1>
      <OrderSummary variant={flow} />
      {flow === "default" ? (
        <section className="bt-card" aria-label="Updates">
          <label className="bt-variant-row">
            <input
              type="checkbox"
              defaultChecked
              data-testid="checkout-newsletter-prechecked"
            />
            <span>Send me the Boo-letter</span>
          </label>
        </section>
      ) : null}
      <button type="button" disabled className="bt-button">
        Place order
      </button>
    </>
  );
}
