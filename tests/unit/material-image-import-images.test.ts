import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

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
import { holdDraftImages, heldDraftImageUrls } from '@/lib/materialImageImport/draftImages';
import { newImportItem } from '@/lib/materialImageImport/contracts';
import { importMaterialDraft } from '@/lib/materialImageImport/materialDraft';

const key = 'images/11111111-1111-4111-8111-111111111111.png';
function row() {
  const data = newImportItem('PURCHASE');
  data.material = importMaterialDraft(data);
  data.material.images = [{ objectKey: key, url: '/untrusted-client-url', position: 0 }];
  return { id: crypto.randomUUID(), data };
}
function transaction(usedAt: Date | null, expiresAt: Date) {
  const uploadGrant = {
    findMany: vi
      .fn()
      .mockResolvedValue([
        { objectKey: key, url: '/server-image-url', usedAt, expiresAt, uploadedAt: new Date() },
      ]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return { tx: { uploadGrant } as unknown as Prisma.TransactionClient, uploadGrant };
}

describe('saved import draft attachments', () => {
  it('reserves new uploads and stores the server URL', async () => {
    const { tx, uploadGrant } = transaction(null, new Date(Date.now() + 60_000));
    const next = await holdDraftImages(tx, [], [row()], new Set());
    expect(uploadGrant.updateMany).toHaveBeenCalledOnce();
    expect(next[0].data.material?.images[0].url).toBe('/server-image-url');
  });

  it('can save and commit its own reserved image after the upload grant expires', async () => {
    const { tx, uploadGrant } = transaction(new Date(), new Date(0));
    const current = row();
    const previous = [{ id: current.id, data: current.data as unknown as Prisma.JsonValue }];
    const next = await holdDraftImages(tx, previous, [current], new Set());
    expect(uploadGrant.updateMany).not.toHaveBeenCalled();
    expect((await heldDraftImageUrls(tx, next[0].data)).get(key)).toBe('/server-image-url');
  });

  it.each([
    [null, new Date(0)],
    [new Date(), new Date(Date.now() + 60_000)],
  ])(
    'rejects expired or already claimed uploads not held by this candidate',
    async (usedAt, expiry) => {
      const { tx } = transaction(usedAt, expiry!);
      await expect(holdDraftImages(tx, [], [row()], new Set())).rejects.toThrow('INVALID_IMAGE');
    },
  );

  it('does not allow two candidates to claim the same extra image', async () => {
    const { tx } = transaction(null, new Date(Date.now() + 60_000));
    await expect(holdDraftImages(tx, [], [row(), row()], new Set())).rejects.toThrow(
      'INVALID_IMAGE',
    );
  });

  it('rolls back when a competing request claims the upload first', async () => {
    const { tx, uploadGrant } = transaction(null, new Date(Date.now() + 60_000));
    uploadGrant.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(holdDraftImages(tx, [], [row()], new Set())).rejects.toThrow('IMPORT_CONFLICT');
  });
});
