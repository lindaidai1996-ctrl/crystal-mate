import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    editorDraft: {
      findMany: mocks.list,
      findFirst: mocks.find,
      create: mocks.create,
      updateMany: mocks.update,
      deleteMany: mocks.remove,
    },
  },
}));
import { GET as list, POST } from '@/app/api/editor-drafts/route';
import { GET, PUT, DELETE } from '@/app/api/editor-drafts/[id]/route';
import { POST as claim } from '@/app/api/editor-drafts/[id]/claim/route';
const context = { params: Promise.resolve({ id: 'draft' }) };
const request = (method = 'GET', body?: object, query = '') =>
  new NextRequest(`http://localhost/api/editor-drafts${query}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'owner-a', name: 'admin', nickname: '豆子管理员' } });
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: 'new-draft' });
  mocks.update.mockResolvedValue({ count: 0 });
  mocks.remove.mockResolvedValue({ count: 0 });
  mocks.find.mockResolvedValue(null);
});
describe('personal editor drafts', () => {
  it('lists personal drafts by default and exposes historical drafts only through the explicit legacy filter', async () => {
    expect((await list(request('GET', undefined, '?kind=PRODUCT'))).status).toBe(200);
    expect(mocks.list.mock.calls[0][0].where).toEqual({ kind: 'PRODUCT', ownerId: 'owner-a' });
    await list(request('GET', undefined, '?kind=PRODUCT&scope=legacy'));
    expect(mocks.list.mock.calls[1][0].where).toEqual({ kind: 'PRODUCT', ownerId: null });
  });
  it('gets the creator from the session, ignoring a forged owner in the request body', async () => {
    expect(
      (
        await POST(
          request('POST', { kind: 'PRODUCT', title: 'draft', data: {}, ownerId: 'owner-b' }),
        )
      ).status,
    ).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.ownerId).toBe('owner-a');
  });
  it('cannot read, overwrite or delete another account draft', async () => {
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.find).toHaveBeenCalledWith({ where: { id: 'draft', ownerId: 'owner-a' } });
    expect(
      (await PUT(request('PUT', { kind: 'PRODUCT', title: 'x', data: {} }), context)).status,
    ).toBe(404);
    expect(mocks.update.mock.calls[0][0].where).toEqual({
      id: 'draft',
      kind: 'PRODUCT',
      ownerId: 'owner-a',
    });
    expect((await DELETE(request('DELETE'), context)).status).toBe(404);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'draft', ownerId: 'owner-a' } });
  });
  it('claims only a still-unassigned draft using an atomic owner-null condition', async () => {
    mocks.update.mockResolvedValueOnce({ count: 1 });
    expect((await claim(request('POST'), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'draft', ownerId: null },
      data: { ownerId: 'owner-a' },
    });
    expect((await claim(request('POST'), context)).status).toBe(409);
  });
});
