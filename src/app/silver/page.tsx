import { redirect } from 'next/navigation';

export default async function SilverPricePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  redirect((await searchParams).lang === 'en' ? '/yj?lang=en' : '/yj');
}
