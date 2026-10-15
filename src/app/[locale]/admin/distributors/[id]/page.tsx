import { DistributorDetailPage } from '@/components/distributor-detail-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DistributorDetailPage key={id} id={id} />;
}
