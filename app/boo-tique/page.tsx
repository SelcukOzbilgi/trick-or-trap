import { CookieBanner } from "@/components/boo-tique/cookie-banner";
import { HeroCountdown } from "@/components/boo-tique/hero-countdown";
import { ProductGrid } from "@/components/boo-tique/product-grid";
import { FIXED_SALE_TEXT, ROLLING_MIDNIGHT_TEXT } from "@/lib/boo-tique/content";
import { pickVariant, type SearchParamsRecord } from "@/lib/boo-tique/variants";

const BANNER_VARIANTS = ["default", "ghost", "equal"] as const;
const MODAL_VARIANTS = ["none", "exit-intent"] as const;

export default async function BooTiqueHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const query = await searchParams;
  const banner = pickVariant(query.banner, BANNER_VARIANTS, "default");
  const modal = pickVariant(query.modal, MODAL_VARIANTS, "none");
  const showUrgencyBlock = banner === "default" && modal === "none";

  return (
    <>
      {showUrgencyBlock ? (
        <section className="bt-card" aria-label="Sales">
          <HeroCountdown />
          <p data-testid="home-rolling-midnight-text">{ROLLING_MIDNIGHT_TEXT}</p>
          <p data-testid="home-fixed-date-sale">{FIXED_SALE_TEXT}</p>
        </section>
      ) : null}
      <ProductGrid />
      {modal === "none" ? <CookieBanner variant={banner} /> : null}
    </>
  );
}
