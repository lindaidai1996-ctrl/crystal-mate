import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { shanghaiDate } from '@/lib/metal-market';
import { AppProviders } from '@/components/app-providers';
import { MetalMarket } from '@/components/metal-market/metal-market';
import { SiteRegistrationFooter } from '@/components/site-registration-footer';

type MarketPageProps = { searchParams: Promise<{ lang?: string; metal?: string }> };

export async function generateMetadata({ searchParams }: MarketPageProps): Promise<Metadata> {
  const isEnglish = (await searchParams).lang === 'en';
  return {
    title: isEnglish
      ? 'Gold & Silver Prices & History | IWISH'
      : '今日金银价与历史走势 · 祝余 IWISH',
    description: isEnglish
      ? 'View the latest Au(T+D) gold and Ag(T+D) silver prices and historical trends with IWISH.'
      : '祝余 IWISH 金银价查询：切换黄金 Au(T+D) 与白银 Ag(T+D) 最新行情，查看历史走势。',
  };
}

export default async function MetalPricePage({ searchParams }: MarketPageProps) {
  const params = await searchParams;
  const locale = params.lang === 'en' ? 'en' : 'zh';
  const metal = params.metal === 'gold' ? 'gold' : 'silver';
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ dateRangeFilter: messages.dateRangeFilter, mobile: messages.mobile }}
      timeZone="Asia/Shanghai"
    >
      <AppProviders>
        <MetalMarket today={shanghaiDate()} initialMetal={metal} />
        <SiteRegistrationFooter />
      </AppProviders>
    </NextIntlClientProvider>
  );
}
