'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Segmented } from 'antd';
import { useRouter } from '@/i18n/navigation';
import pricingStyles from './materialPricingPage.module.css';

const pages = [
  { key: 'overview', path: '', label: 'overview' },
  { key: 'purchases', path: '/purchases', label: 'purchases' },
  { key: 'analytics', path: '/analytics', label: 'analytics' },
  { key: 'distributors', path: '/distributors', label: 'distributorComparison' },
  { key: 'history', path: '/history', label: 'history' },
] as const;

export type MaterialPricingView = (typeof pages)[number]['key'];

export function MaterialPricingNavigation({
  active,
  groupId,
}: {
  active: MaterialPricingView;
  groupId?: string;
}) {
  const t = useTranslations('materialPricing');
  const router = useRouter();
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = navigation.current;
    if (!container) return;
    const revealCurrent = () => {
      const current = container.querySelector<HTMLElement>('.ant-segmented-item-selected');
      if (!current) return;
      const viewport = container.getBoundingClientRect();
      const item = current.getBoundingClientRect();
      if (item.left < viewport.left) container.scrollLeft += item.left - viewport.left - 2;
      else if (item.right > viewport.right) container.scrollLeft += item.right - viewport.right + 2;
    };
    revealCurrent();
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, t]);
  return (
    <nav ref={navigation} className={pricingStyles.navigation} aria-label={t('title')}>
      <Segmented
        size="large"
        aria-label={t('title')}
        value={active}
        disabled={!groupId}
        options={pages.map((page) => ({ value: page.key, label: t(page.label) }))}
        onChange={(key) => {
          const page = pages.find((item) => item.key === key);
          if (page && groupId)
            router.push(
              { pathname: `/admin/material-pricing${page.path}`, query: { group: groupId } },
              { scroll: false },
            );
        }}
      />
    </nav>
  );
}
