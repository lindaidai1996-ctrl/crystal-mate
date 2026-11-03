import { describe, expect, it } from 'vitest';
import { materialInputFromImport } from '@/lib/materialImageImport/materialInput';
import {
  newImportItem,
  importItemDataSchema,
  type ImportItemData,
  type ImportSettings,
} from '@/lib/materialImageImport/contracts';
import { calculatePurchase } from '@/lib/material-purchase';
import { importMaterialDraft, patchImportItem } from '@/lib/materialImageImport/materialDraft';

const settings: ImportSettings = {
  distributorId: 'clx1234567890123456789012',
  selection: { batchId: 'clx1234567890123456789013' },
  priceKind: 'PURCHASE',
};
const item = (patch: Partial<ImportItemData> = {}): ImportItemData => ({
  ...newImportItem('PURCHASE'),
  name: '银饰',
  categoryId: 'clx1234567890123456789014',
  reviewed: true,
  quantity: 3,
  price: '4.50',
  ...patch,
});

describe('image draft to material purchase', () => {
  it('restores legacy drafts and carries reviewed aliases through draft reload and final validation', () => {
    const source = item();
    const material = importMaterialDraft(source);
    const { aliases: _aliases, ...legacyValues } = material.values;
    void _aliases;
    const legacy = importItemDataSchema.parse({
      ...source,
      material: { ...material, values: legacyValues },
    });
    expect(legacy.material?.values.aliases).toEqual([]);
    material.values.aliases = [' 蓝色千层 ', 'Blue Phantom', 'blue phantom', ''];
    const reloaded = importItemDataSchema.parse(
      JSON.parse(JSON.stringify({ ...source, material })),
    );
    expect(reloaded.material?.values.aliases).toEqual(['蓝色千层', 'Blue Phantom']);
    expect(materialInputFromImport(reloaded, settings, 'crop')?.values.aliases).toEqual([
      '蓝色千层',
      'Blue Phantom',
    ]);
    const renamed = patchImportItem(reloaded, { name: '新名称' });
    expect(renamed.material?.values.aliases).toEqual(['蓝色千层', 'Blue Phantom']);
  });

  it('rejects oversized aliases while accepting an empty optional alias list', () => {
    const source = item();
    const material = importMaterialDraft(source);
    for (const aliases of [['字'.repeat(121)], Array.from({ length: 21 }, (_, i) => `别名${i}`)]) {
      expect(
        importItemDataSchema.safeParse({
          ...source,
          material: { ...material, values: { ...material.values, aliases } },
        }).success,
      ).toBe(false);
    }
    expect(
      materialInputFromImport({ ...source, material }, settings, 'crop')?.values.aliases,
    ).toEqual([]);
  });

  it.each(['BEAD', 'STRAND', 'GRAM'] as const)(
    'defaults a new %s item to one and rounds its marked-up purchase price up',
    (unit) => {
      const source = item({ unit, quantity: newImportItem('PURCHASE').quantity });
      const material = importMaterialDraft(source);
      const calculated = calculatePurchase(material.values, material.purchase, source.quantity);
      expect(calculated.valid).toBe(true);
      expect(source.quantity).toBe(1);
      expect(calculated.values.saleRule).toBe('PERCENT_60');
      expect(
        unit === 'GRAM' ? calculated.values.saleGramPrice : calculated.values.saleUnitPrice,
      ).toBe('8.00');
      const input = materialInputFromImport(source, settings, 'crop')!;
      expect(input.receivedQty).toBe(1);
      expect(input.values.saleRule).toBe('PERCENT_60');
      expect(unit === 'GRAM' ? input.values.saleGramPrice : input.values.saleUnitPrice).toBe(
        '8.00',
      );
    },
  );

  it('keeps the default sale rule ready for a missing price without inventing a sale amount', () => {
    const material = importMaterialDraft(newImportItem('PURCHASE'));
    expect(material.values).toMatchObject({
      saleRule: 'PERCENT_60',
      purchaseUnitPrice: null,
      saleUnitPrice: null,
    });
  });

  it('restores the markup when a recognized price is reclassified as a purchase cost', () => {
    const source = item({ priceKind: 'SALE' });
    const material = importMaterialDraft(source);
    const next = patchImportItem({ ...source, material }, { priceKind: 'PURCHASE' });
    expect(next.material?.values).toMatchObject({
      purchaseUnitPrice: '4.50',
      saleRule: 'PERCENT_60',
      saleUnitPrice: '8.00',
      saleUnitManual: false,
    });
  });

  it('does not turn a sale price into a purchase cost', () => {
    expect(
      materialInputFromImport(item({ priceKind: 'SALE', purchasePrice: null }), settings, 'crop'),
    ).toBeNull();
    const input = materialInputFromImport(
      item({ priceKind: 'SALE', purchasePrice: '2.00' }),
      settings,
      'crop',
    )!;
    const calculated = calculatePurchase(input.values, input.purchase, input.receivedQty);
    expect(calculated.values.purchaseUnitPrice).toBe('2.00');
    expect(calculated.values.saleUnitPrice).toBe('4.50');
    expect(input.receivedQty).toBe(3);
  });

  it('requires explicit quantity, review, and selection, and rejects fractional piece counts', () => {
    for (const patch of [
      { quantity: null },
      { reviewed: false },
      { selected: false },
      { quantity: 1.5 },
      { price: '' },
      { name: '' },
    ])
      expect(materialInputFromImport(item(patch), settings, 'crop')).toBeNull();
  });

  it('uses the existing purchase calculation for two-decimal gram inventory and money', () => {
    const input = materialInputFromImport(
      item({ unit: 'GRAM', quantity: 12.35, price: '2.03', salePrice: '3.00' }),
      settings,
      'crop',
    )!;
    expect(input.purchase.totalAmount).toBe('25.07');
    expect(input.purchase.totalWeightGrams).toBe('12.35');
    const calculated = calculatePurchase(input.values, input.purchase, input.receivedQty);
    expect(calculated.valid).toBe(true);
    expect(calculated.values.purchaseGramPrice).toBe('2.03');
    expect(calculated.values.saleGramPrice).toBe('3.00');
    expect(
      materialInputFromImport(item({ unit: 'GRAM', quantity: 1.234 }), settings, 'crop'),
    ).toBeNull();
  });

  it('keeps the complete material form through draft serialization and submission', () => {
    const source = item();
    const material = importMaterialDraft(source);
    material.values = {
      ...material.values,
      saleRule: 'PERCENT_60',
      lengthMm: '12.50',
      widthMm: '8.00',
      heightMm: '3.00',
      weightGrams: '2.00',
      notes: '保留物料备注',
    };
    material.tagIds = ['clx1234567890123456789015'];
    material.images = [
      {
        objectKey: 'images/11111111-1111-4111-8111-111111111111.png',
        url: '/extra-image',
        position: 0,
      },
    ];
    const restored = importItemDataSchema.parse(
      JSON.parse(JSON.stringify({ ...source, material })),
    );
    const input = materialInputFromImport(restored, settings, 'recognized-crop')!;
    expect(input.values).toMatchObject({
      lengthMm: '12.50',
      widthMm: '8.00',
      heightMm: '3.00',
      notes: '保留物料备注',
      saleRule: 'PERCENT_60',
      saleUnitPrice: '8.00',
      purchaseUnitPrice: '4.50',
      imageKeys: ['recognized-crop', 'images/11111111-1111-4111-8111-111111111111.png'],
    });
    expect(input.tagIds).toEqual(material.tagIds);
  });

  it('submits edited form prices instead of overwriting them with the original quote', () => {
    const source = item({ priceKind: 'SALE', price: '30.00' });
    const material = importMaterialDraft(source);
    expect(materialInputFromImport({ ...source, material }, settings, 'crop')).toBeNull();
    material.values.purchaseUnitPrice = '12.00';
    material.values.saleUnitPrice = '35.00';
    const input = materialInputFromImport({ ...source, material }, settings, 'crop')!;
    expect(input.values.purchaseUnitPrice).toBe('12.00');
    expect(input.values.saleUnitPrice).toBe('35.00');
  });

  it('preserves batch purchase strategy and unknown quantity without inventing stock', () => {
    const source = item({ quantity: null });
    const material = importMaterialDraft(source);
    material.purchase = {
      ...material.purchase,
      mode: 'BATCH',
      totalAmount: '100.00',
      manualUnitPrice: '5.00',
    };
    material.quantityUnknown = true;
    const input = materialInputFromImport({ ...source, material }, settings, 'crop')!;
    expect(input.receivedQty).toBeNull();
    expect(input.purchase.manualUnitPrice).toBe('5.00');
    expect(input.values.purchaseUnitPrice).toBe('5.00');
  });

  it('uses edited gram purchase totals and sale rules as the final values', () => {
    const source = item({ unit: 'GRAM', price: '2.00', quantity: 3 });
    const material = importMaterialDraft(source);
    material.purchase = { ...material.purchase, totalWeightGrams: '12.35' };
    material.values.saleRule = 'FIXED_AMOUNT';
    material.values.saleRuleValue = '1.50';
    const input = materialInputFromImport({ ...source, material }, settings, 'crop')!;
    expect(input.receivedQty).toBe(12.35);
    expect(input.purchase.totalAmount).toBe('24.70');
    expect(input.values.saleGramPrice).toBe('3.50');
  });

  it('applies batch category and price-meaning changes to an already edited full form', () => {
    const source = item();
    const material = importMaterialDraft(source);
    material.values.notes = '不能丢失';
    const next = patchImportItem(
      { ...source, material },
      {
        categoryId: 'clx1234567890123456789016',
        priceKind: 'SALE',
        reviewed: false,
      },
    );
    expect(next.material?.values).toMatchObject({
      categoryId: 'clx1234567890123456789016',
      purchaseUnitPrice: null,
      saleUnitPrice: '4.50',
      saleRule: 'CUSTOM_AMOUNT',
      notes: '不能丢失',
    });
    expect(materialInputFromImport({ ...next, reviewed: true }, settings, 'crop')).toBeNull();
  });
});
