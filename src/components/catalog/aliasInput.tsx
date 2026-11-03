'use client';

import { Select } from 'antd';
import { useTranslations } from 'next-intl';
import { normalizeAliases } from '@/lib/catalog-aliases';

export function AliasInput({
  value = [],
  onChange,
  disabled,
}: {
  value?: string[];
  onChange?: (aliases: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <Select
      mode="tags"
      value={value}
      onChange={(aliases) => onChange?.(normalizeAliases(aliases))}
      disabled={disabled}
      aria-label={t('aliases')}
      placeholder={t('aliasesPlaceholder')}
      tokenSeparators={[',', '，']}
      maxCount={20}
      maxTagCount="responsive"
      allowClear
    />
  );
}
