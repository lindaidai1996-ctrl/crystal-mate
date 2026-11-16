import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccount: vi.fn(),
  distributor: { findMany: vi.fn() },
  materialCategory: { findMany: vi.fn() },
  category: { findMany: vi.fn() },
  tag: { findMany: vi.fn() },
  transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ requireAccount: mocks.requireAccount }));
vi.mock('@/lib/db', () => ({
  db: {
    distributor: mocks.distributor,
    materialCategory: mocks.materialCategory,
    category: mocks.category,
    tag: mocks.tag,
    $transaction: mocks.transaction,
  },
}));
import {
  resolveAssistantLocation,
  searchAssistantDictionary,
} from '../../src/lib/ai-assistant/reference-service';

const request = new NextRequest('http://localhost/api/assistant');
const location = { text: '荔湾广场', kind: 'exact_place' };
const id = (number: number) => `c${number.toString().padStart(24, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockResolvedValue({ id: id(1), username: 'tester', nickname: '' });
  for (const model of [mocks.distributor, mocks.materialCategory, mocks.category, mocks.tag])
    model.findMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback) => callback(mocks));
});

describe('authenticated assistant reference services', () => {
  it('denies unauthenticated access before reading any rows', async () => {
    mocks.requireAccount.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(resolveAssistantLocation(request, location)).rejects.toThrow('UNAUTHORIZED');
    await expect(searchAssistantDictionary(request, { kinds: ['TAG'] })).rejects.toThrow(
      'UNAUTHORIZED',
    );
    expect(mocks.distributor.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects unknown parameters before database access', async () => {
    await expect(
      resolveAssistantLocation(request, { ...location, sql: 'SELECT 1' }),
    ).rejects.toThrow();
    await expect(
      searchAssistantDictionary(request, { kinds: ['TAG'], ownerId: id(1) }),
    ).rejects.toThrow();
    expect(mocks.distributor.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('selects only location fields after account verification', async () => {
    mocks.distributor.findMany.mockResolvedValue([
      { id: id(2), name: '店铺', area: '广州', address: '荔湾广场2楼', notes: '' },
    ]);
    const result = await resolveAssistantLocation(request, location);
    expect(result.confirmed[0].distributor.id).toBe(id(2));
    expect(mocks.requireAccount).toHaveBeenCalledWith(request);
    expect(mocks.requireAccount.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.distributor.findMany.mock.invocationCallOrder[0],
    );
    expect(mocks.distributor.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, area: true, address: true, notes: true },
      orderBy: { id: 'asc' },
      take: 5001,
    });
  });

  it('loads only selected dictionaries and does not fabricate flat dictionary aliases', async () => {
    mocks.tag.findMany.mockResolvedValue([{ id: id(2), name: '绿松石' }]);
    const result = await searchAssistantDictionary(request, { kinds: ['TAG'] });
    expect(result.items[0]).toMatchObject({
      entity: { type: 'TAG' },
      aliases: [],
      parentId: null,
      ancestors: [],
      descendants: [],
    });
    expect(mocks.materialCategory.findMany).not.toHaveBeenCalled();
    expect(mocks.category.findMany).not.toHaveBeenCalled();
    expect(mocks.distributor.findMany).not.toHaveBeenCalled();
    expect(mocks.tag.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 5001,
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 10000,
    });
  });

  it('maps material tree and all flat dictionary sources with their actual types', async () => {
    mocks.materialCategory.findMany.mockResolvedValue([
      { id: id(1), name: '分类', aliases: ['别名'], parentId: null },
    ]);
    mocks.category.findMany.mockResolvedValue([{ id: id(2), name: '分类' }]);
    mocks.tag.findMany.mockResolvedValue([{ id: id(3), name: '标签' }]);
    mocks.distributor.findMany.mockResolvedValue([{ id: id(4), name: '渠道商' }]);
    const result = await searchAssistantDictionary(request, {
      kinds: ['MATERIAL_CATEGORY', 'PRODUCT_CATEGORY', 'TAG', 'DISTRIBUTOR'],
    });
    expect(result.totalMatches).toBe(4);
    expect(result.items.map((row) => row.entity.type)).toEqual([
      'DISTRIBUTOR',
      'MATERIAL_CATEGORY',
      'PRODUCT_CATEGORY',
      'TAG',
    ]);
  });

  it('exposes scan exhaustion instead of treating the first 5000 rows as all data', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      id: id(index),
      name: '店铺',
      area: '广州',
      address: '',
      notes: '',
    }));
    mocks.distributor.findMany.mockResolvedValue(rows);
    expect(await resolveAssistantLocation(request, location)).toMatchObject({
      status: 'incomplete',
      scanComplete: false,
    });
    expect(await searchAssistantDictionary(request, { kinds: ['DISTRIBUTOR'] })).toMatchObject({
      status: 'incomplete',
      totalMatches: null,
      items: [],
    });
  });

  it('propagates database errors without manufacturing empty success', async () => {
    mocks.distributor.findMany.mockRejectedValue(new Error('DATABASE_UNAVAILABLE'));
    await expect(resolveAssistantLocation(request, location)).rejects.toThrow(
      'DATABASE_UNAVAILABLE',
    );
    await expect(searchAssistantDictionary(request, { kinds: ['DISTRIBUTOR'] })).rejects.toThrow(
      'DATABASE_UNAVAILABLE',
    );
  });
});
