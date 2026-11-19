import { BatchComparisonPage } from '@/components/batchComparison/batchComparisonPage';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <BatchComparisonPage
      kind="product"
      id={id}
      returnTo={adminReturnPath((await searchParams).returnTo)}
    />
  );
}
