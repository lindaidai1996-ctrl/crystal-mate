import { notFound } from 'next/navigation';
import { ProductCardsPage } from '@/components/productCards/productCardsPage';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (id === 'new') notFound();
  const query = await searchParams;
  return (
    <ProductCardsPage
      productId={id}
      returnTo={adminReturnPath(query.returnTo) ?? `/admin/products/${id}`}
    />
  );
}
