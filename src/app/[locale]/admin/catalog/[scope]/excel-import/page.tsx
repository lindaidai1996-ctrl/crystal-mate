import { notFound } from 'next/navigation';
import { ExcelImportPage } from '@/components/cabochonExcelImport/excelImportPage';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  if ((await params).scope !== 'cabochons') notFound();
  return <ExcelImportPage initialId={(await searchParams).draft} />;
}
