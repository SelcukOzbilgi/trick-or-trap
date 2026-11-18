import { CART, CART_OPTIONS, addOnLabel, plainLabel, type CartOption } from "@/lib/boo-tique/cart";
import { ToggleSwitch } from "./toggle-switch";

/**
 * The cart add-ons. Nothing here is stored or sent, and no figure on the page changes.
 * Exactly four controls start selected: the protection checkbox, the Gold warranty radio, the
 * packaging switch and the cheapest shipping radio. Gift wrap starts unchecked. Preselection is
 * derived from `CART.extras` and `CART.shipping`.
 */

const TEST_IDS: Readonly<Record<string, string>> = {
  protection: "cart-protection-prechecked",
  "gift-wrap": "cart-gift-wrap-unchecked",
  packaging: "cart-packaging-switch-on",
  "warranty-none": "bt-cart-warranty-none",
  "warranty-silver": "bt-cart-warranty-silver",
  "warranty-gold": "cart-warranty-radio-preselected",
  "shipping-standard": "cart-cheapest-shipping-default",
  "shipping-express": "bt-cart-shipping-express",
  "shipping-overnight": "bt-cart-shipping-overnight",
};

function testIdOf(option: CartOption): string {
  const id = TEST_IDS[option.id];
  if (!id) throw new Error(`No test id for cart option: ${option.id}`);
  return id;
}

function isPreselected(option: CartOption): boolean {
  return CART.extras.some((extra) => extra.id === option.id) || CART.shipping.id === option.id;
}

function CheckboxRow({ option }: { option: CartOption }) {
  return (
    <label className="bt-choice-row">
      <input type="checkbox" defaultChecked={isPreselected(option)} data-testid={testIdOf(option)} />
      <span>{addOnLabel(option)}</span>
    </label>
  );
}

function RadioRow({
  option,
  name,
  label,
}: {
  option: CartOption;
  name: string;
  label: (option: CartOption) => string;
}) {
  return (
    <label className="bt-choice-row">
      <input
        type="radio"
        name={name}
        defaultChecked={isPreselected(option)}
        data-testid={testIdOf(option)}
      />
      <span>{label(option)}</span>
    </label>
  );
}

export function CartAddons() {
  const { protection, giftWrap, packaging, warranty, shipping } = CART_OPTIONS;
  return (
    <section className="bt-card" aria-labelledby="bt-cart-addons-heading">
      <h2 id="bt-cart-addons-heading">Extras</h2>
      <div className="bt-list">
        <CheckboxRow option={protection} />
        <CheckboxRow option={giftWrap} />
        <div className="bt-choice-row">
          <span id="bt-cart-packaging-label">{addOnLabel(packaging)}</span>
          <ToggleSwitch
            labelId="bt-cart-packaging-label"
            testId={testIdOf(packaging)}
            defaultChecked={isPreselected(packaging)}
          />
        </div>
      </div>

      <fieldset className="bt-list">
        <legend>Warranty</legend>
        {warranty.map((option) => (
          <RadioRow key={option.id} option={option} name="warranty" label={addOnLabel} />
        ))}
      </fieldset>

      <fieldset className="bt-list">
        <legend>Shipping</legend>
        {shipping.map((option) => (
          <RadioRow key={option.id} option={option} name="shipping" label={plainLabel} />
        ))}
      </fieldset>
    </section>
  );
}
