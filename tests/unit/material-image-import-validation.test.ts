import { describe, expect, it } from 'vitest';
import { newImportItem, type ImageImport } from '@/lib/materialImageImport/contracts';
import { importMaterialDraft } from '@/lib/materialImageImport/materialDraft';
import { validateImageImport } from '@/lib/materialImageImport/importValidation';
import {
  materialInputFromImport,
  validateMaterialImport,
} from '@/lib/materialImageImport/materialInput';

function job(): ImageImport {
  return {
    id: 'import',
    fileName: 'silver.jpg',
    sourceUrl: '/source.jpg',
    width: 1000,
    height: 1000,
    provider: 'deepseek',
    model: 'test',
    status: 'READY',
    version: 1,
    warnings: [],
    errorCode: null,
    leaseUntil: null,
    settings: {
      distributorId: 'clx1234567890123456789012',
      selection: { batchId: 'clx1234567890123456789013' },
      priceKind: 'PURCHASE',
    },
    items: [1, 2, 3].map((number) => ({
      id: `item-${number}`,
      entryId: null,
      materialId: null,
      data: {
        ...newImportItem('PURCHASE'),
        name: `银饰 ${number}`,
        categoryId: 'clx1234567890123456789014',
        price: '15',
        reviewed: true,
      },
    })),
  };
}

const codes = (result: ReturnType<typeof validateImageImport>, index = 0) =>
  result.items[index]?.issues.map((issue) => issue.code) ?? [];

describe('image import validation feedback', () => {
  it('identifies all missing fields on the correct item instead of stopping at review status', () => {
    const draft = job();
    Object.assign(draft.items[1].data, {
      name: '',
      categoryId: '',
      price: null,
      quantity: null,
      reviewed: false,
    });
    const result = validateImageImport(draft);
    expect(result.settings).toEqual([]);
    expect(result.items[0]).toMatchObject({ id: 'item-2', number: 2, name: '' });
    expect(codes(result)).toEqual(
      expect.arrayContaining(['name', 'category', 'purchasePrice', 'quantity', 'reviewed']),
    );
    expect(materialInputFromImport(draft.items[1].data, draft.settings, 'crop')).toBeNull();
  });

  it('reports shared supplier and batch errors once without blaming each item', () => {
    const draft = job();
    draft.settings.distributorId = '';
    draft.settings.selection = null;
    expect(validateImageImport(draft)).toEqual({
      settings: [
        { scope: 'settings', code: 'supplier' },
        { scope: 'settings', code: 'batch' },
      ],
      items: [],
    });
  });

  it('identifies the missing new batch name and invalid date', () => {
    const draft = job();
    draft.settings.selection = { newBatch: { name: '', receivedAt: '2026-02-30', notes: '' } };
    expect(validateImageImport(draft).settings.map((issue) => issue.code)).toEqual([
      'batchName',
      'batchDate',
    ]);
  });

  it('ignores excluded and imported rows while preserving original item numbers', () => {
    const draft = job();
    draft.items.forEach((item) => {
      item.data.reviewed = false;
    });
    draft.items[0].data.selected = false;
    draft.items[1].entryId = 'entry';
    const result = validateImageImport(draft);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'item-3', number: 3 });
  });

  it('uses edited values and clears resolved issues without changing review status', () => {
    const draft = job();
    const item = draft.items[0].data;
    item.material = importMaterialDraft(item);
    item.material.values.categoryId = '';
    expect(codes(validateImageImport(draft))).toContain('category');
    item.material.values.categoryId = item.categoryId;
    item.material.values.purchaseUnitPrice = '9.50';
    expect(validateImageImport(draft)).toEqual({ settings: [], items: [] });
    expect(item.reviewed).toBe(true);
  });

  it('accepts zero cost but never treats a recognized sale price as purchase cost', () => {
    const draft = job();
    draft.items[0].data.price = '0';
    expect(validateImageImport(draft).items).toEqual([]);
    draft.items[1].data.priceKind = 'SALE';
    expect(codes(validateImageImport(draft))).toContain('purchasePrice');
  });

  it('rejects fractional piece quantities and accepts decimal gram quantities', () => {
    const draft = job();
    draft.items[0].data.quantity = 1.5;
    expect(codes(validateImageImport(draft))).toContain('quantity');
    draft.items[0].data.unit = 'GRAM';
    expect(validateImageImport(draft).items).toEqual([]);
    draft.items[0].data.material = importMaterialDraft(draft.items[0].data);
    draft.items[0].data.material.purchase.totalWeightGrams = null;
    expect(codes(validateImageImport(draft))).toContain('purchase');
  });

  it('keeps supported batch imports with unknown quantities valid', () => {
    const draft = job();
    const item = draft.items[0].data;
    item.material = importMaterialDraft(item);
    item.material.quantityUnknown = true;
    item.material.purchase = { ...item.material.purchase, mode: 'BATCH', totalAmount: '30' };
    expect(validateImageImport(draft).items).toEqual([]);
    expect(materialInputFromImport(item, draft.settings, 'crop')?.receivedQty).toBeNull();
  });

  it('reports invalid optional fields and shared settings even when draft parsing fails', () => {
    const draft = job();
    const item = draft.items[0].data;
    item.material = importMaterialDraft(item);
    item.material.values.lengthMm = '-1';
    draft.settings.selection = null;
    const result = validateImageImport(draft);
    expect(codes(result)).toContain('dimensions');
    expect(result.settings).toContainEqual({ scope: 'settings', code: 'batch' });
    expect(validateMaterialImport(item, draft.settings, 'crop').input).toBeNull();
  });
});
