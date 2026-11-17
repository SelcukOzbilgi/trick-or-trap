import { AccountPlans } from "@/components/boo-tique/account-plans";
import { pickVariant, type SearchParamsRecord } from "@/lib/boo-tique/variants";

const PLAN_VARIANTS = ["default", "honest"] as const;

export default async function BooTiqueSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const query = await searchParams;
  const plan = pickVariant(query.plan, PLAN_VARIANTS, "default");

  return (
    <>
      <h1>Your membership</h1>
      <AccountPlans variant={plan} />
    </>
  );
}
