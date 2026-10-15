import { notFound } from 'next/navigation';
import { ProductsPage } from '@/components/products-page';
import { getCatalogScope } from '@/lib/catalog-scopes';

export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const { scope: key } = await params;
  const scope = getCatalogScope(key);
  if (!scope) notFound();
  return <ProductsPage key={key} scope={scope} />;
}
