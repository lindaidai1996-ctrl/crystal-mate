import { describe, expect, it } from 'vitest';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import {
  dictionaryQuerySchema,
  locationQuerySchema,
} from '../../src/lib/ai-assistant/reference-contracts';
import {
  resolveLocationRows,
  resolvedLocationDistributorIds,
  searchDictionaryRows,
  type DictionaryRow,
  type LocationRow,
} from '../../src/lib/ai-assistant/reference-resolution';

const id = (number: number) => `c${number.toString().padStart(24, '0')}`;
// The frozen snapshot intentionally has no raw addresses/names. These strings
// are synthetic adapters of its boolean evidence, NOT recovered business data.
const locationRows: LocationRow[] = baseline.locationEvidence.map((row) => ({
  id: row.id,
  name: '脱敏构造渠道商',
  area: row.area,
  address: row.addressEmpty
    ? ''
    : row.addressMentionsLiwanPlaza
      ? '荔湾广场（构造测试地址）'
      : '其他市场（构造测试地址）',
  notes: '',
}));
const place = { text: '荔湾广场', kind: 'exact_place' };
const dictionaryRows: DictionaryRow[] = [
  ...baseline.categories.map((row) => ({ ...row, type: 'MATERIAL_CATEGORY' as const })),
  ...baseline.tags.map((row) => ({ ...row, type: 'TAG' as const, aliases: [], parentId: null })),
];

describe('assistant location resolution', () => {
  it('retains all seven address-confirmed IDs and separates the other two area-only IDs', () => {
    const result = resolveLocationRows(place, locationRows);
    expect(result.status).toBe('resolved');
    expect(resolvedLocationDistributorIds(result).sort()).toEqual(
      [...baseline.scope.distributorIds].sort(),
    );
    expect(result.uncertain.map((row) => row.distributor.id).sort()).toEqual(
      baseline.locationEvidence
        .filter((row) => !row.addressMentionsLiwanPlaza)
        .map((row) => row.id)
        .sort(),
    );
    expect(result.uncertain.every((row) => row.reason === 'area_only')).toBe(true);
  });

  it('distinguishes an exact area from an ambiguous exact-place request for the area name', () => {
    const area = resolveLocationRows({ text: '荔湾', kind: 'area' }, locationRows);
    expect(area.confirmed).toHaveLength(9);
    expect(area.uncertain).toHaveLength(0);
    const ambiguous = resolveLocationRows({ text: '荔湾', kind: 'exact_place' }, locationRows);
    expect(ambiguous.status).toBe('needs_clarification');
    expect(ambiguous.confirmed).toHaveLength(0);
    expect(ambiguous.uncertain).toHaveLength(9);
    expect(() => resolvedLocationDistributorIds(ambiguous)).toThrow('LOCATION_NEEDS_CLARIFICATION');
  });

  it.each([
    { name: '荔湾广场珠宝店', address: '', notes: '', confirmed: true },
    { name: '店铺', address: '', notes: '在荔湾广场经营', confirmed: false },
    { name: '店铺', address: '荔湾广场附近', notes: '', confirmed: false },
    { name: '店铺', address: '不在荔湾广场', notes: '', confirmed: false },
    { name: '店铺', address: '非荔湾广场', notes: '', confirmed: false },
    { name: '店铺', address: '原荔湾广场2楼', notes: '', confirmed: false },
    { name: '店铺', address: '位于荔湾广场之外', notes: '', confirmed: false },
    { name: '店铺', address: '荔湾广场2楼', notes: '已搬离荔湾广场', confirmed: false },
    { name: '店铺', address: '', notes: '上次去荔湾广场采购', confirmed: false },
  ])('treats explicit versus qualified/notes-only mentions separately: %j', (row) => {
    const result = resolveLocationRows(place, [{ ...row, id: id(1), area: '广州' }]);
    expect(result.confirmed).toHaveLength(row.confirmed ? 1 : 0);
    expect(result.uncertain).toHaveLength(row.confirmed ? 0 : 1);
  });

  it('returns only matching excerpts, without full address, notes or contacts', () => {
    const row = {
      id: id(1),
      name: '店铺',
      area: '广州',
      address: '秘密门牌123荔湾广场9楼',
      notes: '私人说明',
      phone: 'secret-contact',
    };
    const result = resolveLocationRows(place, [row]);
    expect(result.confirmed[0].evidence).toEqual([
      { field: 'address', matchedText: '荔湾广场', start: 7, end: 11 },
    ]);
    const output = JSON.stringify(result);
    for (const secret of ['秘密门牌', '9楼', '私人说明', 'secret-contact'])
      expect(output).not.toContain(secret);
    for (const evidence of result.confirmed[0].evidence)
      expect(row[evidence.field].slice(evidence.start, evidence.end)).toBe(evidence.matchedText);
  });

  it('handles literal regex characters and case-insensitive names', () => {
    const rows = [{ id: id(1), name: 'Market [A]+', address: '', notes: '', area: '' }];
    expect(resolveLocationRows({ text: '[a]+', kind: 'exact_place' }, rows).confirmed).toHaveLength(
      1,
    );
    expect(resolveLocationRows({ text: '.*', kind: 'exact_place' }, rows).confirmed).toHaveLength(
      0,
    );
  });

  it('distinguishes complete empty scope from an incomplete scan, including zero hits', () => {
    const empty = resolveLocationRows({ text: '不存在的地点', kind: 'exact_place' }, locationRows);
    expect(empty.status).toBe('resolved');
    expect(resolvedLocationDistributorIds(empty)).toEqual([]);
    for (const rows of [[], locationRows]) {
      const partial = resolveLocationRows(place, rows, false);
      expect(partial.status).toBe('incomplete');
      expect(() => resolvedLocationDistributorIds(partial)).toThrow('LOCATION_INCOMPLETE');
    }
  });

  it.each([
    { text: '', kind: 'exact_place' },
    { text: '荔湾', kind: 'market' },
    { ...place, accountId: id(1) },
  ])('rejects invalid location requests: %j', (input) =>
    expect(locationQuerySchema.safeParse(input).success).toBe(false),
  );
});

