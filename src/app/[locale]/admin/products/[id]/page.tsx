import { ProductEditor } from '@/components/product-editor';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const batchId = id === 'new' && typeof query.batchId === 'string' ? query.batchId : undefined;
  const distributorId =
    id === 'new' && typeof query.distributorId === 'string' ? query.distributorId : undefined;
  const draftId = id === 'new' && typeof query.draftId === 'string' ? query.draftId : undefined;
  const returnTo = adminReturnPath(query.returnTo);
  return (
    <ProductEditor
      key={JSON.stringify([id, batchId, distributorId])}
      id={id}
      initialBatchId={batchId}
      initialDistributorId={distributorId}
      initialDraftId={draftId}
      initialReturnTo={returnTo}
    />
  );
}
