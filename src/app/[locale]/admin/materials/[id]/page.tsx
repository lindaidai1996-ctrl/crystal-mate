import { MaterialEditor } from '@/components/materialManagement/materialEditor';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MaterialEditor key={id} id={id} />;
}
