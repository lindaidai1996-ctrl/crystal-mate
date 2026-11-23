import { ProcurementLedger } from '@/components/materialPricing/procurementLedger';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const { group } = await searchParams;
  return <ProcurementLedger standalone initialGroupId={group} />;
}
