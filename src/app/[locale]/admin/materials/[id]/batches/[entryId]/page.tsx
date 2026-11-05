import { MaterialEditor } from '@/components/materialManagement/materialEditor';
import { adminReturnPath } from '@/lib/admin-return-path';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; entryId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id, entryId } = await params;
  return (
    <MaterialEditor
      key={`${id}-${entryId}`}
      id={id}
      entryId={entryId}
      initialReturnTo={adminReturnPath((await searchParams).returnTo)}
    />
  );
}
