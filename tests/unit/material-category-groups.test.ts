import { describe, expect, it } from 'vitest';
import {
  materialCategoryGroupIds,
  materialGroupCategories,
} from '../../src/lib/material-category-groups';
import { categoryPath, categoryTree } from '../../src/components/materialManagement/categoryTree';

const categories = [
  { id: 'accessories', name: '配饰', parentId: null },
  { id: 'silver', name: 'S925银配饰', parentId: 'accessories' },
  { id: 'clasp', name: '扣头', parentId: 'silver' },
  { id: 'alloy', name: '合金配饰', parentId: 'accessories' },
  { id: 'gold', name: '镀K18金-银配饰', parentId: null },
  { id: 'jade', name: '和田玉', parentId: null },
  { id: 'white', name: '冰白', parentId: 'jade' },
  { id: 'jadeAccessory', name: '和田玉配饰', parentId: 'accessories' },
  { id: 'other', name: '其他银配饰', parentId: null },
].map((category) => ({ ...category, aliases: [] }));

describe('material category groups', () => {
  it('matches exact names and includes descendants for each group', () => {
    expect([...materialCategoryGroupIds(categories, 'silver')].sort()).toEqual(
      ['silver', 'clasp', 'alloy', 'gold'].sort(),
    );
    expect([...materialCategoryGroupIds(categories, 'hetian')].sort()).toEqual(
      ['jade', 'white', 'jadeAccessory'].sort(),
    );
  });

  it('keeps allowed nested categories selectable without exposing their outside parents', () => {
    const scoped = materialGroupCategories(categories, 'silver');
    expect(categoryTree(scoped)).toEqual([
      { value: 'silver', label: 'S925银配饰', children: [{ value: 'clasp', label: '扣头' }] },
      { value: 'alloy', label: '合金配饰' },
      { value: 'gold', label: '镀K18金-银配饰' },
    ]);
    expect(categoryPath('clasp', scoped)).toEqual(['silver', 'clasp']);
    expect(categories[1].parentId).toBe('accessories');
    expect(materialGroupCategories(categories)).toBe(categories);
  });

  it('supports partially missing groups and leaves entirely missing groups empty', () => {
    expect([...materialCategoryGroupIds(categories.slice(0, 3), 'silver')]).toEqual([
      'silver',
      'clasp',
    ]);
    expect(materialGroupCategories(categories.slice(0, 3), 'hetian')).toEqual([]);
  });
});
