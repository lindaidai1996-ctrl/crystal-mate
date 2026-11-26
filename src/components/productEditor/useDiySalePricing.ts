'use client';

import { App } from 'antd';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { Product, ProductSourceInput } from '@/lib/client-types';
import { diySaleSummary, savedDiySalePricing } from '@/lib/diy-sale-pricing';
import type { ProductPricingValues } from '@/lib/product-pricing';
import { productSchemeDraft } from '../priceSchemes/schemePriceFields';
import type { SchemePricesWrite } from '@/lib/price-schemes/contracts';
import { sourceRulePriceChangeSchema } from '@/lib/product-source-write';

export function useDiySalePricing(draft: ProductSourceInput, product: Product | null) {
  const t = useTranslations('productSources');
  const { modal } = App.useApp();
  const [value, setValue] = useState(() => savedDiySalePricing(product));
  const [schemePrices, setSchemePrices] = useState(() => productSchemeDraft(product));
  const [edited, setEdited] = useState(false);
  const baseline = useRef(JSON.stringify(draft));
  const summary = diySaleSummary(draft, value.price, product?.priceCents ?? 0);
  const saved = savedDiySalePricing(product);
  const parsed = sourceRulePriceChangeSchema.safeParse({
    priceCents: summary.priceCents,
    schemePrices,
    saleRule: value.saleRule,
    saleRuleValue: value.saleRuleValue,
    saleManual: value.saleManual,
    expectedPriceCents: product?.priceCents ?? 0,
    expectedPricing: {
      saleRule: saved.saleRule,
      saleRuleValue: saved.saleRuleValue,
      saleManual: saved.saleManual,
    },
  });

  function changePricing(value: ProductPricingValues) {
    setValue(value);
    setEdited(true);
  }

  function confirmDiscard(action: () => void) {
    if (!edited && baseline.current === JSON.stringify(draft)) {
      action();
      return;
    }
    modal.confirm({
      title: t('discardPricingTitle'),
      content: t('discardPricingDescription'),
      okText: t('discardPricing'),
      cancelText: t('continuePricing'),
      onOk: action,
    });
  }

  function reset(source: ProductSourceInput) {
    baseline.current = JSON.stringify(source);
    setValue(savedDiySalePricing(product));
    setSchemePrices(productSchemeDraft(product));
    setEdited(false);
  }

  return {
    value,
    schemePrices,
    changeSchemePrices: (next: SchemePricesWrite) => {
      setSchemePrices(next);
      setEdited(true);
    },
    edited,
    summary,
    payload: parsed.success ? parsed.data : null,
    changePricing,
    confirmDiscard,
    reset,
  };
}
