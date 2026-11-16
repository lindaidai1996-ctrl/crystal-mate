import { compare, hash } from 'bcryptjs';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAdmin: vi.fn(),
  updateAdmin: vi.fn(),
  updatePassword: vi.fn(),
  findGrant: vi.fn(),
  consumeGrant: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => {
  const tx = {
    admin: {
      findUnique: mocks.findAdmin,
      update: mocks.updateAdmin,
      updateMany: mocks.updatePassword,
    },
    uploadGrant: { findFirst: mocks.findGrant, updateMany: mocks.consumeGrant },
  };
  return { db: { ...tx, $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } };
});

import { GET, PATCH } from '@/app/api/account/route';
import { POST } from '@/app/api/account/password/route';

const objectKey = 'images/123e4567-e89b-42d3-a456-426614174000.png';
const profile = { username: 'admin', nickname: '', avatarObjectKey: null, avatarUrl: null };
let passwordHash: string;
const request = (method: string, body?: object, origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/account', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const passwordInput = {
  currentPassword: 'old-password',
  newPassword: 'new-password',
  confirmPassword: 'new-password',
};

beforeEach(async () => {
  vi.resetAllMocks();
  passwordHash = await hash('old-password', 4);
  mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
  mocks.findAdmin.mockResolvedValue({ ...profile, id: 'admin-id', passwordHash });
  mocks.updateAdmin.mockResolvedValue(profile);
  mocks.updatePassword.mockResolvedValue({ count: 1 });
  mocks.findGrant.mockResolvedValue({ url: `/uploads/${objectKey}` });
  mocks.consumeGrant.mockResolvedValue({ count: 1 });
});

describe('personal account API', () => {
  it('requires authentication for reads and writes, and rejects cross-origin writes', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await PATCH(request('PATCH', { nickname: 'name' }))).status).toBe(401);
    expect((await POST(request('POST', passwordInput))).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    expect((await PATCH(request('PATCH', { nickname: 'name' }, 'http://other.test'))).status).toBe(
      403,
    );
    expect((await POST(request('POST', passwordInput, 'http://other.test'))).status).toBe(403);
    expect(mocks.findAdmin).not.toHaveBeenCalled();
  });

  it('selects only public profile fields for the authenticated account', async () => {
    mocks.findAdmin.mockResolvedValue(profile);
    const response = await GET(request('GET'));
    expect(await response.json()).toEqual(profile);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.findAdmin).toHaveBeenCalledWith({
      where: { username: 'admin' },
      select: { username: true, nickname: true, avatarObjectKey: true, avatarUrl: true },
    });
  });

  it('trims nicknames without changing login credentials or accepting another account id', async () => {
    expect((await PATCH(request('PATCH', { nickname: '  小余  ' }))).status).toBe(200);
    expect(mocks.updateAdmin.mock.calls[0][0].data).toEqual({ nickname: '小余' });
    for (const body of [
      { nickname: ' ' },
      { nickname: 'a'.repeat(41) },
      { username: 'other' },
      {},
      { id: 'other', nickname: 'name' },
    ])
      expect((await PATCH(request('PATCH', body))).status).toBe(400);
    expect(mocks.updateAdmin).toHaveBeenCalledTimes(1);
  });

  it('consumes a confirmed, unused, unexpired upload and derives the avatar URL on the server', async () => {
    expect((await PATCH(request('PATCH', { avatarObjectKey: objectKey }))).status).toBe(200);
    expect(mocks.findGrant.mock.calls[0][0].where).toMatchObject({
      objectKey,
      uploadedAt: { not: null },
      usedAt: null,
      expiresAt: { gt: expect.any(Date) },
    });
    expect(mocks.consumeGrant).toHaveBeenCalledTimes(1);
    expect(mocks.updateAdmin.mock.calls[0][0].data).toEqual({
      avatarObjectKey: objectKey,
      avatarUrl: `/uploads/${objectKey}`,
    });
  });

  it('rejects invalid upload grants and concurrent attempts to consume a grant', async () => {
    mocks.findGrant.mockResolvedValueOnce(null);
    expect((await PATCH(request('PATCH', { avatarObjectKey: objectKey }))).status).toBe(400);
    mocks.consumeGrant.mockResolvedValueOnce({ count: 0 });
    expect((await PATCH(request('PATCH', { avatarObjectKey: objectKey }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { avatarObjectKey: '../secret' }))).status).toBe(400);
    expect(mocks.updateAdmin).not.toHaveBeenCalled();
  });

  it('removes an avatar and keeps an existing avatar without requiring another upload', async () => {
    expect((await PATCH(request('PATCH', { avatarObjectKey: null }))).status).toBe(200);
    expect(mocks.updateAdmin.mock.calls[0][0].data).toEqual({
      avatarObjectKey: null,
      avatarUrl: null,
    });
    mocks.findAdmin.mockResolvedValueOnce({
      ...profile,
      id: 'admin-id',
      avatarObjectKey: objectKey,
    });
    expect((await PATCH(request('PATCH', { avatarObjectKey: objectKey }))).status).toBe(200);
    expect(mocks.findGrant).not.toHaveBeenCalled();
  });

  it('checks the current password and rejects reusing it', async () => {
    const wrong = await POST(request('POST', { ...passwordInput, currentPassword: 'wrong' }));
    expect(await wrong.json()).toEqual({ error: 'CURRENT_PASSWORD_INCORRECT' });
    const same = await POST(
      request('POST', {
        ...passwordInput,
        newPassword: 'old-password',
        confirmPassword: 'old-password',
      }),
    );
    expect(await same.json()).toEqual({ error: 'PASSWORD_UNCHANGED' });
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects mismatched, short and over-72-byte passwords, including multibyte text', async () => {
    for (const [newPassword, confirmPassword] of [
      ['new-password', 'different'],
      ['short', 'short'],
      ['a'.repeat(73), 'a'.repeat(73)],
      ['密'.repeat(25), '密'.repeat(25)],
    ])
      expect(
        (await POST(request('POST', { ...passwordInput, newPassword, confirmPassword }))).status,
      ).toBe(400);
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it('hashes the new password, invalidates old sessions and guards against concurrent changes', async () => {
    expect((await POST(request('POST', passwordInput))).status).toBe(204);
    const update = mocks.updatePassword.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'admin-id', passwordHash });
    expect(update.data.sessionVersion).toEqual({ increment: 1 });
    expect(await compare('new-password', update.data.passwordHash)).toBe(true);
    expect(update.data.passwordHash).not.toBe('new-password');
    mocks.updatePassword.mockResolvedValueOnce({ count: 0 });
    expect((await POST(request('POST', passwordInput))).status).toBe(409);
  });
});
