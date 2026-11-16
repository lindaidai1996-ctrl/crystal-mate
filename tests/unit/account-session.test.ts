import type { JWT } from 'next-auth/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findAdmin: vi.fn(), nextAuth: vi.fn() }));
vi.mock('next-auth', () => ({
  default: (config: unknown) => {
    mocks.nextAuth(config);
    return {};
  },
}));
vi.mock('@/lib/db', () => ({ db: { admin: { findUnique: mocks.findAdmin } } }));

import '@/auth';

const sessionCallback = mocks.nextAuth.mock.calls[0][0].callbacks.session;
const jwt = mocks.nextAuth.mock.calls[0][0].callbacks.jwt as (args: {
  token: JWT;
  user?: { sessionVersion: number };
}) => Promise<JWT | null>;

beforeEach(() => {
  mocks.findAdmin.mockReset();
  mocks.findAdmin.mockResolvedValue({ sessionVersion: 0 });
});

describe('account session invalidation', () => {
  it('keeps existing version-zero sessions working until a password change', async () => {
    expect(await jwt({ token: { sub: 'admin-id' } })).toEqual({ sub: 'admin-id' });
    mocks.findAdmin.mockResolvedValue({ sessionVersion: 1 });
    expect(await jwt({ token: { sub: 'admin-id' } })).toBeNull();
  });

  it('rejects sessions issued before the latest password change', async () => {
    mocks.findAdmin.mockResolvedValue({ sessionVersion: 2 });
    expect(await jwt({ token: { sub: 'admin-id', sessionVersion: 1 } })).toBeNull();
    expect(await jwt({ token: { sub: 'admin-id', sessionVersion: 2 } })).toMatchObject({
      sub: 'admin-id',
    });
  });

  it('uses the version verified during login even if the password changes during sign-in', async () => {
    mocks.findAdmin.mockResolvedValue({ sessionVersion: 2 });
    expect(await jwt({ token: { sub: 'admin-id' }, user: { sessionVersion: 1 } })).toBeNull();
    expect(await jwt({ token: { sub: 'admin-id' }, user: { sessionVersion: 2 } })).toMatchObject({
      sessionVersion: 2,
    });
  });

  it('rejects deleted accounts and tokens without an account id', async () => {
    expect(await jwt({ token: {} })).toBeNull();
    expect(mocks.findAdmin).not.toHaveBeenCalled();
    mocks.findAdmin.mockResolvedValue(null);
    expect(await jwt({ token: { sub: 'deleted' } })).toBeNull();
  });
  it('refreshes the audit identity from the verified account and exposes its stable id in the session', async () => {
    mocks.findAdmin.mockResolvedValue({
      sessionVersion: 0,
      username: 'admin2',
      nickname: '呆呆管理员',
    });
    const token = await jwt({ token: { sub: 'stable-id' } });
    expect(token).toMatchObject({
      sub: 'stable-id',
      actorUsername: 'admin2',
      actorNickname: '呆呆管理员',
    });
    expect(await sessionCallback({ session: { user: { name: 'old-name' } }, token })).toEqual({
      user: { id: 'stable-id', name: 'admin2', nickname: '呆呆管理员' },
    });
  });
});
