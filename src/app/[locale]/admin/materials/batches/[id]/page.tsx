import { MaterialBatchDetailPage } from '@/components/materialManagement/materialBatchDetailPage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MaterialBatchDetailPage id={(await params).id} />;
}
