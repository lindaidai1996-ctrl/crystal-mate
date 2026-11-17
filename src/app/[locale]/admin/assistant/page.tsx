import { AssistantPage } from '@/components/assistant/assistantPage';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  const { conversation } = await searchParams;
  return <AssistantPage initialId={typeof conversation === 'string' ? conversation : null} />;
}
