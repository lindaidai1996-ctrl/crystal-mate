import { notFound } from 'next/navigation';
import { ProductEditor } from '@/components/product-editor';
import { getCatalogScope } from '@/lib/catalog-scopes';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { scope: key, id } = await params;
  const scope = getCatalogScope(key);
  if (!scope) notFound();
  return (
    <ProductEditor
      key={`${key}-${id}`}
      id={id}
      scope={scope}
      initialReturnTo={adminReturnPath((await searchParams).returnTo)}
    />
  );
}
