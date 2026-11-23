import { Decimal } from '@prisma/client/runtime/index-browser.js';
import { z } from 'zod';
import type { ParsedWorkbook } from '@/lib/cabochonExcelImport/workbook';
import {
  defaultSilverColumns,
  silverKinds,
  silverProcurement,
  type SilverColumnMapping,
  type SilverDraftRow,
  type SilverIssue,
} from './contracts';

const numeric = (value: string) => /^\d{1,12}(?:\.\d{1,20})?$/.test(value.trim());
export function excelProcurementDate(value: string, date1904 = false) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const text = /^(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?$/.exec(value);
  if (text) return `${text[1]}-${text[2].padStart(2, '0')}-${text[3].padStart(2, '0')}`;
  if (!/^\d{1,6}(?:\.0+)?$/.test(value)) return '';
  const serial = Number(value);
  if (!date1904 && serial === 60) return '';
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const result = new Date(base + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86400000);
  return result.toISOString().slice(0, 10);
}
export function normalizeSilverWorkbook(
  workbook: ParsedWorkbook,
  sheetName: string,
  headerRow: number,
  mapping: SilverColumnMapping = defaultSilverColumns,
): SilverDraftRow[] {
  const sheet = workbook.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error('EXCEL_INVALID_FILE');
  const result: SilverDraftRow[] = [];
  for (const row of sheet.rows) {
    if (row.rowNumber <= headerRow) continue;
    const read = (column: string) => (row.cells[column] ?? '').trim();
    const lines = silverKinds.flatMap((kind) => {
      const columns = mapping.lines[kind];
      const weight = read(columns.weight);
      if (weight === '' || (numeric(weight) && new Decimal(weight).isZero())) return [];
      const quote = read(columns.quote) || null,
        price = read(columns.price),
        sourceAmount = read(columns.amount);
      const amount =
        numeric(weight) && numeric(price)
          ? new Decimal(weight).mul(price).toFixed(2)
          : numeric(sourceAmount)
            ? new Decimal(sourceAmount).toFixed(2)
            : '';
      return [
        {
          kind,
          materialId: '',
          weight,
          quote,
          amount,
          amountConfirmed: false,
          sourceWeight: weight,
          sourcePrice: price,
          sourceAmount,
        },
      ];
    });
    if (!lines.length) continue;
    result.push({
      date1904: workbook.date1904 ?? false,
      rowNumber: row.rowNumber,
      receivedAt: excelProcurementDate(read(mapping.date), workbook.date1904),
      sourceSupplier: read(mapping.supplier),
      distributorId: '',
      original: Object.fromEntries(
        Object.entries(row.cells).map(([column, value]) => [
          column,
          {
            value,
            type: row.cellMetadata?.[column]?.type ?? '',
            formula: row.cellMetadata?.[column]?.formula ?? null,
            cached: row.cellMetadata?.[column]?.cached ?? value,
            formulaAttributes: row.cellMetadata?.[column]?.formulaAttributes,
          },
        ]),
      ),
      lines,
      skipped: false,
      allowDuplicate: false,
      receipt: null,
    });
  }
  if (result.length > 300) throw new Error('EXCEL_TOO_MANY_ROWS');
  return result;
}
export function silverRowIssues(row: SilverDraftRow): SilverIssue[] {
  const issues: SilverIssue[] = [];
  if (!z.iso.date().safeParse(row.receivedAt).success) issues.push({ code: 'DATE_REQUIRED' });
  if (!row.distributorId) issues.push({ code: 'SUPPLIER_REQUIRED' });
  for (const line of row.lines) {
    if (!line.materialId) issues.push({ code: 'MATERIAL_REQUIRED', kind: line.kind });
    if (!line.amountConfirmed) {
      if (
        (line.sourcePrice !== '' && !numeric(line.sourcePrice)) ||
        (line.sourceAmount !== '' && !numeric(line.sourceAmount))
      )
        issues.push({ code: 'SOURCE_VALUE_INVALID', kind: line.kind });
      if (numeric(line.sourceWeight) && numeric(line.sourcePrice) && numeric(line.sourceAmount)) {
        const expected = new Decimal(line.sourceWeight).mul(line.sourcePrice).toFixed(2);
        if (!new Decimal(expected).eq(new Decimal(line.sourceAmount).toFixed(2)))
          issues.push({ code: 'AMOUNT_CONFLICT', kind: line.kind });
      }
    }
  }
  if (
    !silverProcurement(row).success &&
    !issues.some((issue) =>
      ['DATE_REQUIRED', 'SUPPLIER_REQUIRED', 'MATERIAL_REQUIRED'].includes(issue.code),
    )
  )
    issues.push({ code: 'INVALID_VALUES' });
  return issues;
}
