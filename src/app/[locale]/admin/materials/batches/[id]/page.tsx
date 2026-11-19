import { MaterialBatchDetailPage } from '@/components/materialManagement/materialBatchDetailPage';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    returnTo?: string | string[];
    view?: string | string[];
    distributorId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const { id } = await params;
  return (
    <MaterialBatchDetailPage
      key={id}
      id={id}
      initialView={query.view === 'attachments' ? 'attachments' : undefined}
      distributorId={typeof query.distributorId === 'string' ? query.distributorId : undefined}
      returnTo={adminReturnPath(query.returnTo)}
    />
  );
}
