import { EQUAL_BUTTON_STYLE } from "@/lib/boo-tique/styles";
import { OverlayDialog } from "./overlay-dialog";

/**
 * Exit-intent newsletter modal. It is open in the initial HTML. The partners checkbox is
 * checked and carries the entry id. Subscribe and Not now share one style. There is no text
 * input and nothing is submitted.
 */
export function ExitIntentModal() {
  return (
    <OverlayDialog testId="bt-exit-intent-dialog" label="Newsletter sign-up">
      <h2>Before you go</h2>
      <p>Get the Boo-letter: new curses and candles, once a week.</p>
      <p>
        <label>
          <input type="checkbox" data-testid="bt-exit-newsletter-optin" /> Send me the
          Boo-letter
        </label>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            defaultChecked
            data-testid="newsletter-partners-prechecked"
          />{" "}
          Share my details with trusted partners
        </label>
      </p>
      <p>
        <button type="button" style={EQUAL_BUTTON_STYLE}>
          Subscribe
        </button>{" "}
        <button type="button" style={EQUAL_BUTTON_STYLE}>
          Not now
        </button>
      </p>
    </OverlayDialog>
  );
}
