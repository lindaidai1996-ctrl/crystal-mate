import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMaterial } from '@/lib/material-defaults';
import { calculatePurchase, emptyPurchase } from '@/lib/material-purchase';
import { newImportItem, recognizeImportItemSchema } from '@/lib/materialImageImport/contracts';
import { importMaterialDraft, importQuantity } from '@/lib/materialImageImport/materialDraft';
import { applyRecognitionPreview } from '@/lib/materialImageImport/recognitionPatch';

const mocks = vi.hoisted(() => ({ read: vi.fn(), source: vi.fn(), recognize: vi.fn() }));
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/lib/db', () => ({ db: { materialImageImport: { findUnique: mocks.read } } }));
vi.mock('@/lib/materialImageImport/sourceImage', () => ({ readImportSource: mocks.source }));
vi.mock('@/lib/ai/imageRecognition', () => ({ recognizeImage: mocks.recognize }));
import { recognizeImageImportItem } from '@/lib/materialImageImport/itemRecognition';

const objectBox = { x: 100, y: 100, width: 200, height: 200 };
const priceBox = { x: 100, y: 350, width: 100, height: 50 };
const itemId = '641d34e5-8a91-4d8d-8d38-fb4543259f75';
const input = { version: 3, provider: 'deepseek', itemId, objectBox, priceBox };
const candidate = {
  ...newImportItem('PURCHASE', objectBox),
  priceBox,
  price: '25.00',
  priceText: '￥25',
  warnings: ['请核对'],
};
const row = () => ({
  id: itemId,
  entryId: null,
  data: { ...newImportItem('PURCHASE'), name: '手工配置' },
});
const job = () => ({
  version: 3,
  status: 'READY',
  leaseUntil: null,
  sourceKey: 'import-sources/source.png',
  items: [row()],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(job());
  mocks.source.mockResolvedValue({ bytes: Buffer.from('source'), mimeType: 'image/png' });
  mocks.recognize.mockResolvedValue({ items: [candidate], warnings: ['额外提示'] });
});

