'use client';

import { Switch } from 'antd';
import { useTranslations } from 'next-intl';
import type { Product } from '@/lib/client-types';

const marketingFields = ['videoShot', 'xiaohongshuVideoPublished', 'xiaohongshuListed'] as const;

export type CabochonMarketingField = (typeof marketingFields)[number];

export function CabochonMarketingStatus({
  product,
  pending,
  onChange,
}: {
  product: Product;
  pending: Record<string, boolean>;
  onChange: (id: string, field: CabochonMarketingField, value: boolean) => Promise<void>;
}) {
  const t = useTranslations('editor');

  return (
    <div className="product-marketing-status">
      {marketingFields.map((field) => {
        const loading = Boolean(pending[`${product.id}:${field}`]);
        return (
          <label key={field} className="product-marketing-status-item">
            <Switch
              size="small"
              aria-label={`${product.name}：${t(field)}`}
              checked={product.marketing?.[field] ?? false}
              loading={loading}
              disabled={loading}
              onChange={(checked) => void onChange(product.id, field, checked)}
            />
            <span>{t(field)}</span>
          </label>
        );
      })}
    </div>
  );
}
