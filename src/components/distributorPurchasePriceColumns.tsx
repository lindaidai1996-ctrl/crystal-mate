'use client';

import type { ColumnsType } from 'antd/es/table';
import type {
  DistributorPriceRange,
  DistributorPurchaseEntry,
  DistributorPurchaseSummary,
} from '@/lib/client-types';

type PriceRow = DistributorPurchaseEntry | DistributorPurchaseSummary;

export function distributorPurchasePriceColumns<Row extends PriceRow>(
  t: (key: string) => string,
): ColumnsType<Row> {
  return (['saleUnitPrice', 'childUnitPrice', 'saleChildUnitPrice'] as const).map((field) => ({
    title: t(field),
    key: field,
    width: 140,
    render: (_, row) => {
      if (
        field !== 'saleUnitPrice' &&
        (row.type !== 'MATERIAL' || (row.unit !== 'STRAND' && row.unit !== 'BEAD'))
      )
        return '—';
      const value: string | DistributorPriceRange | null = row[field];
      if (value === null) return t('unknownValue');
      if (typeof value === 'string') return value;
      if (value.min === null || value.max === null) return t('unknownValue');
      const price = value.min === value.max ? value.min : `${value.min} ~ ${value.max}`;
      return `${price}${value.hasUnknown ? ` · ${t('hasUnknown')}` : ''}`;
    },
  }));
}
