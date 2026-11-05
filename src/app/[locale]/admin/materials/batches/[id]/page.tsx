import { MaterialBatchDetailPage } from '@/components/materialManagement/materialBatchDetailPage';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  return (
    <MaterialBatchDetailPage
      id={(await params).id}
      returnTo={adminReturnPath((await searchParams).returnTo)}
    />
  );
}
