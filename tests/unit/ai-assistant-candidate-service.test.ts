import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { assistantQuerySchema, type AssistantQuery } from '../../src/lib/ai-assistant/contracts';
import { readAssistantCandidates } from '../../src/lib/ai-assistant/candidate-data';

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  material: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  materialBatchEntry: { findMany: vi.fn() },
  productPurchaseEntry: { findMany: vi.fn() },
  distributor: { findMany: vi.fn() },
  materialCategory: { findMany: vi.fn() },
  category: { findMany: vi.fn() },
  tag: { findMany: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ requireAccount: mocks.requireAccount }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import {
  queryAssistantCandidates,
  getAssistantCandidateDetails,
} from '../../src/lib/ai-assistant/candidate-service';
const request = new NextRequest('http://localhost/api/assistant');
const id = (n: number) => `c${n.toString().padStart(24, '0')}`;
const date = new Date('2026-11-14T00:00:00Z');
const query: AssistantQuery = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
    location: { text: '荔湾广场', kind: 'exact_place' },
  },
  semantic: [{ concept: 'purpose', text: '配件', relation: 'is' }],
  ruleVersion: 'v1',
  pagination: { limit: 1 },
});
const material = {
  id: id(10),
  name: '绿松石圆珠',
  aliases: ['真别名'],
  notes: '',
  createdAt: date,
  category: { id: id(11), name: '绿松石', aliases: ['分类别名'] },
  tags: [{ tag: { id: id(12), name: '圆珠' } }],
};
const purchase = {
  id: id(20),
  createdAt: date,
  material,
  batch: { id: id(21), name: '采购批次', receivedAt: date, createdAt: date },
  distributor: { id: id(1), name: '供应商', createdAt: date },
};
const tx = { ...mocks, $executeRaw: mocks.execute } as unknown as Prisma.TransactionClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockResolvedValue({ id: 'account', username: 'tester', nickname: '' });
  for (const model of [
    mocks.material,
    mocks.product,
    mocks.materialBatchEntry,
    mocks.productPurchaseEntry,
    mocks.distributor,
    mocks.materialCategory,
    mocks.category,
    mocks.tag,
  ])
    model.findMany.mockResolvedValue([]);
  mocks.distributor.findMany.mockResolvedValue([
    { id: id(1), name: '供应商', area: '荔湾', address: '荔湾广场', notes: '' },
    { id: id(2), name: '未确认供应商', area: '荔湾', address: '', notes: '' },
  ]);
  mocks.execute.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
});

