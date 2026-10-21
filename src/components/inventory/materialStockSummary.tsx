'use client';

import { useTranslations } from 'next-intl';
import type { Material } from '@/lib/client-types';

export function MaterialStockSummary({ material }: { material: Material }) {
  const t = useTranslations('inventory');
  const materials = useTranslations('materials');
  const values = {
    count: material.knownStock,
    unit: materials(material.unit),
    batches: material.unknownStockBatchCount,
  };
  return (
    <span>
      {material.unknownStockBatchCount ? t('partialStock', values) : t('knownStock', values)}
    </span>
  );
}
