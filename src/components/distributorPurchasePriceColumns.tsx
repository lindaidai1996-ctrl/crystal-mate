'use client';

import { formatAmount } from '@/lib/format-money';

import type { ColumnsType } from 'antd/es/table';
import type {
  DistributorPriceRange,
  DistributorPurchaseEntry,
  DistributorPurchaseSummary,
} from '@/lib/client-types';
import { Sensitive } from '@/components/privacyMode';

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
      if (typeof value === 'string')
        return field === 'childUnitPrice' ? (
          <Sensitive>{formatAmount(value)}</Sensitive>
        ) : (
          formatAmount(value)
        );
      if (value.min === null || value.max === null) return t('unknownValue');
      const price =
        value.min === value.max
          ? formatAmount(value.min)
          : `${formatAmount(value.min)} ~ ${formatAmount(value.max)}`;
      const label = `${price}${value.hasUnknown ? ` · ${t('hasUnknown')}` : ''}`;
      return field === 'childUnitPrice' ? <Sensitive>{label}</Sensitive> : label;
    },
  }));
}
