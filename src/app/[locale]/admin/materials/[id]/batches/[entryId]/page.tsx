import { MaterialEditor } from '@/components/materialManagement/materialEditor';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  return <MaterialEditor key={`${id}-${entryId}`} id={id} entryId={entryId} />;
}
