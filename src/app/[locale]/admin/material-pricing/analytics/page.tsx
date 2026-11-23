import { ProcurementAnalyticsPage } from '@/components/materialPricing/procurementAnalyticsPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  return <ProcurementAnalyticsPage initialGroupId={group} />;
}
