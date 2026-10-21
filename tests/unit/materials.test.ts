import { describe, expect, it } from 'vitest';
import type { MaterialCategory, MaterialValues } from '../../src/lib/client-types';
import {
  adoptSaleUnitPriceFromBeads,
  editMaterial,
  purchaseCandidates,
  recalculateMaterial,
  recognizeMaterialCategory,
  saleUnitPriceFromBeads,
} from '../../src/lib/material-calculations';
import {
  categoryDescendants,
  categoryPath,
  categoryTree,
} from '../../src/components/materialManagement/categoryTree';
import {
  materialCategorySchema,
  materialBatchEntryUpdateSchema,
  materialCreateSchema,
  materialMasterSchema,
  materialSchema,
} from '../../src/lib/validation';

function values(): MaterialValues {
  return {
    name: '紫发晶串',
    categoryId: 'clx1234567890123456789012',
    unit: 'STRAND',
    purchaseUnitPrice: '100.00',
    weightGrams: '20.00',
    purchaseGramPrice: null,
    purchaseGramManual: false,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    childCount: 10,
    childWeightGrams: '2.00',
    childUnitPrice: null,
    childPriceSource: null,
    saleRule: 'COST',
    saleRuleValue: null,
    saleUnitPrice: null,
    saleGramPrice: null,
    saleChildUnitPrice: null,
    saleUnitManual: false,
    saleGramManual: false,
    saleChildManual: false,
    notes: '',
  };
}

const categories: MaterialCategory[] = [
  { id: 'root', name: '发晶', aliases: [], parentId: null },
  { id: 'purple', name: '紫发晶', aliases: ['紫发'], parentId: 'root' },
  { id: 'other', name: '紫水晶', aliases: ['紫发'], parentId: null },
];

