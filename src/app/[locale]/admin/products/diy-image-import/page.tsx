import { DiyImportPage } from '@/components/diyImageImport/diyImportPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; product?: string }>;
}) {
  const params = await searchParams;
  return <DiyImportPage initialId={params.draft} targetProductId={params.product} />;
}
