import { Phase2Preview } from "./phase2-preview";

/**
 * The account plan area. Everything is inert: no link, no input, no handler that does work.
 * The default view shows the Midnight Club plan and the labelled cancel preview. The honest
 * view shows a plain basic plan with one cancel button.
 */
export function AccountPlans({ variant }: { variant: "default" | "honest" }) {
  if (variant === "honest") {
    return (
      <section
        className="bt-card"
        aria-labelledby="bt-plan-heading"
        data-testid="account-one-click-cancel-plan"
      >
        <h2 id="bt-plan-heading">Moonlight Basic, $4.99/month</h2>
        <p>Your current plan.</p>
        <button type="button">Cancel plan</button>
      </section>
    );
  }

  return (
    <>
      <section className="bt-card" aria-labelledby="bt-plan-heading">
        <h2 id="bt-plan-heading">Midnight Club Monthly, $9.99/month</h2>
        <p>Your current plan.</p>
      </section>
      <Phase2Preview id="account-cancel-five-screens" as="section">
        <h2>Cancel membership</h2>
        <p>To finish cancelling, the member must call the shop.</p>
      </Phase2Preview>
    </>
  );
}
