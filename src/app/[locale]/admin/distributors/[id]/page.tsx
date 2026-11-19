import { DistributorDetailPage } from '@/components/distributor-detail-page';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  return (
    <DistributorDetailPage
      key={id}
      id={id}
      requestedView={typeof view === 'string' ? view : undefined}
    />
  );
}
