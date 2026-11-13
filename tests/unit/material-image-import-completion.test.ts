import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newImportItem } from '@/lib/materialImageImport/contracts';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  createMaterial: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/lib/materials', () => ({
  createMaterialInTransaction: mocks.createMaterial,
}));
vi.mock('@/lib/materialImageImport/materialInput', () => ({
  materialInputFromImport: () => ({ values: {} }),
}));
vi.mock('@/lib/materialImageImport/draftImages', () => ({
  heldDraftImageUrls: async () => new Map(),
}));
import { commitImageImportItem } from '@/lib/materialImageImport/store';

function transaction(remaining: number, entryId: string | null = null) {
  const row = { id: 'candidate', data: newImportItem('PURCHASE'), materialId: null, entryId };
  const job = {
    id: 'import',
    version: 3,
    settings: { distributorId: 'supplier', selection: null, priceKind: 'PURCHASE' },
    warnings: [],
    items: [row],
    updatedAt: new Date(),
    archivedAt: null as Date | null,
  };
  const tx = {
    materialImageImportItem: {
      findFirst: vi.fn().mockResolvedValue(row),
      update: vi.fn(async ({ data }) => Object.assign(row, data)),
      count: vi.fn().mockResolvedValue(remaining),
    },
    materialImageImport: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn(async () => job),
      update: vi.fn(async ({ data }) => Object.assign(job, data)),
    },
    materialBatchAttachment: { findUnique: vi.fn().mockResolvedValue({ id: 'source' }) },
  };
  mocks.transaction.mockImplementation(async (run) => run(tx));
  mocks.createMaterial.mockResolvedValue({
    id: 'material',
    batchEntries: [{ id: 'receipt', batchId: 'cbatch123' }],
  });
  return { tx, job };
}

const input = { version: 3, itemId: 'candidate', imageKey: 'crop.png' };

beforeEach(() => vi.clearAllMocks());

describe('material image import completion', () => {
  it('archives with the final receipt in the same transaction', async () => {
    const { job } = transaction(0);
    const result = await commitImageImportItem('import', input);
    expect(result.archivedAt).toBeTruthy();
    expect(job.archivedAt).toBeInstanceOf(Date);
    expect(result.items[0].entryId).toBe('receipt');
  });

  it('keeps an import open while any candidates remain, including unselected candidates', async () => {
    transaction(1);
    const result = await commitImageImportItem('import', input);
    expect(result.archivedAt).toBeNull();
    expect(result.items[0].entryId).toBe('receipt');
  });

  it('returns an archived receipt on retry without creating stock again', async () => {
    const { job, tx } = transaction(0, 'existing-receipt');
    job.archivedAt = new Date();
    const result = await commitImageImportItem('import', input);
    expect(result.archivedAt).toBeTruthy();
    expect(result.items[0].entryId).toBe('existing-receipt');
    expect(tx.materialImageImport.updateMany).not.toHaveBeenCalled();
    expect(mocks.createMaterial).not.toHaveBeenCalled();
  });
});
