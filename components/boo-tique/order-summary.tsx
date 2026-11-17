import { summaryRows } from "@/lib/boo-tique/cart";
import { SummaryList } from "./summary-list";

/**
 * The checkout order summary. One static view, no steps, no payment fields.
 * Both views read the shared cart source, so the figures match the cart. The default view adds
 * the two fee rows before the total.
 */
export function OrderSummary({ variant }: { variant: "default" | "honest" }) {
  const rows = summaryRows(variant === "honest" ? "checkout-honest" : "checkout-default");
  const testId =
    variant === "honest" ? "checkout-consistent-shipping-tax" : "checkout-handling-fees-drip";
  return (
    <section className="bt-card" aria-labelledby="bt-checkout-summary-heading">
      <h2 id="bt-checkout-summary-heading">Order summary</h2>
      <SummaryList rows={rows} testId={testId} />
    </section>
  );
}