describe('material pricing', () => {
  it('rounds count and weight estimates to two decimal places', () => {
    const input = { ...values(), childCount: 3, childWeightGrams: '1.50' };
    expect(purchaseCandidates(input)).toEqual({
      gram: '5.00',
      count: '33.33',
      weight: '7.50',
    });
    expect(purchaseCandidates({ ...input, purchaseUnitPrice: '1.00', childCount: 6 }).count).toBe(
      '0.17',
    );
  });

  it('tracks an adopted estimate, updates it with cost, and removes the marker for custom input', () => {
    const adopted = recalculateMaterial({
      ...values(),
      childUnitPrice: '10.00',
      childPriceSource: 'COUNT',
      saleRule: 'PERCENT_10',
    });
    expect(adopted.saleChildUnitPrice).toBe('11.00');
    const updated = editMaterial(adopted, 'purchaseUnitPrice', '120.00');
    expect(updated.childUnitPrice).toBe('12.00');
    expect(updated.saleChildUnitPrice).toBe('13.20');
    expect(editMaterial(updated, 'childUnitPrice', '14.00').childPriceSource).toBe('CUSTOM');
    expect(editMaterial(updated, 'childUnitPrice', '12').childPriceSource).toBe('COUNT');
  });

  it('applies a fixed amount as an equal markup ratio and respects manual sale values', () => {
    const input = recalculateMaterial({
      ...values(),
      childUnitPrice: '10.00',
      childPriceSource: 'COUNT',
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '20.00',
    });
    expect([input.saleUnitPrice, input.saleGramPrice, input.saleChildUnitPrice]).toEqual([
      '120.00',
      '6.00',
      '12.00',
    ]);
    const manual = editMaterial(input, 'saleGramPrice', '8.00');
    expect(editMaterial(manual, 'purchaseUnitPrice', '200.00').saleGramPrice).toBe('8.00');
    expect(recalculateMaterial(manual, true).saleGramPrice).toBe('6.00');
    const zero = recalculateMaterial({
      ...values(),
      purchaseUnitPrice: '0.00',
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '20.00',
    });
    expect(zero.saleUnitPrice).toBe('20.00');
    expect(zero.saleGramPrice).toBeNull();
  });

  it('clears child data when changing to beads', () => {
    const bead = editMaterial(
      recalculateMaterial({ ...values(), childPriceSource: 'WEIGHT' }),
      'unit',
      'BEAD',
    );
    expect(bead).toMatchObject({
      childCount: null,
      childWeightGrams: null,
      childUnitPrice: null,
      childPriceSource: null,
      saleChildUnitPrice: null,
    });
  });

  it('adopts the bead sale price as a custom strand price and preserves it on later edits', () => {
    const input = recalculateMaterial({
      ...values(),
      purchaseUnitPrice: '19.90',
      childCount: 65,
      childPriceSource: 'COUNT',
    });
    const entered = editMaterial(input, 'saleChildUnitPrice', '3.00');
    expect(entered.childUnitPrice).toBe('0.31');
    expect(saleUnitPriceFromBeads(entered)).toBe('195.00');
    const adopted = adoptSaleUnitPriceFromBeads(entered);
    expect(adopted).toMatchObject({
      saleRule: 'CUSTOM_AMOUNT',
      saleRuleValue: null,
      saleUnitPrice: '195.00',
      saleChildUnitPrice: '3.00',
      saleUnitManual: true,
      saleChildManual: true,
    });
    const changed = editMaterial(
      editMaterial(adopted, 'childCount', 60),
      'saleChildUnitPrice',
      '4.00',
    );
    expect(changed.saleUnitPrice).toBe('195.00');
    expect(saleUnitPriceFromBeads(changed)).toBe('240.00');
    expect(adoptSaleUnitPriceFromBeads(changed).saleUnitPrice).toBe('240.00');
  });

  it('retains custom sale prices through cost recalculation, including empty and zero prices', () => {
    const custom = recalculateMaterial(
      {
        ...values(),
        saleRule: 'CUSTOM_AMOUNT',
        saleUnitPrice: '195.00',
        saleGramPrice: '0.00',
        saleChildUnitPrice: null,
      },
      true,
    );
    expect(editMaterial(custom, 'purchaseUnitPrice', '200.00')).toMatchObject({
      saleUnitPrice: '195.00',
      saleGramPrice: '0.00',
      saleChildUnitPrice: null,
      saleUnitManual: true,
      saleGramManual: true,
      saleChildManual: false,
    });
    expect(editMaterial(custom, 'saleUnitPrice', null).saleUnitPrice).toBeNull();
  });

  it('resets manual prices when switching from custom pricing to a cost rule', () => {
    const custom = adoptSaleUnitPriceFromBeads({
      ...values(),
      childPriceSource: 'COUNT',
      saleChildUnitPrice: '3.00',
    });
    const automatic = editMaterial(custom, 'saleRule', 'PERCENT_20');
    expect(automatic).toMatchObject({
      saleUnitPrice: '120.00',
      saleGramPrice: '6.00',
      saleChildUnitPrice: '12.00',
      saleUnitManual: false,
      saleGramManual: false,
      saleChildManual: false,
    });
    const fixed = editMaterial({ ...custom, saleRuleValue: '20.00' }, 'saleRule', 'FIXED_AMOUNT');
    expect(fixed.saleUnitPrice).toBe('120.00');
  });

  it('handles exact cents and only suggests valid, supported strand amounts', () => {
    const input = { ...values(), saleChildUnitPrice: '0.29', childCount: 3 };
    expect(saleUnitPriceFromBeads(input)).toBe('0.87');
    expect(saleUnitPriceFromBeads({ ...input, saleChildUnitPrice: '0.00' })).toBe('0.00');
    for (const invalid of [
      { ...input, childCount: null },
      { ...input, childCount: 0 },
      { ...input, childCount: 1.5 },
      { ...input, saleChildUnitPrice: null },
      { ...input, unit: 'BEAD' as const },
      { ...input, saleChildUnitPrice: '9999999999.99', childCount: 2 },
    ]) {
      expect(saleUnitPriceFromBeads(invalid)).toBeNull();
      expect(adoptSaleUnitPriceFromBeads(invalid)).toBe(invalid);
    }
  });

  it('validates custom amounts without a markup parameter', () => {
    const input = { ...values(), imageKeys: [], saleRule: 'CUSTOM_AMOUNT' };
    expect(materialSchema.safeParse(input).success).toBe(true);
    expect(materialSchema.safeParse({ ...input, saleRuleValue: '10.00' }).success).toBe(false);
  });
});

