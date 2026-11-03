'use client';

import { Alert, Button, Checkbox, Input, Select, Space, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type { ExcelRowInput } from '@/lib/cabochonExcelImport/contracts';
import { normalizeExcelRow } from '@/lib/cabochonExcelImport/normalize';
import {
  sourceStyle,
  suggestStyles,
  type StyleOption,
} from '@/lib/cabochonExcelImport/styleReview';
import layout from './excelImport.module.css';

export function StyleStatus({
  name,
  id,
  created = false,
}: {
  name: string;
  id: string | null;
  created?: boolean;
}) {
  const t = useTranslations('cabochonExcel');
  return (
    <Tag color={created ? 'success' : id ? 'blue' : name ? 'warning' : 'default'}>
      {created
        ? t('styleCreated')
        : id
          ? t('styleExisting')
          : name
            ? t('stylePending')
            : t('styleNone')}
    </Tag>
  );
}

export function SettingStyleField({
  draft,
  options,
  busy,
  sameCount,
  applySame,
  onApplySame,
  onChange,
  createdStyleIds,
}: {
  draft: ExcelRowInput;
  options: StyleOption[];
  busy: boolean;
  sameCount: number;
  applySame: boolean;
  onApplySame: (value: boolean) => void;
  onChange: (value: ExcelRowInput) => void;
  createdStyleIds: Set<string>;
}) {
  const t = useTranslations('cabochonExcel');
  const parsed = normalizeExcelRow(draft, [], options);
  const choice = draft.styleChoice ?? 'AUTO';
  const suggestions =
    choice === 'NONE' || choice === 'SELECT' || parsed.settingStyleId
      ? []
      : suggestStyles(draft.values.style, options);
  const select = (id: string) => onChange({ ...draft, styleChoice: 'SELECT', styleId: id });
  return (
    <section className={layout.reviewSection}>
      <div className={layout.reviewHeading}>
        <strong>{t('fields.style')}</strong>
        <StyleStatus
          name={parsed.magicBoxStyle}
          id={parsed.settingStyleId}
          created={!!parsed.settingStyleId && createdStyleIds.has(parsed.settingStyleId)}
        />
      </div>
      <p className={layout.muted}>
        {t('styleOriginal', { value: sourceStyle(draft) || t('styleNone') })}
      </p>
      <label className={layout.field}>
        <span>{t('styleHandling')}</span>
        <Select
          aria-label={t('styleHandling')}
          showSearch
          optionFilterProp="label"
          disabled={busy}
          value={choice === 'SELECT' ? draft.styleId : choice}
          options={[
            { value: 'AUTO', label: t('styleAuto') },
            { value: 'NEW', label: t('styleNew') },
            { value: 'NONE', label: t('styleNone') },
            ...options.map((option) => ({
              value: option.id,
              label: createdStyleIds.has(option.id)
                ? `${option.magicBoxStyle} · ${t('styleCreated')}`
                : option.magicBoxStyle,
            })),
          ]}
          onChange={(value) =>
            onChange({
              ...draft,
              styleChoice:
                value === 'AUTO' || value === 'NEW' || value === 'NONE' ? value : 'SELECT',
              styleId: value === 'AUTO' || value === 'NEW' || value === 'NONE' ? null : value,
              values: {
                ...draft.values,
                style: value === 'AUTO' ? sourceStyle(draft) : draft.values.style,
              },
            })
          }
        />
      </label>
      {(choice === 'NEW' || (choice === 'AUTO' && !parsed.settingStyleId)) && (
        <label className={layout.field}>
          <span>{t('styleNewName')}</span>
          <Input
            aria-label={t('styleNewName')}
            value={draft.values.style}
            disabled={busy}
            maxLength={60}
            onChange={(event) =>
              onChange({
                ...draft,
                styleChoice: 'NEW',
                styleId: null,
                values: { ...draft.values, style: event.target.value },
              })
            }
          />
          <span className={layout.muted}>{t('styleCreateHelp')}</span>
        </label>
      )}
      {!!suggestions.length && (
        <Alert
          type="info"
          showIcon
          message={t('styleSuggestions')}
          description={
            <Space direction="vertical" className={layout.fullWidth}>
              <span>{t('styleSuggestionHelp')}</span>
              {suggestions.map((option) => (
                <div className={layout.suggestion} key={option.id}>
                  <span>{option.magicBoxStyle}</span>
                  <Button size="small" disabled={busy} onClick={() => select(option.id)}>
                    {t('styleUse')}
                  </Button>
                </div>
              ))}
              <Button
                size="small"
                disabled={busy}
                onClick={() => onChange({ ...draft, styleChoice: 'NEW', styleId: null })}
              >
                {t('styleKeepNew')}
              </Button>
            </Space>
          }
        />
      )}
      {sameCount > 0 && (
        <Checkbox
          checked={applySame}
          disabled={busy}
          onChange={(event) => onApplySame(event.target.checked)}
        >
          {t('styleApplySame', { count: sameCount })}
        </Checkbox>
      )}
    </section>
  );
}
