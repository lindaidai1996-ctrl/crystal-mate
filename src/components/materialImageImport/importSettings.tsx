'use client';

import { Button, Cascader, Form, Select, Space } from 'antd';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Distributor, MaterialBatch, MaterialCategory } from '@/lib/client-types';
import { DistributorSelect } from '@/components/distributorSelect/distributorSelect';
import { BatchSelector } from '@/components/materialManagement/batchSelector';
import { categoryTree } from '@/components/materialManagement/categoryTree';
import type {
  ImportItemData,
  ImportSettings as Settings,
} from '@/lib/materialImageImport/contracts';
import importStyles from './materialImageImport.module.css';

export function ImportSettings({
  settings,
  distributors,
  batches,
  categories,
  disabled,
  onChange,
  onApply,
}: {
  settings: Settings;
  distributors: Distributor[];
  batches: MaterialBatch[];
  categories: MaterialCategory[];
  disabled: boolean;
  onChange: (settings: Settings) => void;
  onApply: (patch: Partial<ImportItemData>) => void;
}) {
  const t = useTranslations('imageImport');
  const [categoryId, setCategoryId] = useState('');
  const [path, setPath] = useState<string[]>([]);
  return (
    <Form layout="vertical" disabled={disabled} className={importStyles.settings}>
      <div className={importStyles.fields}>
        <Form.Item label={t('supplier')} required>
          <DistributorSelect
            aria-label={t('supplier')}
            distributors={distributors}
            value={settings.distributorId || undefined}
            onChange={(distributorId) => onChange({ ...settings, distributorId })}
          />
        </Form.Item>
        <Form.Item label={t('defaultPriceKind')}>
          <Select
            value={settings.priceKind}
            options={[
              { value: 'PURCHASE', label: t('purchase') },
              { value: 'SALE', label: t('sale') },
            ]}
            onChange={(priceKind) => onChange({ ...settings, priceKind })}
          />
        </Form.Item>
      </div>
      <BatchSelector
        selection={settings.selection}
        batches={batches}
        onChange={(selection) => onChange({ ...settings, selection })}
      />
      <Space wrap align="start">
        <Cascader
          placeholder={t('category')}
          options={categoryTree(categories)}
          showSearch
          changeOnSelect
          value={path}
          onChange={(next) => {
            setPath(next ?? []);
            setCategoryId(String(next?.at(-1) ?? ''));
          }}
        />
        <Button
          disabled={!categoryId || disabled}
          onClick={() => onApply({ categoryId, reviewed: false })}
        >
          {t('applyCategory')}
        </Button>
        <Button onClick={() => onApply({ priceKind: settings.priceKind, reviewed: false })}>
          {t('applyPriceKind')}
        </Button>
      </Space>
      <p className={importStyles.hint}>{t('settingsHint')}</p>
    </Form>
  );
}