describe('material categories', () => {
  it('matches the longest name and leaves ambiguous aliases unselected', () => {
    expect(recognizeMaterialCategory('天然紫发晶手串', categories)?.id).toBe('purple');
    expect(recognizeMaterialCategory('紫发手串', categories)).toBeNull();
    expect(recognizeMaterialCategory('无匹配', categories)).toBeNull();
  });

  it('uses a separately matched parent to identify a child category', () => {
    const jadeCategories: MaterialCategory[] = [
      { id: 'hetian', name: '和田玉', aliases: [], parentId: null },
      { id: 'hetian-ice', name: '冰白', aliases: [], parentId: 'hetian' },
      { id: 'jadeite', name: '翡翠', aliases: [], parentId: null },
      { id: 'jadeite-ice', name: '冰白', aliases: [], parentId: 'jadeite' },
    ];

    expect(recognizeMaterialCategory('4m和田玉冰白小米珠', jadeCategories)?.id).toBe('hetian-ice');
    expect(recognizeMaterialCategory('翡翠冰白小米珠', jadeCategories)?.id).toBe('jadeite-ice');
    expect(recognizeMaterialCategory('冰白小米珠', jadeCategories)).toBeNull();
    expect(recognizeMaterialCategory('冰白小米珠', jadeCategories.slice(0, 2))?.id).toBe(
      'hetian-ice',
    );
    expect(recognizeMaterialCategory('和田玉小米珠', jadeCategories)?.id).toBe('hetian');
  });

  it('does not infer parent context from text inside a child name', () => {
    const overlapping: MaterialCategory[] = [
      { id: 'crystal', name: '水晶', aliases: [], parentId: null },
      { id: 'first', name: '紫水晶', aliases: [], parentId: 'crystal' },
      { id: 'purple', name: '紫', aliases: [], parentId: null },
      { id: 'second', name: '紫水晶', aliases: [], parentId: 'purple' },
    ];

    expect(recognizeMaterialCategory('紫水晶', overlapping)).toBeNull();
  });

  it('builds paths and excludes a category subtree as a possible parent', () => {
    expect(categoryPath('purple', categories)).toEqual(['root', 'purple']);
    expect(categoryDescendants('root', categories)).toEqual(new Set(['root', 'purple']));
    expect(categoryTree(categories, categoryDescendants('root', categories))).toEqual([
      { value: 'other', label: '紫水晶' },
    ]);
  });

  it('validates child fields, rules, aliases, and uploaded image keys', () => {
    const valid = { ...values(), imageKeys: [] };
    expect(materialSchema.safeParse(valid).success).toBe(true);
    expect(materialSchema.safeParse({ ...valid, unit: 'BEAD' }).success).toBe(false);
    expect(materialSchema.safeParse({ ...valid, imageKeys: ['a', 'a'] }).success).toBe(false);
    expect(materialSchema.safeParse({ ...valid, purchaseUnitPrice: '1.234' }).success).toBe(false);
    expect(materialSchema.safeParse({ ...valid, saleRule: 'FIXED_AMOUNT' }).success).toBe(false);
    expect(
      materialCategorySchema.safeParse({ name: 'A', parentId: null, aliases: ['Same', 'same'] })
        .success,
    ).toBe(false);
  });

  it('accepts distinct material tags and rejects duplicate or invalid tag IDs', () => {
    const tagId = 'clx1234567890123456789012';
    const master = {
      name: '紫发晶串',
      categoryId: values().categoryId,
      unit: 'STRAND',
      notes: '',
      tagIds: [tagId],
    };
    const create = {
      values: { ...values(), imageKeys: [] },
      tagIds: [tagId],
      selection: { batchId: tagId },
      distributorId: tagId,
      receivedQty: 1,
    };
    expect(materialMasterSchema.safeParse(master).success).toBe(true);
    expect(materialCreateSchema.safeParse(create).success).toBe(true);
    expect(materialMasterSchema.safeParse({ ...master, tagIds: undefined }).success).toBe(true);
    expect(materialCreateSchema.parse({ ...create, tagIds: undefined }).tagIds).toEqual([]);
    expect(materialMasterSchema.safeParse({ ...master, tagIds: [tagId, tagId] }).success).toBe(
      false,
    );
    expect(materialCreateSchema.safeParse({ ...create, tagIds: ['invalid'] }).success).toBe(false);
  });

  it('accepts material identity and tags when updating a batch entry', () => {
    const tagId = 'clx1234567890123456789012';
    const update = {
      values: {
        ...values(),
        name: '紫发晶',
        unit: 'BEAD',
        childCount: null,
        childWeightGrams: null,
        imageKeys: [],
      },
      tagIds: [tagId],
      distributorId: tagId,
      receivedQty: 2,
    };
    expect(materialBatchEntryUpdateSchema.safeParse(update).success).toBe(true);
    expect(
      materialBatchEntryUpdateSchema.safeParse({ ...update, tagIds: [tagId, tagId] }).success,
    ).toBe(false);
  });
});
