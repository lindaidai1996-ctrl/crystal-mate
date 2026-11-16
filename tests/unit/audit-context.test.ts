import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { withAuditRoute } from '@/lib/audit-route';
import { auditContext } from '@/lib/audit-context';
import { withDatabaseAudit } from '@/lib/audit-db';
import type { PrismaClient } from '@prisma/client';

const actor = { id: 'account-a', username: 'admin', nickname: '豆子管理员' };

describe('authenticated audit context', () => {
  it('isolates concurrent requests and ignores client-supplied actor/operation IDs', async () => {
    const handler = withAuditRoute(async (request: NextRequest) => {
      const context = auditContext.getStore()!;
      await Promise.resolve();
      context.actor = { ...actor, id: request.nextUrl.pathname };
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      return { ...auditContext.getStore()! };
    });
    const requests = ['/one', '/two'].map(
      (path) =>
        new NextRequest(`http://localhost${path}`, {
          method: 'POST',
          body: JSON.stringify({ actor: { id: 'spoofed' }, operationId: 'spoofed' }),
        }),
    );
    const [one, two] = await Promise.all(requests.map((request) => handler(request)));
    expect(one.actor?.id).toBe('/one');
    expect(two.actor?.id).toBe('/two');
    expect(one.operationId).not.toBe(two.operationId);
    expect(one.operationId).not.toBe('spoofed');
    expect(auditContext.getStore()).toBeUndefined();
  });

  it('sets transaction-local identity on the same transaction as a standalone mutation', async () => {
    const order: string[] = [];
    const query = vi.fn(async (...args: unknown[]) => {
      void args;
      order.push('identity');
    });
    const create = vi.fn(async () => {
      order.push('write');
      return { id: 'record' };
    });
    const directCreate = vi.fn(() => Promise.resolve({ id: 'not-executed' }));
    const raw = {
      product: { findMany: vi.fn(), create: directCreate },
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: query, product: { create } }),
    } as unknown as PrismaClient;
    const db = withDatabaseAudit(raw);
    await auditContext.run({ operationId: 'operation', source: 'POST /api/products', actor }, () =>
      db.product.create({ data: {} } as never),
    );
    expect(order).toEqual(['identity', 'write']);
    expect(query.mock.calls[0][1]).toContain('account-a');
    expect(directCreate).toHaveBeenCalledTimes(1);
  });

  it('sets identity once for existing interactive transactions and fails closed without an actor', async () => {
    const query = vi.fn(async () => []);
    const create = vi.fn(async () => ({ id: 'record' }));
    const raw = {
      $transaction: async (callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: query, product: { create } }),
    } as unknown as PrismaClient;
    const db = withDatabaseAudit(raw);
    await auditContext.run({ operationId: 'operation', source: 'POST /api/products', actor }, () =>
      db.$transaction(async (tx) => {
        await tx.product.create({ data: {} } as never);
        await tx.product.create({ data: {} } as never);
      }),
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    await expect(
      auditContext.run({ operationId: 'missing-actor', source: 'POST /api/products' }, () =>
        db.$transaction(async () => {}),
      ),
    ).rejects.toThrow('authenticated audit actor');
  });
});
