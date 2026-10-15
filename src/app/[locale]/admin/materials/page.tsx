import { MaterialsPage } from '@/components/materialManagement/materialsPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q) ?? '';
  return <MaterialsPage key={query} initialQuery={query} />;
}
