'use client';

import { Button, InputNumber, Select, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { excelFields, type ColumnMapping } from '@/lib/cabochonExcelImport/contracts';
import { detectColumns } from '@/lib/cabochonExcelImport/normalize';
import type { WorkbookSheet } from '@/lib/cabochonExcelImport/workbook';
import layout from './excelImport.module.css';

export function ExcelColumnMapping({
  sheet,
  headerRow,
  mapping,
  onHeader,
  onMapping,
  onPrepare,
  busy,
}: {
  sheet: WorkbookSheet;
  headerRow: number;
  mapping: ColumnMapping;
  onHeader: (row: number) => void;
  onMapping: (mapping: ColumnMapping) => void;
  onPrepare: () => void;
  busy: boolean;
}) {
  const t = useTranslations('cabochonExcel');
  const header = sheet.rows.find((row) => row.rowNumber === headerRow);
  const columns = [...new Set(sheet.rows.flatMap((row) => Object.keys(row.cells)))];
  return (
    <section className={`editor-surface ${layout.section}`}>
      <Space wrap>
        <h2>{t('mappingTitle')}</h2>
        <label>
          {t('headerRow')}{' '}
          <InputNumber
            aria-label={t('headerRow')}
            min={1}
            max={1048576}
            value={headerRow}
            disabled={busy}
            onChange={(value) => {
              if (value) {
                onHeader(value);
                onMapping(
                  detectColumns(sheet.rows.find((row) => row.rowNumber === value)?.cells ?? {}),
                );
              }
            }}
          />
        </label>
      </Space>
      <p className={layout.muted}>{t('mappingHelp')}</p>
      <div className={layout.mappingGrid}>
        {excelFields.map((field) => (
          <label key={field}>
            <span>{t(`fields.${field}`)}</span>
            <Select
              aria-label={t(`fields.${field}`)}
              value={mapping[field]}
              allowClear
              disabled={busy}
              placeholder={t('unmapped')}
              showSearch
              optionFilterProp="label"
              options={columns.map((column) => ({
                value: column,
                label: `${column} · ${header?.cells[column] || t('emptyHeader')}`,
              }))}
              onChange={(value) => onMapping({ ...mapping, [field]: value })}
            />
          </label>
        ))}
      </div>
      <Button
        type="primary"
        disabled={busy || !Object.values(mapping).some(Boolean)}
        loading={busy}
        onClick={onPrepare}
      >
        {t('preview')}
      </Button>
    </section>
  );
}
