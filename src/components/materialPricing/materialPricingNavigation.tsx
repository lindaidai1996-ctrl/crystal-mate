'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Link } from '@/i18n/navigation';
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
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = navigation.current;
    const current = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !current) return;
    const start = current.offsetLeft;
    const end = start + current.offsetWidth;
    if (start < container.scrollLeft) container.scrollLeft = start;
    else if (end > container.scrollLeft + container.clientWidth)
      container.scrollLeft = end - container.clientWidth;
  }, [active, t]);
  return (
    <nav ref={navigation} className={pricingStyles.navigation} aria-label={t('title')}>
      {pages.map((page) => (
        <Link
          key={page.key}
          href={{
            pathname: `/admin/material-pricing${page.path}`,
            ...(groupId ? { query: { group: groupId } } : {}),
          }}
          aria-current={active === page.key ? 'page' : undefined}
        >
          {t(page.label)}
        </Link>
      ))}
    </nav>
  );
}
