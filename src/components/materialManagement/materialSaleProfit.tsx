'use client';

import { useTranslations } from 'next-intl';
import { amountToCents, centsToAmount } from '@/lib/cabochon-cost';
import type { MaterialAmount, MaterialUnit } from '@/lib/client-types';

export function MaterialSaleProfit({
  cost,
  salePrice,
  unit,
}: {
  cost: MaterialAmount;
  salePrice: MaterialAmount;
  unit: MaterialUnit;
}) {
  const t = useTranslations('materialEditor');
  const costCents = cost === null ? null : amountToCents(cost);
  const saleCents = salePrice === null ? null : amountToCents(salePrice);
  const profit = costCents === null || saleCents === null ? null : saleCents - costCents;
  const isLoss = profit !== null && profit < BigInt(0);

  return (
    <p
      className={`product-pricing-profit${profit === null ? ' is-pending' : isLoss ? ' is-loss' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {profit === null
        ? t('profitPending', { unit: t(unit) })
        : t.rich(isLoss ? 'estimatedLoss' : 'estimatedProfit', {
            unit: t(unit),
            amount: centsToAmount(isLoss ? -profit : profit),
            money: (chunks) => <strong>{chunks}</strong>,
          })}
    </p>
  );
}
