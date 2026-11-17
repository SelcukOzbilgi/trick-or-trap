import { ACCOUNT_PLANS, formatUsd } from "@/lib/boo-tique/cart";

/** "<name>, <price>/month", with the price from the shared source. */
function planHeading(plan: { readonly name: string; readonly cents: number }): string {
  return `${plan.name}, ${formatUsd(plan.cents)}/month`;
}

/**
 * The account plan area. Everything is inert: no link, no input, no handler that does work.
 * The default view shows the Midnight Club plan and a cancel section that tells the member
 * to call. The honest view shows a plain basic plan with one cancel button.
 */
export function AccountPlans({ variant }: { variant: "default" | "honest" }) {
  if (variant === "honest") {
    return (
      <section
        className="bt-card"
        aria-labelledby="bt-plan-heading"
        data-testid="account-one-click-cancel-plan"
      >
        <h2 id="bt-plan-heading">{planHeading(ACCOUNT_PLANS.basic)}</h2>
        <p>Your current plan.</p>
        <button type="button" className="bt-button">
          Cancel plan
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="bt-card" aria-labelledby="bt-plan-heading">
        <h2 id="bt-plan-heading">{planHeading(ACCOUNT_PLANS.club)}</h2>
        <p>Your current plan.</p>
      </section>
      <section
        className="bt-card"
        aria-labelledby="bt-cancel-heading"
        data-testid="account-cancel-five-screens"
      >
        <h2 id="bt-cancel-heading">Cancel membership</h2>
        <p>To cancel, call us during opening hours.</p>
      </section>
    </>
  );
}
