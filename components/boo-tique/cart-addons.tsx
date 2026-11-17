/**
 * The cart add-ons. Everything here is inert: no handler, no form, nothing is stored.
 * Exactly four controls start selected: the protection checkbox, the Gold warranty radio, the
 * packaging switch and the cheapest shipping radio. Gift wrap starts unchecked.
 */
export function CartAddons() {
  return (
    <section className="bt-card" aria-labelledby="bt-cart-addons-heading">
      <h2 id="bt-cart-addons-heading">Extras</h2>
      <div className="bt-list">
        <label className="bt-variant-row">
          <input
            type="checkbox"
            defaultChecked
            data-testid="cart-protection-prechecked"
          />
          <span>Add Raven Shipping Protection +$4.99</span>
        </label>

        <label className="bt-variant-row">
          <input type="checkbox" data-testid="cart-gift-wrap-unchecked" />
          <span>Gift wrap +$2.00</span>
        </label>

        <div className="bt-variant-row">
          <span id="bt-cart-packaging-label">Priority coffin packaging +$2.50</span>
          <button
            type="button"
            role="switch"
            aria-checked="true"
            aria-labelledby="bt-cart-packaging-label"
            className="bt-toggle"
            data-testid="cart-packaging-switch-on"
          >
            <span className="bt-toggle-knob" />
          </button>
        </div>
      </div>

      <fieldset className="bt-list">
        <legend>Warranty</legend>
        <label className="bt-variant-row">
          <input type="radio" name="warranty" data-testid="bt-cart-warranty-none" />
          <span>No warranty $0.00</span>
        </label>
        <label className="bt-variant-row">
          <input type="radio" name="warranty" data-testid="bt-cart-warranty-silver" />
          <span>Silver Curse Warranty +$3.00</span>
        </label>
        <label className="bt-variant-row">
          <input
            type="radio"
            name="warranty"
            defaultChecked
            data-testid="cart-warranty-radio-preselected"
          />
          <span>Gold Extended Curse Warranty +$9.00</span>
        </label>
      </fieldset>

      <fieldset className="bt-list">
        <legend>Shipping</legend>
        <label className="bt-variant-row">
          <input
            type="radio"
            name="shipping"
            defaultChecked
            data-testid="cart-cheapest-shipping-default"
          />
          <span>Standard coffin post $4.00</span>
        </label>
        <label className="bt-variant-row">
          <input type="radio" name="shipping" data-testid="bt-cart-shipping-express" />
          <span>Express bat post $9.00</span>
        </label>
        <label className="bt-variant-row">
          <input type="radio" name="shipping" data-testid="bt-cart-shipping-overnight" />
          <span>Overnight spirit post $15.00</span>
        </label>
      </fieldset>
    </section>
  );
}
