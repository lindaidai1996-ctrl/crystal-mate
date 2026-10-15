import { notFound } from 'next/navigation';
import { ProductMarketingConfig } from '@/components/product-marketing-config';

export default async function Page({ params }: { params: Promise<{ scope: string; id: string }> }) {
  const { scope, id } = await params;
  if (scope !== 'cabochons' || id === 'new') notFound();
  return <ProductMarketingConfig id={id} />;
}
