import { notFound } from 'next/navigation';
import { ProductsPage } from '@/components/products-page';
import { getCatalogScope } from '@/lib/catalog-scopes';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ settingStyleId?: string | string[] }>;
}) {
  const { scope: key } = await params;
  const scope = getCatalogScope(key);
  if (!scope) notFound();
  const query = await searchParams;
  const initialSettingStyleId =
    typeof query.settingStyleId === 'string' ? query.settingStyleId : undefined;
  return (
    <ProductsPage
      key={`${key}:${initialSettingStyleId ?? ''}`}
      scope={scope}
      initialSettingStyleId={initialSettingStyleId}
    />
  );
}
