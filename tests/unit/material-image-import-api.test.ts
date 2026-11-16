import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recognize: vi.fn(),
  recognizeItem: vi.fn(),
  commit: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { materialImageImport: { findMany: mocks.list } } }));
vi.mock('@/lib/ai/imageRecognition', () => ({ imageRecognitionModels: () => [] }));
vi.mock('@/lib/materialImageImport/store', () => ({
  recognizeImageImport: mocks.recognize,
  commitImageImportItem: mocks.commit,
  deleteImageImport: mocks.remove,
}));
vi.mock('@/lib/materialImageImport/itemRecognition', () => ({
  recognizeImageImportItem: mocks.recognizeItem,
}));
import { POST as recognize } from '@/app/api/material-image-imports/[id]/recognize/route';
import { POST as commit } from '@/app/api/material-image-imports/[id]/commit/route';
import { POST as recognizeItem } from '@/app/api/material-image-imports/[id]/recognize-item/route';
import { DELETE as remove } from '@/app/api/material-image-imports/[id]/route';
import { GET as list } from '@/app/api/material-image-imports/route';

const context = { params: Promise.resolve({ id: 'test-import' }) };
beforeEach(() => {
  vi.clearAllMocks();
});

describe('image import API authorization', () => {
  it('includes archived receipts and progress in import history', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    mocks.list.mockResolvedValue([
      {
        id: 'completed',
        fileName: 'supplier.png',
        archivedAt: '2026-11-13T01:00:00.000Z',
        _count: { items: 2 },
        items: [{ id: 'first' }, { id: 'second' }],
      },
    ]);
    const response = await list(new NextRequest('http://localhost/api/material-image-imports'));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([
      {
        id: 'completed',
        fileName: 'supplier.png',
        archivedAt: '2026-11-13T01:00:00.000Z',
        _count: { items: 2 },
        importedCount: 2,
      },
    ]);
    expect(mocks.list.mock.calls[0][0].where?.archivedAt).toBeUndefined();
  });

  it('validates the deletion version and returns an empty success response', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    const request = (body: unknown) =>
      new NextRequest('http://localhost/api/material-image-imports/test-import', {
        method: 'DELETE',
        body: JSON.stringify(body),
      });
    for (const body of [{}, { version: -1 }, { version: '3' }]) {
      expect((await remove(request(body), context)).status).toBe(400);
    }
    expect(mocks.remove).not.toHaveBeenCalled();
    const response = await remove(request({ version: 3 }), context);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(mocks.remove).toHaveBeenCalledWith('test-import', 3);
  });

  it('validates regions before requesting a single-item preview', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    const payload = {
      itemId: '641d34e5-8a91-4d8d-8d38-fb4543259f75',
      version: 3,
      provider: 'deepseek',
      objectBox: { x: 10, y: 10, width: 200, height: 200 },
      priceBox: null,
    };
    const preview = { itemId: payload.itemId, version: 3, data: { priceText: '25' } };
    mocks.recognizeItem.mockResolvedValue(preview);
    const request = (body: unknown) =>
      new NextRequest('http://localhost/api/material-image-imports/test/recognize-item', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      });
    const response = await recognizeItem(request(payload), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(mocks.recognizeItem).toHaveBeenCalledWith('test-import', payload);
    mocks.recognizeItem.mockClear();
    const invalid = await recognizeItem(
      request({ ...payload, objectBox: { ...payload.objectBox, x: 999 } }),
      context,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.recognizeItem).not.toHaveBeenCalled();
  });

  it('requires authentication before either external model access or stock writes', async () => {
    mocks.auth.mockResolvedValue(null);
    for (const handler of [recognize, recognizeItem, commit, remove]) {
      const response = await handler(
        new NextRequest('http://localhost/api/material-image-imports/test', {
          method: handler === remove ? 'DELETE' : 'POST',
        }),
        context,
      );
      expect(response.status).toBe(401);
    }
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(mocks.recognizeItem).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('rejects cross-origin stock and model requests', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    for (const handler of [recognize, recognizeItem, commit, remove]) {
      const response = await handler(
        new NextRequest('http://localhost/api/material-image-imports/test', {
          method: handler === remove ? 'DELETE' : 'POST',
          headers: { origin: 'https://other.example' },
        }),
        context,
      );
      expect(response.status).toBe(403);
    }
    expect(mocks.recognize).not.toHaveBeenCalled();
    expect(mocks.recognizeItem).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