describe('assistant dictionaries', () => {
  it('finds actual category aliases and preserves source evidence', () => {
    const result = searchDictionaryRows(
      { text: '镀18K金', kinds: ['MATERIAL_CATEGORY', 'TAG'] },
      dictionaryRows,
    );
    const expected = baseline.categories.find((row) => row.aliases.includes('镀18K金'))!;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      entity: { type: 'MATERIAL_CATEGORY', id: expected.id },
      match: 'exact',
      aliases: expected.aliases,
      evidence: [
        {
          entity: { type: 'MATERIAL_CATEGORY', id: expected.id },
          field: 'aliases',
          value: expected.aliases,
        },
      ],
    });
  });

  it('returns category parents, ancestors and complete descendants without flattening identities', () => {
    const root: DictionaryRow = {
      type: 'MATERIAL_CATEGORY',
      id: id(1),
      name: '根',
      aliases: ['Root'],
      parentId: null,
    };
    const child = { ...root, id: id(2), name: '子', aliases: [], parentId: root.id };
    const grandchild = { ...child, id: id(3), name: '孙', parentId: child.id };
    const tag = { ...root, type: 'TAG' as const, id: id(4), aliases: [] };
    const rows = [grandchild, child, root, tag];
    const result = searchDictionaryRows({ text: 'root', kinds: ['MATERIAL_CATEGORY'] }, rows);
    expect(result.items[0].descendants.map((row) => row.entity.id)).toEqual([
      child.id,
      grandchild.id,
    ]);
    const leaf = searchDictionaryRows({ text: '孙', kinds: ['MATERIAL_CATEGORY'] }, rows).items[0];
    expect(leaf.parentId).toBe(child.id);
    expect(leaf.ancestors.map((row) => row.entity.id)).toEqual([root.id, child.id]);
    expect(
      searchDictionaryRows({ text: '根', kinds: ['MATERIAL_CATEGORY', 'TAG'] }, rows).totalMatches,
    ).toBe(2);
  });

  it('paginates all dictionary hits with stable type/id order and full counts', () => {
    const query = { text: '', kinds: ['TAG', 'MATERIAL_CATEGORY'], limit: 5 };
    const whole = searchDictionaryRows({ ...query, limit: 100 }, dictionaryRows);
    const all: string[] = [];
    for (let offset = 0; offset < whole.totalMatches!; offset += 5) {
      const page = searchDictionaryRows({ ...query, offset }, [...dictionaryRows].reverse());
      expect(page.totalMatches).toBe(whole.totalMatches);
      expect(page.hasMore).toBe(offset + page.items.length < whole.totalMatches!);
      all.push(...page.items.map((row) => `${row.entity.type}:${row.entity.id}`));
    }
    expect(new Set(all).size).toBe(baseline.categories.length + baseline.tags.length);
    expect(searchDictionaryRows({ ...query, offset: 1000 }, dictionaryRows).items).toEqual([]);
  });

  it('does not convert literal substring hits into synonyms or infer missing aliases', () => {
    const result = searchDictionaryRows(
      { text: '松石', kinds: ['MATERIAL_CATEGORY'] },
      dictionaryRows,
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.every((row) => row.match === 'contains' || row.aliases.includes('松石')),
    ).toBe(true);
    expect(
      searchDictionaryRows({ text: 'not-a-dictionary-name', kinds: ['TAG'] }, dictionaryRows)
        .totalMatches,
    ).toBe(0);
  });

  it('rejects broken or cyclic material trees, including unmatched cycles', () => {
    const row: DictionaryRow = {
      type: 'MATERIAL_CATEGORY',
      id: id(1),
      name: '分类',
      aliases: [],
      parentId: id(2),
    };
    for (const rows of [[row], [row, { ...row, id: id(2), parentId: id(1) }]])
      expect(() =>
        searchDictionaryRows({ text: '无命中', kinds: ['MATERIAL_CATEGORY'] }, rows),
      ).toThrow('INVALID_CATEGORY_TREE');
  });

  it('does not claim an empty result or build a tree from an incomplete scan', () => {
    const result = searchDictionaryRows({ kinds: ['MATERIAL_CATEGORY'] }, dictionaryRows, false);
    expect(result).toMatchObject({
      status: 'incomplete',
      totalMatches: null,
      items: [],
      hasMore: false,
    });
  });

  it.each([
    { kinds: [] },
    { kinds: ['TAG', 'TAG'] },
    { kinds: ['MATERIAL'] },
    { kinds: ['TAG'], offset: -1 },
    { kinds: ['TAG'], limit: 101 },
    { kinds: ['TAG'], ownerId: id(1) },
  ])('rejects invalid dictionary requests: %j', (input) =>
    expect(dictionaryQuerySchema.safeParse(input).success).toBe(false),
  );
});
