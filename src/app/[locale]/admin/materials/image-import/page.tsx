import { ImageImportPage } from '@/components/materialImageImport/imageImportPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  return <ImageImportPage initialId={(await searchParams).import} />;
}
