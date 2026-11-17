import { ClubOffers } from "@/components/boo-tique/club-offers";
import { ClubTimer } from "@/components/boo-tique/club-timer";

export default function BooTiqueClubPage() {
  return (
    <>
      <section aria-labelledby="bt-club-heading">
        <h1 id="bt-club-heading">The Midnight Club</h1>
        <ClubTimer />
      </section>
      <ClubOffers />
    </>
  );
}