describe('single-item recognition preview', () => {
  it('uses the stored image and current price meaning, returning a preview without database writes', async () => {
    const current = job();
    current.items[0].data.priceKind = 'SALE';
    mocks.read.mockResolvedValue(current);
    expect(await recognizeImageImportItem('import-id', input)).toMatchObject({
      version: 3,
      itemId,
      data: { priceText: '￥25', warnings: ['请核对', '额外提示'] },
    });
    expect(mocks.recognize).toHaveBeenCalledWith(
      'deepseek',
      expect.objectContaining({ mimeType: 'image/png' }),
      'SALE',
      { objectBox, priceBox },
    );
    expect(current.items[0].data.name).toBe('手工配置');
  });

  it.each([
    ['archived import', () => ({ ...job(), archivedAt: new Date() }), 'IMPORT_CONFLICT'],
    ['stale draft', () => ({ ...job(), version: 4 }), 'IMPORT_CONFLICT'],
    [
      'running recognition',
      () => ({ ...job(), status: 'PROCESSING', leaseUntil: new Date(Date.now() + 60000) }),
      'IMPORT_CONFLICT',
    ],
    [
      'imported item',
      () => ({ ...job(), items: [{ ...row(), entryId: 'entry-id' }] }),
      'IMPORT_ALREADY_COMMITTED',
    ],
    ['different import item', () => ({ ...job(), items: [] }), 'NOT_FOUND'],
  ])('rejects %s before model access', async (_name, state, error) => {
    mocks.read.mockResolvedValue(state());
    await expect(recognizeImageImportItem('import-id', input)).rejects.toThrow(error);
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it('rejects a preview if another window changes the draft during recognition', async () => {
    mocks.read.mockResolvedValueOnce(job()).mockResolvedValueOnce({ ...job(), version: 4 });
    await expect(recognizeImageImportItem('import-id', input)).rejects.toThrow('IMPORT_CONFLICT');
  });

  it('requires one result and validates selected regions', async () => {
    mocks.recognize.mockResolvedValue({ items: [candidate, candidate], warnings: [] });
    await expect(recognizeImageImportItem('import-id', input)).rejects.toThrow(
      'IMPORT_SINGLE_RESULT_REQUIRED',
    );
    expect(
      recognizeImportItemSchema.safeParse({ ...input, objectBox: { ...objectBox, x: 900 } })
        .success,
    ).toBe(false);
  });
});

describe('adopting recognition without losing manual configuration', () => {
  function configured() {
    return {
      ...newImportItem('PURCHASE'),
      name: '手动命名',
      categoryId: 'category',
      quantity: 10,
      existingMaterialId: 'existing-material',
      reviewed: true,
      material: {
        values: {
          ...emptyMaterial(),
          unit: 'BEAD' as const,
          name: '手动命名',
          categoryId: 'category',
          purchaseUnitPrice: '12.00',
          saleUnitPrice: '40.00',
          saleUnitManual: true,
          saleRule: 'PERCENT_60' as const,
          notes: '手工备注',
        },
        purchase: emptyPurchase(),
        tagIds: ['tag-id'],
        images: [{ objectKey: 'images/extra.jpg', url: '/extra.jpg', position: 0 }],
        quantityUnknown: false,
      },
    };
  }

  it('adopts only evidence and ranges while keeping all material settings and identity', () => {
    const original = configured();
    const next = applyRecognitionPreview(original, candidate, ['ranges', 'evidence']);
    expect(next).toMatchObject({
      objectBox,
      priceBox,
      priceText: '￥25',
      price: '25.00',
      reviewed: false,
      existingMaterialId: original.existingMaterialId,
      quantity: 10,
    });
    expect(next.material).toEqual(original.material);
    expect(original.reviewed).toBe(true);
    expect(original.material.values.purchaseUnitPrice).toBe('12.00');
  });

  it('materializes legacy drafts so changing evidence does not implicitly replace purchase prices', () => {
    const original = {
      ...newImportItem('PURCHASE'),
      price: '12.00',
      priceText: '12',
      name: '旧草稿',
    };
    const next = applyRecognitionPreview(original, candidate, ['evidence']);
    expect(importMaterialDraft(next).values.purchaseUnitPrice).toBe('12.00');
    expect(next.price).toBe('25.00');
  });

  it('changes a price only when explicitly selected, preserving manual sale price, rules and quantities', () => {
    const original = configured();
    const next = applyRecognitionPreview(original, candidate, ['price']);
    expect(next.material?.values).toMatchObject({
      purchaseUnitPrice: '25.00',
      saleUnitPrice: '40.00',
      saleRule: 'PERCENT_60',
      notes: '手工备注',
    });
    expect(next.quantity).toBe(10);
    expect(next.priceText).toBe(original.priceText);
    expect(next.objectBox).toEqual(original.objectBox);
    expect(next.material?.tagIds).toEqual(original.material.tagIds);
    expect(next.material?.images).toEqual(original.material.images);
  });

  it('uses the batch manual unit price without changing purchased amount or quantity', () => {
    const original = configured();
    original.material.purchase = { ...emptyPurchase(), mode: 'BATCH', totalAmount: '100.00' };
    const next = applyRecognitionPreview(original, candidate, ['price']);
    const material = importMaterialDraft(next);
    expect(
      calculatePurchase(material.values, material.purchase, importQuantity(next)).values
        .purchaseUnitPrice,
    ).toBe('25.00');
    expect(material.purchase.totalAmount).toBe('100.00');
    expect(next.quantity).toBe(10);
  });

  it('uses shared gram quote calculations while keeping the purchased weight', () => {
    const original = {
      ...newImportItem('PURCHASE'),
      unit: 'GRAM' as const,
      price: '12.00',
      quantity: 4,
    };
    const next = applyRecognitionPreview(original, candidate, ['price']);
    const material = importMaterialDraft(next);
    const result = calculatePurchase(material.values, material.purchase, importQuantity(next));
    expect(result.purchase.totalWeightGrams).toBe('4.00');
    expect(result.purchase.totalAmount).toBe('100.00');
    expect(result.values.purchaseGramPrice).toBe('25.00');
  });

  it('adopts sale prices without changing purchase settings and ignores unreadable prices', () => {
    const original = { ...configured(), priceKind: 'SALE' as const };
    const next = applyRecognitionPreview(original, candidate, ['price']);
    expect(next.material?.values).toMatchObject({
      saleUnitPrice: '25.00',
      purchaseUnitPrice: '12.00',
      saleRule: 'PERCENT_60',
    });
    expect(next.material?.purchase).toEqual(original.material.purchase);
    expect(
      applyRecognitionPreview(original, { ...candidate, price: null }, ['price']).material,
    ).toEqual(original.material);
  });

  it('does not recalculate gram quantity from a corrected quote when weight was previously derived', () => {
    const original = { ...newImportItem('PURCHASE'), unit: 'GRAM' as const, quantity: 4 };
    const material = importMaterialDraft(original);
    material.purchase = {
      ...emptyPurchase(),
      mode: 'BATCH',
      quotedGramPrice: '12.00',
      totalAmount: '48.00',
      autoField: 'totalWeightGrams',
    };
    const next = applyRecognitionPreview({ ...original, material }, candidate, ['price']);
    expect(importQuantity(next)).toBe(4);
    expect(next.material?.purchase).toMatchObject({
      quotedGramPrice: '25.00',
      totalWeightGrams: '4.00',
      totalAmount: '48.00',
    });
  });
});
