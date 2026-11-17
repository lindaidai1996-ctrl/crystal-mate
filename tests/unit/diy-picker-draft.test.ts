import { describe, expect, it } from 'vitest';
import { applyPickerSelection, preferredMaterialUsageUnit } from '@/lib/diy-picker/draft';
import type { Material, Product, ProductSourceInput } from '@/lib/client-types';
import type { PickerSelection } from '@/lib/diy-picker/contracts';
const material = { id: 'mat', unit: 'GRAM', saleRule: 'COST' } as Material;
const entry = {
  id: 'batch',
  purchaseGramPrice: '12',
  purchaseUnitPrice: '9',
  childUnitPrice: '3',
  saleGramPrice: '20',
} as Material['batchEntries'][number];
const product = { id: 'egg', priceCents: 5000, cost: { totalCost: '20' } } as Product;
const draft: Extract<ProductSourceInput, { origin: 'DIY' }> = {
  origin: 'DIY',
  quantity: 1,
  notes: 'keep',
  materials: [],
  cabochons: [],
  extraCosts: [],
};
describe('DIY picker draft updates', () => {
  it.each([
    { preferred: 'BEAD', bead: null, gram: '105', expected: 'GRAM' },
    { preferred: 'GRAM', bead: '3', gram: null, expected: 'BEAD' },
    { preferred: 'BEAD', bead: '3', gram: '105', expected: 'BEAD' },
    { preferred: 'GRAM', bead: '3', gram: '105', expected: 'GRAM' },
    { preferred: 'BEAD', bead: '0', gram: '105', expected: 'BEAD' },
    { preferred: 'GRAM', bead: '3', gram: '0', expected: 'GRAM' },
    { preferred: 'BEAD', bead: null, gram: null, expected: 'STRAND' },
  ] as const)('chooses a priced unit: $preferred → $expected ($bead / $gram)', (testCase) => {
    expect(
      preferredMaterialUsageUnit(
        {
          material: { ...material, unit: 'STRAND' },
          entry: { ...entry, childUnitPrice: testCase.bead, purchaseGramPrice: testCase.gram },
        },
        testCase.preferred,
      ),
    ).toBe(testCase.expected);
  });
  it('keeps the preferred unit for manual entry when no prices exist', () => {
    expect(
      preferredMaterialUsageUnit(
        {
          material: { ...material, unit: 'STRAND' },
          entry: {
            ...entry,
            childUnitPrice: null,
            purchaseGramPrice: null,
            purchaseUnitPrice: null,
          },
        },
        'GRAM',
      ),
    ).toBe('GRAM');
  });
  it('uses a bead material’s own unit price instead of a strand child price', () => {
    expect(
      preferredMaterialUsageUnit({
        material: { ...material, unit: 'BEAD' },
        entry: { ...entry, purchaseUnitPrice: null },
      }),
    ).toBe('GRAM');
  });
  it('adds a strand material in grams when it has no bead price and fills matching prices', () => {
    const result = applyPickerSelection(draft, [
      {
        kind: 'materials',
        material: { ...material, unit: 'STRAND' },
        entry: { ...entry, childUnitPrice: null },
      },
    ]);
    expect(result.materials[0]).toMatchObject({
      usageUnit: 'GRAM',
      quantity: '1',
      unitCost: '12',
      quoteUnitPrice: '20',
    });
  });
  it('switches from unpriced grams to beads on replacement and retains quantity', () => {
    const old = {
      ...draft,
      materials: [
        { materialBatchEntryId: 'old', usageUnit: 'GRAM' as const, quantity: '7', unitCost: '9' },
      ],
    };
    const result = applyPickerSelection(
      old,
      [
        {
          kind: 'materials',
          material: { ...material, unit: 'STRAND' },
          entry: { ...entry, purchaseGramPrice: null, saleChildUnitPrice: '6' },
        },
      ],
      0,
    );
    expect(result.materials[0]).toMatchObject({
      usageUnit: 'BEAD',
      quantity: '7',
      unitCost: '3',
      quoteUnitPrice: '6',
    });
  });
  it('appends in selection order and uses existing unit/price defaults', () => {
    const result = applyPickerSelection(draft, [
      { kind: 'materials', material, entry },
      { kind: 'cabochons', product },
    ]);
    expect(result.materials[0]).toMatchObject({
      usageUnit: 'GRAM',
      quantity: '1',
      unitCost: '12',
      materialBatchEntryId: 'batch',
    });
    expect(result.cabochons[0]).toMatchObject({
      productId: 'egg',
      quantity: 1,
      unitCost: '20',
      quoteUnitPrice: '50.00',
    });
    expect(draft.materials).toHaveLength(0);
    expect(result.notes).toBe('keep');
  });
  it('replaces only the target row and retains its quantity', () => {
    const old = {
      ...draft,
      materials: [
        {
          materialBatchEntryId: 'old',
          usageUnit: 'BEAD' as const,
          quantity: '7',
          unitCost: '4',
          quoteUnitPrice: '99',
        },
        {
          materialBatchEntryId: 'other',
          usageUnit: 'BEAD' as const,
          quantity: '3',
          unitCost: '6',
          quoteUnitPrice: '88',
        },
      ],
    };
    const result = applyPickerSelection(old, [{ kind: 'materials', material, entry }], 0);
    expect(result.materials[0]).toMatchObject({ quantity: '7', usageUnit: 'GRAM', unitCost: '12' });
    expect(result.materials[1]).toBe(old.materials[1]);
  });
  it('allows the same source in an additional line without merging existing quantities or manual prices', () => {
    const selection: PickerSelection = { kind: 'cabochons', product };
    const old = {
      ...draft,
      cabochons: [{ productId: 'egg', quantity: 2, unitCost: '3', quoteUnitPrice: '66' }],
    };
    const result = applyPickerSelection(old, [selection]);
    expect(result.cabochons).toHaveLength(2);
    expect(result.cabochons[0]).toBe(old.cabochons[0]);
  });
});
