import { MaterialPricingPage } from '@/components/materialPricing/materialPricingPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  return <MaterialPricingPage view="distributors" initialGroupId={group} />;
}
