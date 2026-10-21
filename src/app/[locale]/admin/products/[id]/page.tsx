import { ProductEditor } from '@/components/product-editor';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = id === 'new' ? await searchParams : {};
  const batchId = typeof query.batchId === 'string' ? query.batchId : undefined;
  const distributorId = typeof query.distributorId === 'string' ? query.distributorId : undefined;
  return (
    <ProductEditor
      key={JSON.stringify([id, batchId, distributorId])}
      id={id}
      initialBatchId={batchId}
      initialDistributorId={distributorId}
    />
  );
}
