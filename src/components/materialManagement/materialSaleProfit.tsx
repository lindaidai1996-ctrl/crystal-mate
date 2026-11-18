'use client';

import { useTranslations } from 'next-intl';
import { amountToCents, centsToAmount } from '@/lib/cabochon-cost';
import type { MaterialAmount, MaterialUnit } from '@/lib/client-types';
import { usePrivacyMode } from '@/components/privacyMode';

export function MaterialSaleProfit({
  cost,
  salePrice,
  unit,
  lossAdjusted = false,
}: {
  cost: MaterialAmount;
  salePrice: MaterialAmount;
  unit: MaterialUnit;
  lossAdjusted?: boolean;
}) {
  const t = useTranslations('materialEditor');
  const privacyMode = usePrivacyMode();
  if (privacyMode) return null;
  const costCents = cost === null ? null : amountToCents(cost);
  const saleCents = salePrice === null ? null : amountToCents(salePrice);
  const profit = costCents === null || saleCents === null ? null : saleCents - costCents;
  const isLoss = profit !== null && profit < BigInt(0);

  return (
    <p
      className={`product-pricing-profit${lossAdjusted ? ' material-loss-profit' : ''}${profit === null ? ' is-pending' : isLoss ? ' is-loss' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {profit === null
        ? t('profitPending', { unit: t(unit) })
        : t.rich(
            lossAdjusted
              ? isLoss
                ? 'lossAdjustedLoss'
                : 'lossAdjustedProfit'
              : isLoss
                ? 'estimatedLoss'
                : 'estimatedProfit',
            {
              unit: t(unit),
              amount: centsToAmount(isLoss ? -profit : profit),
              money: (chunks) => <strong>{chunks}</strong>,
            },
          )}
    </p>
  );
}
