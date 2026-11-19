import { notFound } from 'next/navigation';
import { ProductEditor } from '@/components/product-editor';
import { getCatalogScope } from '@/lib/catalog-scopes';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<{ returnTo?: string | string[]; sourceId?: string | string[] }>;
}) {
  const { scope: key, id } = await params;
  const scope = getCatalogScope(key);
  if (!scope) notFound();
  const query = await searchParams;
  const sourceId = id !== 'new' && typeof query.sourceId === 'string' ? query.sourceId : undefined;
  return (
    <ProductEditor
      key={`${key}-${id}-${sourceId ?? ''}`}
      id={id}
      scope={scope}
      initialSourceId={sourceId}
      initialReturnTo={adminReturnPath(query.returnTo)}
    />
  );
}
