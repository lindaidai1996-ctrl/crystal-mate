import { notFound } from 'next/navigation';
import { ProductEditor } from '@/components/product-editor';
import { getCatalogScope } from '@/lib/catalog-scopes';

export default async function Page({ params }: { params: Promise<{ scope: string; id: string }> }) {
  const { scope: key, id } = await params;
  const scope = getCatalogScope(key);
  if (!scope) notFound();
  return <ProductEditor key={`${key}-${id}`} id={id} scope={scope} />;
}