describe('authenticated candidate service and hard boundaries', () => {
  it('authenticates query and detail access before touching the database or snapshot', async () => {
    mocks.requireAccount.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(queryAssistantCandidates(request, query)).rejects.toThrow('UNAUTHORIZED');
    await expect(getAssistantCandidateDetails(request, {})).rejects.toThrow('UNAUTHORIZED');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('validates input before opening a transaction and propagates database failure', async () => {
    await expect(queryAssistantCandidates(request, { ...query, ownerId: id(1) })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.transaction.mockRejectedValue(new Error('DB_FAILED'));
    await expect(queryAssistantCandidates(request, query)).rejects.toThrow('DB_FAILED');
  });
  it('reads a read-only consistent snapshot once and reauthenticates page/detail calls', async () => {
    mocks.materialBatchEntry.findMany.mockResolvedValue([purchase, { ...purchase, id: id(22) }]);
    const first = await queryAssistantCandidates(request, query);
    const second = await queryAssistantCandidates(request, {
      ...query,
      pagination: { limit: 1, cursor: first.nextCursor },
    });
    const detail = await getAssistantCandidateDetails(request, {
      runId: first.runId,
      candidates: first.items.map(({ item, purchase }) => ({ item, purchase })),
    });
    expect(second.completeness).toMatchObject({
      totalCandidates: 2,
      uniqueCatalogItems: 1,
      readCandidates: 2,
    });
    expect(mocks.requireAccount).toHaveBeenCalledTimes(3);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
      timeout: 20000,
    });
    expect(mocks.execute.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    expect(detail.items[0]).toMatchObject({
      code: null,
      batch: { type: 'BATCH', id: id(21) },
      distributor: { type: 'DISTRIBUTOR', id: id(1) },
    });
    expect(JSON.stringify(first)).not.toContain('address');
    expect(first.items[0].evidence).toEqual(
      expect.arrayContaining([
        { entity: { type: 'MATERIAL', id: id(10) }, field: 'aliases', value: ['真别名'] },
        {
          entity: { type: 'MATERIAL_CATEGORY', id: id(11) },
          field: 'aliases',
          value: ['分类别名'],
        },
        { entity: { type: 'BATCH', id: id(21) }, field: 'receivedAt', value: '2026-11-14' },
      ]),
    );
  });
  it('applies confirmed location only, UTC calendar boundaries, and leaves semantic text out of hard filters', async () => {
    await queryAssistantCandidates(request, query);
    const args = mocks.materialBatchEntry.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      distributorId: { in: [id(1)] },
      batch: {
        receivedAt: { gte: new Date('2026-11-01T00:00:00Z'), lt: new Date('2026-12-01T00:00:00Z') },
      },
      material: {},
    });
    expect(JSON.stringify(args)).not.toContain('配件');
    expect(args.select.distributor.select).toEqual({ id: true, name: true, createdAt: true });
  });
  it('keeps empty location intersections as in:[] for both catalog and purchases', async () => {
    mocks.distributor.findMany
      .mockResolvedValueOnce([{ id: id(2) }])
      .mockResolvedValueOnce([
        { id: id(1), name: '', area: '荔湾', address: '荔湾广场', notes: '' },
      ]);
    const result = await queryAssistantCandidates(request, {
      ...query,
      hard: { ...query.hard, distributorIds: [id(2)] },
    });
    expect(mocks.materialBatchEntry.findMany.mock.calls[0][0].where.distributorId).toEqual({
      in: [],
    });
    expect(result.completeness.totalCandidates).toBe(0);
    mocks.distributor.findMany.mockResolvedValue([]);
    await queryAssistantCandidates(request, {
      ...query,
      subject: 'catalog',
      hard: { location: query.hard.location },
    });
    expect(mocks.material.findMany.mock.calls[0][0].where.batchEntries.some.distributorId).toEqual({
      in: [],
    });
  });
  it.each(['exact_place', 'area'] as const)(
    'does not drop unresolved %s locations',
    async (kind) => {
      mocks.distributor.findMany.mockResolvedValue([
        {
          id: id(1),
          name: '供应商',
          area: kind === 'area' ? '荔湾区' : '荔湾',
          address: '',
          notes: '曾在荔湾广场',
        },
      ]);
      await expect(
        queryAssistantCandidates(request, {
          ...query,
          hard: { location: { text: kind === 'area' ? '荔湾' : '荔湾广场', kind } },
        }),
      ).rejects.toThrow('LOCATION_NEEDS_CLARIFICATION');
      expect(mocks.materialBatchEntry.findMany).not.toHaveBeenCalled();
    },
  );
  it('fails closed on incomplete location scans and oversized candidate ranges', async () => {
    mocks.distributor.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, (_, n) => ({
        id: id(n),
        name: '店铺',
        area: '广州',
        address: '荔湾广场',
        notes: '',
      })),
    );
    await expect(queryAssistantCandidates(request, query)).rejects.toThrow('LOCATION_INCOMPLETE');
    mocks.materialBatchEntry.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, () => purchase),
    );
    await expect(queryAssistantCandidates(request, { ...query, hard: {} })).rejects.toThrow(
      'CANDIDATE_BUDGET_EXCEEDED',
    );
  });
  it.each(['items', 'distributorIds', 'tagIds', 'categories'] as const)(
    'rejects missing %s references',
    async (field) => {
      mocks.distributor.findMany.mockResolvedValue([]);
      const values = {
        items: [{ type: 'MATERIAL', id: id(999) }],
        distributorIds: [id(999)],
        tagIds: [id(999)],
        categories: [{ type: 'MATERIAL_CATEGORY', id: id(999), includeDescendants: true }],
      };
      await expect(
        queryAssistantCandidates(request, { ...query, hard: { [field]: values[field] } }),
      ).rejects.toThrow('REFERENCE_NOT_FOUND');
      expect(mocks.materialBatchEntry.findMany).not.toHaveBeenCalled();
    },
  );
  it('expands requested category descendants and ORs tags, with other filters ANDed', async () => {
    mocks.materialCategory.findMany.mockResolvedValue([
      { id: id(1), parentId: null },
      { id: id(2), parentId: id(1) },
      { id: id(3), parentId: id(2) },
    ]);
    mocks.tag.findMany.mockResolvedValue([{ id: id(5) }, { id: id(6) }]);
    const parsed = assistantQuerySchema.parse({
      ...query,
      hard: {
        categories: [{ type: 'MATERIAL_CATEGORY', id: id(1), includeDescendants: true }],
        tagIds: [id(5), id(6)],
      },
    });
    await readAssistantCandidates(tx, parsed);
    const where = mocks.materialBatchEntry.findMany.mock.calls[0][0].where;
    expect(new Set(where.material.categoryId.in)).toEqual(new Set([id(1), id(2), id(3)]));
    expect(where.material.tags.some.tagId.in).toEqual([id(5), id(6)]);
  });
  it.each([true, false])('rejects category cycles or broken parents (cycle=%s)', async (cycle) => {
    mocks.materialCategory.findMany.mockResolvedValue([
      { id: id(1), parentId: cycle ? id(1) : id(2) },
    ]);
    await expect(
      queryAssistantCandidates(request, {
        ...query,
        hard: { categories: [{ type: 'MATERIAL_CATEGORY', id: id(1), includeDescendants: true }] },
      }),
    ).rejects.toThrow('INVALID_CATEGORY_TREE');
  });
  it.each(['catalog', 'purchase', 'batch', 'distributor'] as const)(
    'applies %s createdAt to its actual entity',
    async (entity) => {
      await queryAssistantCandidates(request, {
        ...query,
        hard: {
          createdAt: { entity, from: '2026-11-01T00:00:00+08:00', to: '2026-12-01T00:00:00+08:00' },
        },
      });
      const where = mocks.materialBatchEntry.findMany.mock.calls[0][0].where;
      const owner =
        entity === 'catalog' ? where.material : entity === 'purchase' ? where : where[entity];
      expect(owner.createdAt).toEqual({
        gte: new Date('2026-10-31T16:00:00Z'),
        lt: new Date('2026-11-30T16:00:00Z'),
      });
    },
  );
  it('queries product catalog and purchases with real descriptions and purchase notes', async () => {
    const product = { ...material, code: 'P001', description: '商品描述' };
    mocks.product.findMany.mockResolvedValue([product]);
    const catalog = await queryAssistantCandidates(request, {
      ...query,
      subject: 'catalog',
      itemTypes: ['PRODUCT'],
      hard: {},
    });
    expect(catalog.items[0]).toMatchObject({ item: { type: 'PRODUCT' }, purchase: null });
    mocks.productPurchaseEntry.findMany.mockResolvedValue([
      { ...purchase, product, notes: '采购备注' },
    ]);
    const page = await queryAssistantCandidates(request, {
      ...query,
      itemTypes: ['PRODUCT'],
      hard: {},
    });
    expect(page.items[0].purchase?.type).toBe('PRODUCT_PURCHASE');
    expect(page.items[0].evidence).toEqual(
      expect.arrayContaining([
        { entity: { type: 'PRODUCT', id: material.id }, field: 'description', value: '商品描述' },
        {
          entity: { type: 'PRODUCT_PURCHASE', id: purchase.id },
          field: 'notes',
          value: '采购备注',
        },
      ]),
    );
  });
});
