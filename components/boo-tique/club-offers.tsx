import { EQUAL_BUTTON_STYLE } from "@/lib/boo-tique/styles";

type Offer = {
  readonly key: "discount" | "shipping" | "protection" | "newsletter";
  readonly heading: string;
  readonly body: string;
  readonly accept: string;
  readonly decline: string;
  /** Ground-truth entry id carried by the decline button. */
  readonly declineId: string;
};

const OFFERS: readonly Offer[] = [
  {
    key: "discount",
    heading: "Club welcome offer",
    body: "Join the Midnight Club and take 20% off your first order.",
    accept: "Yes, give me 20% off!",
    decline: "No thanks, I hate saving money",
    declineId: "club-modal-hate-saving",
  },
  {
    key: "shipping",
    heading: "Ghost-post shipping",
    body: "Club members get free ghost-post shipping on every order.",
    accept: "Yes, ship it free",
    decline: "I'll pay full price like a mortal",
    declineId: "club-modal-full-price-mortal",
  },
  {
    key: "protection",
    heading: "Raven Shipping Protection",
    body: "Cover your parcel on its way from the crypt to your door.",
    accept: "Add protection",
    decline: "Maybe later, I don't need protection",
    declineId: "club-modal-no-need-protection",
  },
  {
    key: "newsletter",
    heading: "The Boo-letter",
    body: "New curses and candles in your inbox once a week.",
    accept: "Subscribe",
    decline: "No thanks",
    declineId: "club-plain-no-thanks",
  },
];

/**
 * The four club offer cards. Every accept and decline pair shares one style. The buttons do
 * nothing: no form, no handler, nothing is submitted.
 */
export function ClubOffers() {
  return (
    <div className="bt-list">
      {OFFERS.map((offer) => (
        <section
          key={offer.key}
          className="bt-card"
          data-testid={`bt-club-offer-${offer.key}`}
        >
          <h2>{offer.heading}</h2>
          <p>{offer.body}</p>
          <p>
            <button
              type="button"
              style={EQUAL_BUTTON_STYLE}
              data-testid={`bt-club-accept-${offer.key}`}
            >
              {offer.accept}
            </button>{" "}
            <button
              type="button"
              style={EQUAL_BUTTON_STYLE}
              data-testid={offer.declineId}
            >
              {offer.decline}
            </button>
          </p>
        </section>
      ))}
    </div>
  );
}
