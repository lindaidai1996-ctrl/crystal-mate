import { Prisma, type MaterialPricingPublication } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/metal-market-service', () => ({ marketService: { read: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));

import { getPricingPreview, publishPricingGroup } from '@/lib/material-pricing/service';

const makeGroup = () => ({
  id: 'pricing-group',
  name: 'Silver',
  version: 1,
  enabled: false,
  lossRate: new Prisma.Decimal(0),
  marketLinked: false,
  marketCoefficient: new Prisma.Decimal(1),
  pricingRule: 'CUSTOM',
  pricingValue: new Prisma.Decimal(25),
  materials: [{ id: 'material', name: 'Silver', unit: 'GRAM' }],
  publications: [] as MaterialPricingPublication[],
});
let group = makeGroup();
let purchaseAmount: Prisma.Decimal | null;
const tx = {
  materialPricingGroup: {
    findUnique: vi.fn(() => group),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { id: string; version: number };
        data: { version: { increment: number }; enabled?: boolean };
      }) => {
        if (where.id !== group.id || where.version !== group.version) return { count: 0 };
        group.version += data.version.increment;
        if (data.enabled !== undefined) group.enabled = data.enabled;
        return { count: 1 };
      },
    ),
  },
  materialBatchEntry: {
    findMany: vi.fn(() => [
      {
        id: 'entry',
        materialId: 'material',
        material: { name: 'Silver' },
        batchId: 'batch',
        batch: { name: 'Purchase', receivedAt: new Date('2026-01-01T00:00:00Z') },
        distributorId: 'supplier',
        distributor: { name: 'Supplier' },
        purchaseTotalAmount: purchaseAmount,
        purchaseTotalWeightGrams: new Prisma.Decimal(100),
      },
    ]),
  },
  materialPricingPublication: {
    create: vi.fn(
      ({
        data,
      }: {
        data: Omit<MaterialPricingPublication, 'id' | 'createdAt' | 'saleGramPrice'> & {
          saleGramPrice: string;
        };
      }) => {
        const publication = {
          ...data,
          id: `publication-${data.version}`,
          createdAt: new Date(),
          saleGramPrice: new Prisma.Decimal(data.saleGramPrice),
        };
        group.publications.unshift(publication);
        return publication;
      },
    ),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  group = makeGroup();
  purchaseAmount = new Prisma.Decimal(1200);
  mocks.transaction.mockImplementation(
    async (operation: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = { ...group, publications: [...group.publications] };
      try {
        return await operation(tx);
      } catch (error) {
        group = snapshot;
        throw error;
      }
    },
  );
});

async function publishCurrentPrice() {
  const { group: current, preview } = await getPricingPreview(group.id);
  return publishPricingGroup(group.id, {
    version: current.version,
    fingerprint: preview.fingerprint,
    saleGramPrice: '25',
  });
}

describe('pricing publication and activation', () => {
  it('enables the group with its first published price', async () => {
    const publication = await publishCurrentPrice();
    const current = await getPricingPreview(group.id);
    expect(current.group.enabled).toBe(true);
    expect(current.group.publication?.id).toBe(publication.id);
    expect(current.group.publication?.saleGramPrice).toBe('25.00');
    expect(current.group.version).toBe(2);
  });

  it.each([true, false])('preserves enabled=%s when publishing another price', async (enabled) => {
    await publishCurrentPrice();
    group.enabled = enabled;
    await publishCurrentPrice();
    expect((await getPricingPreview(group.id)).group.enabled).toBe(enabled);
    expect(group.publications).toHaveLength(2);
  });

  it('does not publish or enable a group without valid procurement costs', async () => {
    purchaseAmount = null;
    await expect(publishCurrentPrice()).rejects.toMatchObject({ code: 'PRICING_NO_COST' });
    expect(group.enabled).toBe(false);
    expect(tx.materialPricingGroup.updateMany).not.toHaveBeenCalled();
    expect(group.publications).toHaveLength(0);
  });

  it('rejects an outdated version without enabling the group', async () => {
    const { preview } = await getPricingPreview(group.id);
    group.version += 1;
    await expect(
      publishPricingGroup(group.id, {
        version: 1,
        fingerprint: preview.fingerprint,
        saleGramPrice: '25',
      }),
    ).rejects.toMatchObject({ code: 'PRICING_CHANGED' });
    expect(group.enabled).toBe(false);
    expect(group.publications).toHaveLength(0);
  });

  it('rolls back activation and the version if the publication cannot be saved', async () => {
    tx.materialPricingPublication.create.mockImplementationOnce(() => {
      throw new Error('Publication write failed');
    });
    await expect(publishCurrentPrice()).rejects.toThrow('Publication write failed');
    expect(group.enabled).toBe(false);
    expect(group.version).toBe(1);
    expect(group.publications).toHaveLength(0);
  });
});
