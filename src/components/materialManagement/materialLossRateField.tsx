'use client';

import { Form, InputNumber } from 'antd';
import { useTranslations } from 'next-intl';
import type { MaterialAmount } from '@/lib/client-types';
import { usePrivacyMode } from '@/components/privacyMode';

export function MaterialLossRateField({
  value,
  onChange,
  isDefault = false,
  compact = false,
}: {
  value: MaterialAmount;
  onChange: (value: MaterialAmount) => void;
  isDefault?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('materialEditor');
  const privacyMode = usePrivacyMode();
  if (privacyMode) return null;
  return (
    <Form.Item
      className="material-loss-rate"
      label={t(compact ? 'lossRateOptional' : isDefault ? 'defaultLossRate' : 'lossRate')}
      tooltip={compact ? t('lossRateHelp') : undefined}
      extra={compact ? undefined : t(isDefault ? 'defaultLossRateHelp' : 'lossRateHelp')}
    >
      <InputNumber<string>
        stringMode
        inputMode="decimal"
        value={value}
        onChange={onChange}
        min="0"
        max="99.99"
        step="0.01"
        precision={2}
        suffix="%"
        placeholder={t(compact ? 'lossRateCompactEmpty' : 'lossRateEmpty')}
        aria-label={t(isDefault ? 'defaultLossRate' : 'lossRate')}
        style={{ width: '100%' }}
      />
    </Form.Item>
  );
}
