'use client';

import { Button, Tag } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { formatAmount } from '@/lib/format-money';
import type { PricingGroup } from '@/lib/material-pricing/contracts';
import pricingStyles from './materialPricingPage.module.css';

export function MaterialPricingGroupSummary({
  group,
  showPrice,
  onConfigure,
}: {
  group: PricingGroup;
  showPrice: boolean;
  onConfigure: () => void;
}) {
  const t = useTranslations('materialPricing');
  return (
    <div className={pricingStyles.title}>
      <div>
        <div className={pricingStyles.groupSummary}>
          <h2>{group.name}</h2>
          <Tag bordered={false}>{t(group.enabled ? 'enabled' : 'disabled')}</Tag>
          <span className={pricingStyles.muted}>
            {t('materialCount', { count: group.materials.length })}
          </span>
        </div>
        {showPrice && (
          <p className={pricingStyles.muted}>
            {t('executionPrice')}:{' '}
            {group.publication ? `¥${formatAmount(group.publication.saleGramPrice)}` : '—'} /{' '}
            {t('gram')}
          </p>
        )}
      </div>
      <Button icon={<EditOutlined />} onClick={onConfigure}>
        {t('configure')}
      </Button>
    </div>
  );
}
