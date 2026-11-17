import { UPSELL_ADD_STYLE, UPSELL_CLOSE_STYLE } from "@/lib/boo-tique/styles";
import { OverlayDialog } from "./overlay-dialog";

/**
 * Bundle upsell dialog, open in the initial HTML. The add button is large and full width; the
 * close button is a tiny "x". Nothing is submitted.
 */
export function UpsellModal() {
  return (
    <OverlayDialog
      testId="product-upsell-modal-tiny-close"
      label="Bundle offer"
      closeText="x"
      closeStyle={UPSELL_CLOSE_STYLE}
    >
      <h2>Complete the set</h2>
      <p>The Crypt Keeper bundle pairs this candle with a matching tote.</p>
      <p>
        <button type="button" style={UPSELL_ADD_STYLE}>
          Add crypt keeper bundle
        </button>
      </p>
    </OverlayDialog>
  );
}
