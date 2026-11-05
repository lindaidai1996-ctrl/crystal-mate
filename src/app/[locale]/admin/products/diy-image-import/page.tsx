import { DiyImportPage } from '@/components/diyImageImport/diyImportPage';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; product?: string; returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <DiyImportPage
      initialId={params.draft}
      targetProductId={params.product}
      returnTo={adminReturnPath(params.returnTo)}
    />
  );
}
