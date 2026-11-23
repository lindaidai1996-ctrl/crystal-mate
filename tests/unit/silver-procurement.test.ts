import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseWorkbook } from '@/lib/cabochonExcelImport/workbook';
import {
  amountFromDiscount,
  procurementMetrics,
  procurementSchema,
} from '@/lib/material-pricing/purchase-contracts';
import {
  isPricingOnlyBatch,
  selectablePurchaseBatches,
} from '@/lib/material-pricing/batch-visibility';
import {
  availablePricingBatchName,
  pricingBatchNameBase,
} from '@/lib/material-pricing/batch-names';
import {
  normalizeSilverWorkbook,
  excelProcurementDate,
  silverRowIssues,
} from '@/lib/material-pricing-import/normalize';
import { silverProcurement, type SilverDraftRow } from '@/lib/material-pricing-import/contracts';
import { correctedRemainingQuantity, materialStockSummary } from '@/lib/inventory';
import { calculatePurchase, emptyPurchase } from '@/lib/material-purchase';
import { emptyMaterial } from '@/lib/material-defaults';

const materialId = 'cm000000000000000000000001',
  distributorId = 'cm000000000000000000000002';
function workbook(date1904 = false) {
  const parts = {
    'xl/workbook.xml': `<workbook xmlns:r="r"><workbookPr date1904="${date1904 ? '1' : '0'}"/><sheets><sheet name="总账" r:id="r1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row r="4"><c r="A4"><v>46341</v></c><c r="B4"><v>100</v></c><c r="C4"><v>20</v></c><c r="D4"><f>C4*0.85</f><v>17</v></c><c r="E4"><v>10</v></c><c r="F4"><v>25</v></c><c r="G4"><v>20</v></c><c r="H4"><v>5</v></c><c r="I4"><v>30</v></c><c r="J4"><v>24</v></c><c r="L4"><v>99999</v></c><c r="N4" t="inlineStr"><is><t>供应商-微信</t></is></c><c r="P4"><f>B4*D4</f><v>1700</v></c><c r="Q4"><v>200</v></c><c r="R4"><v>120</v></c></row><row r="5"><c r="B5"><v>3</v></c><c r="C5"><v>20</v></c><c r="D5"><v>17</v></c><c r="P5"><f>C5*D5</f><v>340</v></c></row></sheetData></worksheet>',
  };
  return parseWorkbook(
    zipSync(Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, strToU8(value)]))),
  );
}
function ready(row: SilverDraftRow): SilverDraftRow {
  return {
    ...row,
    distributorId,
    lines: row.lines.map((line, index) => ({
      ...line,
      materialId: index === 0 ? materialId : `cm00000000000000000000001${index}`,
    })),
  };
}
describe('silver procurement financial rules', () => {
  it('keeps original prices out of actual costs and does not derive totals from them', () => {
    const purchase = {
      ...emptyPurchase(),
      mode: 'BATCH' as const,
      quotePurpose: 'BEFORE_DISCOUNT' as const,
      quotedGramPrice: '20',
      totalWeightGrams: '100',
      totalAmount: '1700',
      autoField: 'totalAmount' as const,
    };
    const result = calculatePurchase({ ...emptyMaterial(), unit: 'GRAM' }, purchase, 100);
    expect(result.values.purchaseGramPrice).toBe('17.00');
    expect(result.purchase.quotedGramPrice).toBe('20');
    expect(result.purchase.totalAmount).toBe('1700');
    expect(result.purchase.autoField).toBeNull();
    expect(
      calculatePurchase(
        { ...emptyMaterial(), unit: 'GRAM' },
        { ...purchase, totalAmount: null },
        100,
      ).valid,
    ).toBe(false);
  });
  it('calculates discounts from exact amounts and weight rather than rounded gram prices', () => {
    expect(procurementMetrics('3', '50', '20')).toEqual({
      actualPrice: '16.6667',
      discount: '8.33',
    });
    expect(procurementMetrics('100', '1700', '20')).toEqual({
      actualPrice: '17.0000',
      discount: '8.50',
    });
    expect(procurementMetrics('100', '0', '20').discount).toBe('0.00');
    expect(procurementMetrics('100', '1700', null).discount).toBeNull();
    expect(procurementMetrics('100', '1700', '0').discount).toBeNull();
    expect(procurementMetrics(null, '1700', '20').actualPrice).toBeNull();
    expect(amountFromDiscount('100', '20', '8.5')).toBe('1700.00');
    expect(amountFromDiscount('0.01', '1', '5')).toBe('0.01');
    expect(amountFromDiscount('invalid', '20', '8.5')).toBeNull();
  });
  it('preserves unknown stock across procurement corrections and separates it from zero', () => {
    expect(correctedRemainingQuantity({ receivedQty: 100, remainingQty: null }, 120)).toBeNull();
    expect(correctedRemainingQuantity({ receivedQty: 100, remainingQty: 0 }, 120)).toBe(20);
    expect(materialStockSummary([{ remainingQty: null }, { remainingQty: 0 }])).toEqual({
      knownStock: 0,
      unknownStockBatchCount: 1,
    });
  });
  it('only hides explicitly marked pure pricing batches, preserving mixed and legacy batches', () => {
    const pure = {
      purpose: 'PRICING',
      _count: { entries: 3, productEntries: 0 },
      ordinaryEntryCount: 0,
    };
    expect(isPricingOnlyBatch(pure)).toBe(true);
    for (const batch of [
      { ...pure, purpose: 'GENERAL' },
      { ...pure, ordinaryEntryCount: 1 },
      { ...pure, _count: { entries: 3, productEntries: 1 } },
      { ...pure, _count: { entries: 0, productEntries: 0 } },
      { ...pure, ordinaryEntryCount: undefined },
    ])
      expect(isPricingOnlyBatch(batch)).toBe(false);
  });
  it('keeps selected pricing batches visible while hiding only pure pricing purchases by default', () => {
    const ordinary = { id: 'ordinary', purpose: 'GENERAL' };
    const pricing = {
      id: 'pricing',
      purpose: 'PRICING',
      _count: { entries: 3, productEntries: 0 },
      ordinaryEntryCount: 0,
    };
    const otherPricing = { ...pricing, id: 'other' };
    const mixed = { ...pricing, id: 'mixed', ordinaryEntryCount: 1 };
    const batches = [ordinary, pricing, otherPricing, mixed];
    expect(selectablePurchaseBatches(batches, false)).toEqual([ordinary, mixed]);
    expect(selectablePurchaseBatches(batches, false, 'pricing')).toEqual([
      ordinary,
      pricing,
      mixed,
    ]);
    expect(selectablePurchaseBatches(batches, true)).toEqual(batches);
  });
  it('names pricing purchases from the first distinct group and distributor, keeping the original order', () => {
    const group = { id: 'g1', name: 'S925' };
    const supplier = { id: 'd1', name: '明发' };
    expect(pricingBatchNameBase('2026-11-23', [group, group], [supplier, supplier])).toBe(
      'S925-2026-11-23-明发',
    );
    expect(
      pricingBatchNameBase(
        '2026-11-23',
        [group, { id: 'g2', name: '清迈银' }],
        [supplier, { id: 'd2', name: '其他渠道' }],
      ),
    ).toBe('S925等-2026-11-23-明发等');
    // Distinct channels can share the same display name.
    expect(pricingBatchNameBase('2026-11-23', [group], [supplier, { ...supplier, id: 'd2' }])).toBe(
      'S925-2026-11-23-明发等',
    );
  });
  it('keeps same-day purchases independent and fits generated names within batch editor limits', () => {
    const base = pricingBatchNameBase(
      '2026-11-23',
      [{ id: 'g', name: '银'.repeat(120) }],
      [{ id: 'd', name: '商'.repeat(120) }],
    );
    const duplicate = availablePricingBatchName(base, [base, `${base}（2）`, `${base}（4）`]);
    expect(duplicate).toBe(`${base}（3）`);
    expect(duplicate.length).toBeLessThanOrEqual(120);
    expect(duplicate).toContain('-2026-11-23-');
  });
  it('rejects zero weights, duplicate materials and negative amounts while allowing zero payments', () => {
    const data = {
      receivedAt: '2026-11-15',
      distributorId,
      lines: [{ materialId, weight: '100', quote: '20', amount: '0' }],
    };
    expect(procurementSchema.safeParse(data).success).toBe(true);
    expect(
      procurementSchema.safeParse({ ...data, lines: [data.lines[0], data.lines[0]] }).success,
    ).toBe(false);
    expect(
      procurementSchema.safeParse({ ...data, lines: [{ ...data.lines[0], weight: '0' }] }).success,
    ).toBe(false);
    expect(
      procurementSchema.safeParse({ ...data, lines: [{ ...data.lines[0], amount: '-1' }] }).success,
    ).toBe(false);
  });
});
describe('silver workbook preview', () => {
  it('requires review when a source formula has an error even if another price can produce an amount', () => {
    const parsed = workbook();
    parsed.sheets[0].rows[0].cells.P = '#VALUE!';
    const row = ready(normalizeSilverWorkbook(parsed, '总账', 3)[0]);
    expect(row.lines[0].amount).toBe('1700.00');
    expect(silverRowIssues(row)).toContainEqual({ code: 'SOURCE_VALUE_INVALID', kind: 'S925' });
    row.lines[0].amountConfirmed = true;
    expect(silverRowIssues(row)).toEqual([]);
  });
  it('splits three kinds per source row, preserves formulas and uses per-silver payments rather than order totals', () => {
    const parsed = workbook();
    expect(parsed.sheets[0].rows[0].cellMetadata?.D.formula).toBe('C4*0.85');
    const rows = normalizeSilverWorkbook(parsed, '总账', 3);
    expect(rows[0].date1904).toBe(false);
    expect(normalizeSilverWorkbook(workbook(true), '总账', 3)[0].date1904).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0].receivedAt).toBe('2026-11-15');
    expect(rows[0].lines.map((line) => line.amount)).toEqual(['1700.00', '200.00', '120.00']);
    expect(rows[0].original.L.value).toBe('99999');
    expect(silverRowIssues(ready(rows[0]))).toEqual([]);
    expect(silverProcurement(ready(rows[0])).data?.initialStock).toBe('UNKNOWN');
  });
  it('blocks missing dates and formula mismatches until explicitly reviewed or corrected', () => {
    const row = ready(normalizeSilverWorkbook(workbook(), '总账', 3)[1]);
    expect(row.lines[0].amount).toBe('51.00');
    expect(silverRowIssues(row)).toEqual(
      expect.arrayContaining([
        { code: 'DATE_REQUIRED' },
        { code: 'AMOUNT_CONFLICT', kind: 'S925' },
      ]),
    );
    row.receivedAt = '2026-11-15';
    row.lines[0].amountConfirmed = true;
    expect(silverRowIssues(row)).toEqual([]);
  });
  it.each([
    ['1', false, '1900-01-01'],
    ['60', false, ''],
    ['61', false, '1900-03-01'],
    ['0', true, '1904-01-01'],
    ['2026/11/5', false, '2026-11-05'],
    ['', false, ''],
  ])('parses Excel dates without inventing missing dates (%s)', (value, system, expected) => {
    expect(excelProcurementDate(value as string, system as boolean)).toBe(expected);
  });
  it('does not merge same-day source rows', () => {
    const parsed = workbook();
    parsed.sheets[0].rows[1] = { ...parsed.sheets[0].rows[0], rowNumber: 5 };
    expect(normalizeSilverWorkbook(parsed, '总账', 3).map((row) => row.rowNumber)).toEqual([4, 5]);
  });
});
