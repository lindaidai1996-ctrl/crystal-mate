import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { auditContext } from '@/lib/audit-context';
import { recordSavedDiyUsage, saveRecentUsage } from '@/lib/diy-picker/recent';
import type { ProductSourceInput } from '@/lib/client-types';
const material = { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() };
const cabochon = { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() };
const lock = vi.fn();
const tx = {
  $queryRaw: lock,
  diyRecentMaterial: material,
  diyRecentCabochon: cabochon,
} as unknown as Prisma.TransactionClient;
function input(): Extract<ProductSourceInput, { origin: 'DIY' }> {
  return {
    origin: 'DIY',
    quantity: 1,
    notes: '',
    materials: [
      { materialBatchEntryId: 'entry', usageUnit: 'BEAD', quantity: '1', unitCost: '1' },
      { materialBatchEntryId: 'entry', usageUnit: 'BEAD', quantity: '2', unitCost: '1' },
    ],
    cabochons: [{ productId: 'egg', quantity: 1, unitCost: '2' }],
    extraCosts: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  material.findMany.mockResolvedValue([]);
  cabochon.findMany.mockResolvedValue([]);
});
describe('account recent DIY usage', () => {
  it('deduplicates a save and refreshes existing timestamps without retaining prices', async () => {
    await saveRecentUsage(tx, 'owner', input());
    expect(lock).toHaveBeenCalled();
    expect(material.upsert).toHaveBeenCalledTimes(1);
    const call = material.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ ownerId_entryId: { ownerId: 'owner', entryId: 'entry' } });
    expect(call.create).toEqual({ ownerId: 'owner', entryId: 'entry', usedAt: expect.any(Date) });
    expect(call.update).toEqual({ usedAt: call.create.usedAt });
    expect(cabochon.upsert.mock.calls[0][0].create.usedAt).toEqual(call.create.usedAt);
  });
  it('prunes each type after 30 and limits deletions to the same account', async () => {
    material.findMany.mockResolvedValue([{ entryId: 'old' }]);
    cabochon.findMany.mockResolvedValue([{ productId: 'old-egg' }]);
    await saveRecentUsage(tx, 'owner', input());
    expect(material.findMany.mock.calls[0][0]).toMatchObject({
      where: { ownerId: 'owner' },
      skip: 30,
    });
    expect(material.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner', entryId: { in: ['old'] } },
    });
    expect(cabochon.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner', productId: { in: ['old-egg'] } },
    });
  });
  it('gets personal ownership only from the authenticated server context', async () => {
    await recordSavedDiyUsage(tx, input());
    expect(material.upsert).not.toHaveBeenCalled();
    await auditContext.run(
      {
        operationId: 'test',
        source: 'test',
        actor: { id: 'actual-owner', username: 'test', nickname: '' },
      },
      () => recordSavedDiyUsage(tx, input()),
    );
    expect(material.upsert.mock.calls[0][0].create.ownerId).toBe('actual-owner');
  });
  it('propagates history errors to roll back the enclosing DIY transaction', async () => {
    material.upsert.mockRejectedValueOnce(new Error('history failed'));
    await expect(saveRecentUsage(tx, 'owner', input())).rejects.toThrow('history failed');
    expect(cabochon.upsert).not.toHaveBeenCalled();
  });
});
