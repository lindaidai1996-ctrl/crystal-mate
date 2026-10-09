import { ProductEditor } from '@/components/product-editor';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditor key={id} id={id} />;
}
