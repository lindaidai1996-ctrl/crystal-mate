import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { auditContext, type AuditActor } from '@/lib/audit-context';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgres://localhost/none').pathname.endsWith('_test');
const first: AuditActor = { id: 'audit-first', username: 'admin', nickname: '豆子管理员' };
const second: AuditActor = { id: 'audit-second', username: 'admin2', nickname: '呆呆管理员' };
function asActor<T>(actor: AuditActor, operationId: string, action: () => Promise<T>) {
  return auditContext.run({ actor, operationId, source: 'POST /api/audit-test' }, action);
}
afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('transactional business audit', () => {
  it('keeps creators, records nested and bulk changes, associates children and survives cascade deletion', async () => {
    const operationId = randomUUID();
    const category = await db.category.create({ data: { name: operationId } });
    const product = await asActor(first, operationId, () =>
      db.product.create({
        data: {
          code: `audit-${operationId}`,
          name: '审计验证商品',
          categoryId: category.id,
          priceCents: 50000,
          stock: 5,
          images: {
            create: {
              objectKey: `images/${operationId}.png`,
              url: 'https://example.invalid/image',
              position: 0,
            },
          },
        },
      }),
    );
    const creation = await db.auditLog.findMany({ where: { operationId } });
    expect(creation.map((row) => row.entityType).sort()).toEqual(['Product', 'ProductImage']);
    expect(creation.every((row) => row.actorId === first.id && row.rootId === product.id)).toBe(
      true,
    );
    const updateOperation = randomUUID();
    await asActor(second, updateOperation, () =>
      db.$transaction(async (tx) => {
        await tx.product.updateMany({ where: { id: product.id }, data: { priceCents: 60000 } });
        await tx.productStockAdjustment.create({
          data: { productId: product.id, delta: -1, beforeQty: 5, afterQty: 4, reason: '破损' },
        });
        await tx.product.update({ where: { id: product.id }, data: { stock: 4 } });
      }),
    );
    const attribution = await db.recordAttribution.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: 'Product', entityId: product.id } },
    });
    expect(attribution.createdBy).toEqual(first);
    expect(attribution.updatedBy).toEqual(second);
    const change = await db.auditLog.findFirstOrThrow({
      where: { operationId: updateOperation, changedFields: { has: 'priceCents' } },
    });
    expect(change.before).toMatchObject({ priceCents: 50000 });
    expect(change.after).toMatchObject({ priceCents: 60000 });
    const beforeNoOp = await db.auditLog.count({ where: { entityId: product.id } });
    await asActor(second, randomUUID(), () =>
      db.product.update({
        where: { id: product.id },
        data: { priceCents: 60000, updatedAt: new Date() },
      }),
    );
    expect(await db.auditLog.count({ where: { entityId: product.id } })).toBe(beforeNoOp);
    await asActor(second, randomUUID(), () =>
      db.$transaction(async (tx) => {
        await tx.productStockAdjustment.deleteMany({ where: { productId: product.id } });
        await tx.product.delete({ where: { id: product.id } });
      }),
    );
    expect(
      await db.auditLog.count({
        where: { rootId: product.id, action: 'DELETE', entityType: 'ProductImage' },
      }),
    ).toBe(1);
    expect(
      (
        await db.recordAttribution.findUniqueOrThrow({
          where: { entityType_entityId: { entityType: 'Product', entityId: product.id } },
        })
      ).deletedAt,
    ).not.toBeNull();
    await db.category.delete({ where: { id: category.id } });
  }, 30000);

  it('rolls back history with business data and never leaks pooled-connection identity', async () => {
    const operationId = randomUUID();
    await expect(
      asActor(first, operationId, () =>
        db.$transaction(async (tx) => {
          await tx.tag.create({ data: { name: operationId } });
          throw new Error('rollback');
        }),
      ),
    ).rejects.toThrow('rollback');
    expect(await db.auditLog.count({ where: { operationId } })).toBe(0);
    expect(await db.tag.count({ where: { name: operationId } })).toBe(0);
    const systemTag = await db.tag.create({ data: { name: `${operationId}-system` } });
    expect(
      (await db.auditLog.findFirstOrThrow({ where: { entityId: systemTag.id } })).actorId,
    ).toBeNull();
    await db.tag.delete({ where: { id: systemTag.id } });
  });

  it('keeps batch writes lazy, atomic and attributed to their shared operator', async () => {
    const operationId = randomUUID();
    const tags = await asActor(second, operationId, () =>
      db.$transaction([
        db.tag.create({ data: { name: operationId + '-one' } }),
        db.tag.create({ data: { name: operationId + '-two' } }),
      ]),
    );
    const logs = await db.auditLog.findMany({ where: { operationId } });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.actorId === second.id)).toBe(true);
    const failedOperation = randomUUID();
    await expect(
      asActor(first, failedOperation, () =>
        db.$transaction([
          db.tag.create({ data: { name: failedOperation } }),
          db.tag.create({ data: { name: tags[0].name } }),
        ]),
      ),
    ).rejects.toThrow();
    expect(await db.tag.count({ where: { name: failedOperation } })).toBe(0);
    expect(await db.auditLog.count({ where: { operationId: failedOperation } })).toBe(0);
    await db.tag.deleteMany({ where: { id: { in: tags.map((tag) => tag.id) } } });
  });

  it('stores account password events without hash material and prevents rewriting history', async () => {
    const operationId = randomUUID();
    const marker = `never-log-${operationId}`;
    const account = await asActor(first, operationId, () =>
      db.admin.create({ data: { username: `audit-${operationId}`, passwordHash: marker } }),
    );
    const logs = await db.auditLog.findMany({ where: { operationId } });
    expect(JSON.stringify(logs)).not.toContain(marker);
    expect(JSON.stringify(logs)).not.toContain('passwordHash');
    expect(logs[0].changedFields).toContain('passwordChanged');
    await expect(db.auditLog.delete({ where: { id: logs[0].id } })).rejects.toThrow('append-only');
    await db.admin.delete({ where: { id: account.id } });
  });

  it('backfills historical creator identity as unknown and never guesses an account', async () => {
    // The isolated DB is copied from development, whose original accounts predate this migration.
    const admins = await db.admin.findMany({ where: { username: { in: ['admin', 'admin2'] } } });
    for (const admin of admins) {
      const info = await db.recordAttribution.findUniqueOrThrow({
        where: { entityType_entityId: { entityType: 'Admin', entityId: admin.id } },
      });
      expect(info.createdBy).toBeNull();
    }
  });
});
