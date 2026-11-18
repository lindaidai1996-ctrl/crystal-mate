import { redirect } from 'next/navigation';

export default async function SilverPricePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(locale === 'en' ? '/yj?lang=en' : '/yj');
}
