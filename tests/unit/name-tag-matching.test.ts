import { describe, expect, it } from 'vitest';
import {
  expandColorTypeTags,
  replaceAutomaticTags,
  nameTagRequestSchema,
} from '@/lib/name-tag-matching';

const tags = ['云母', '粉云母', '幽灵', '绿幽灵', '胶花', '粉胶花', '粉幽灵', '粉红', '粉色'].map(
  (name) => ({ id: name, name }),
);
describe('color type tags', () => {
  it.each([
    [['粉云母'], ['粉云母', '云母']],
    [
      ['粉云母', '绿幽灵'],
      ['粉云母', '绿幽灵', '云母', '幽灵'],
    ],
    [
      ['粉胶花', '胶花', '粉胶花'],
      ['粉胶花', '胶花'],
    ],
    [
      ['粉红', '粉色'],
      ['粉红', '粉色'],
    ],
  ])('expands identified compound tags without spreading colors: %j', (selected, expected) => {
    expect(expandColorTypeTags({ tagIds: selected, missingTags: [] }, tags)).toEqual({
      tagIds: expected,
      missingTags: [],
    });
  });
  it('reports missing base tags, removes resolved missing tags, and never invents IDs', () => {
    expect(
      expandColorTypeTags({ tagIds: ['粉云母'], missingTags: ['粉云母', '兔毛'] }, [tags[1]]),
    ).toEqual({
      tagIds: ['粉云母'],
      missingTags: ['兔毛', '云母'],
    });
  });
  it('retains manual and previously saved selections while replacing only tags added by this session', () => {
    const first = replaceAutomaticTags(['云母', '手动标签'], [], ['云母', '粉云母']);
    expect(first).toEqual({ tagIds: ['云母', '手动标签', '粉云母'], automaticTagIds: ['粉云母'] });
    expect(
      replaceAutomaticTags([...first.tagIds, '新增手动'], first.automaticTagIds, ['胶花']),
    ).toEqual({
      tagIds: ['云母', '手动标签', '新增手动', '胶花'],
      automaticTagIds: ['胶花'],
    });
  });
  it('bounds batches and rejects blank names', () => {
    expect(nameTagRequestSchema.parse({ names: [' 粉云母 '] }).names).toEqual(['粉云母']);
    for (const names of [[], [' '], Array(21).fill('粉云母')])
      expect(nameTagRequestSchema.safeParse({ names }).success).toBe(false);
  });
});
