import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { apiError, ApiError } from './api';
import { db } from './db';
import { entryInclude, materialInclude, serializeMaterial } from './materials';
import type { MaterialValues } from './client-types';
import {
  bulkSaleValues,
  bulkStockQuantity,
  type BulkIssue,
  type MaterialBulkSnapshot,
  type MaterialBulkUpdate,
} from './material-bulk';

const include = {
  ...materialInclude,
  batchEntries: { include: { ...entryInclude, _count: { select: { diyLines: true } } } },
} satisfies Prisma.MaterialInclude;
type Item = Prisma.MaterialGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;

class BulkError extends ApiError {
  constructor(
    public issues: BulkIssue[],
    code = 'BULK_FAILED',
    status = 409,
  ) {
    super(status, code);
  }
}

export function materialBulkError(error: unknown) {
  if (error instanceof BulkError)
    return NextResponse.json({ error: error.code, issues: error.issues }, { status: error.status });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2034', 'P2002', 'P2003', 'P2025'].includes(error.code)
  )
    return NextResponse.json({ error: 'BULK_CHANGED', issues: [] }, { status: 409 });
  return apiError(error);
}

function fail(code: string, item?: Item, entryId?: string): never {
  throw new BulkError(
    [{ materialId: item?.id ?? '', name: item?.name ?? '', entryId, code }],
    code === 'CHANGED' ? 'BULK_CHANGED' : 'BULK_FAILED',
  );
}

async function readItems(tx: Tx, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'INVALID_INPUT');
  const items = await tx.material.findMany({ where: { id: { in: ids } }, include });
  const missing = ids.filter((id) => !items.some((item) => item.id === id));
  if (missing.length)
    throw new BulkError(missing.map((id) => ({ materialId: id, name: id, code: 'NOT_FOUND' })));
  return items;
}

function snapshotOf(items: Item[]): MaterialBulkSnapshot {
  return {
    materials: items.map(({ id, updatedAt }) => ({ id, updatedAt: updatedAt.toISOString() })),
    entries: items.flatMap((item) =>
      item.batchEntries.map(({ id, updatedAt }) => ({ id, updatedAt: updatedAt.toISOString() })),
    ),
  };
}

function deleteBlockers(items: Item[]) {
  return items
    .filter((item) => item.batchEntries.some((entry) => entry._count.diyLines > 0))
    .map((item) => ({ materialId: item.id, name: item.name, code: 'DIY_IN_USE' }));
}

async function checkedItems(tx: Tx, snapshot: MaterialBulkSnapshot) {
  if (new Set(snapshot.entries.map((entry) => entry.id)).size !== snapshot.entries.length)
    throw new ApiError(400, 'INVALID_INPUT');
  const items = await readItems(
    tx,
    snapshot.materials.map((item) => item.id),
  );
  const issues: BulkIssue[] = [];
  for (const item of items) {
    const expected = snapshot.materials.find((value) => value.id === item.id)!;
    const changed =
      item.updatedAt.toISOString() !== expected.updatedAt ||
      item.batchEntries.some(
        (entry) =>
          snapshot.entries.find((value) => value.id === entry.id)?.updatedAt !==
          entry.updatedAt.toISOString(),
      );
    if (changed) issues.push({ materialId: item.id, name: item.name, code: 'CHANGED' });
  }
  if (
    items.reduce((count, item) => count + item.batchEntries.length, 0) !== snapshot.entries.length
  )
    fail('CHANGED');
  if (issues.length) throw new BulkError(issues, 'BULK_CHANGED');
  return items;
}

export async function previewMaterialBulk(materialIds: string[]) {
  return db.$transaction(
    async (tx) => {
      const items = await readItems(tx, materialIds);
      return {
        items: items.map(serializeMaterial),
        snapshot: snapshotOf(items),
        deleteBlockers: deleteBlockers(items),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateMaterialBulk(input: MaterialBulkUpdate) {
  return db.$transaction(
    async (tx) => {
      const items = await checkedItems(tx, input.snapshot);
      const { changes } = input;
      const targets = items.flatMap((item) =>
        item.batchEntries
          .filter((entry) => input.entryIds.includes(entry.id))
          .map((entry) => ({ item, entry })),
      );
      if (
        new Set(input.entryIds).size !== input.entryIds.length ||
        targets.length !== input.entryIds.length
      )
        throw new ApiError(400, 'INVALID_INPUT');
      const hasBatchChanges = !!(
        changes.stock ||
        changes.sale ||
        changes.batchId ||
        changes.distributorId
      );
      if (hasBatchChanges && !targets.length) fail('ENTRIES_REQUIRED');
      if (
        changes.categoryId &&
        !(await tx.materialCategory.findUnique({ where: { id: changes.categoryId } }))
      )
        fail('CATEGORY_NOT_FOUND');
      if (
        changes.distributorId &&
        !(await tx.distributor.findUnique({ where: { id: changes.distributorId } }))
      )
        fail('DISTRIBUTOR_NOT_FOUND');
      if (changes.batchId) {
        if (!(await tx.materialBatch.findUnique({ where: { id: changes.batchId } })))
          fail('BATCH_NOT_FOUND');
        const existing = await tx.materialBatchEntry.findMany({
          where: { batchId: changes.batchId, materialId: { in: items.map((item) => item.id) } },
          select: { id: true, materialId: true },
        });
        const conflicts = targets.filter(
          ({ item, entry }) =>
            existing.some((other) => other.materialId === item.id && other.id !== entry.id) ||
            targets.filter((other) => other.item.id === item.id).length > 1,
        );
        if (conflicts.length)
          throw new BulkError(
            conflicts.map(({ item, entry }) => ({
              materialId: item.id,
              name: item.name,
              entryId: entry.id,
              code: 'BATCH_CONFLICT',
            })),
          );
      }
      const issues: BulkIssue[] = [];
      const plans = (hasBatchChanges ? targets : []).map(({ item, entry }) => {
        try {
          const nextQty = changes.stock
            ? bulkStockQuantity(entry.remainingQty?.toNumber() ?? null, item.unit, changes.stock)
            : undefined;
          const values = { ...item, ...entry, unit: item.unit };
          const saleInput = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              value instanceof Prisma.Decimal ? value.toFixed(2) : value,
            ]),
          ) as unknown as MaterialValues;
          const sale = changes.sale ? bulkSaleValues(saleInput, changes.sale) : {};
          return { item, entry, nextQty, sale };
        } catch (error) {
          issues.push({
            materialId: item.id,
            name: item.name,
            entryId: entry.id,
            code: error instanceof Error ? error.message : 'INVALID_INPUT',
          });
          return null;
        }
      });
      if (issues.length) throw new BulkError(issues);
      for (const plan of plans) {
        const { entry, nextQty, sale } = plan!;
        await tx.materialBatchEntry.update({
          where: { id: entry.id },
          data: {
            ...sale,
            ...(changes.batchId ? { batchId: changes.batchId } : {}),
            ...(changes.distributorId ? { distributorId: changes.distributorId } : {}),
            ...(nextQty !== undefined ? { remainingQty: nextQty } : {}),
          },
        });
        if (nextQty !== undefined)
          await tx.materialStockAdjustment.create({
            data: {
              entryId: entry.id,
              beforeQty: entry.remainingQty,
              afterQty: nextQty,
              delta:
                entry.remainingQty === null
                  ? null
                  : new Prisma.Decimal(nextQty).minus(entry.remainingQty),
              reason: changes.stock!.reason || '批量调整库存',
            },
          });
      }
      const affectedIds = changes.categoryId
        ? items.map((item) => item.id)
        : [...new Set(targets.map(({ item }) => item.id))];
      await tx.material.updateMany({
        where: { id: { in: affectedIds } },
        data: {
          ...(changes.categoryId ? { categoryId: changes.categoryId } : {}),
          updatedAt: new Date(),
        },
      });
      return { materialCount: affectedIds.length, entryCount: plans.length };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
  );
}

export async function deleteMaterialBulk(snapshot: MaterialBulkSnapshot) {
  return db.$transaction(
    async (tx) => {
      const items = await checkedItems(tx, snapshot);
      const blockers = deleteBlockers(items);
      if (blockers.length) throw new BulkError(blockers);
      const ids = items.map((item) => item.id);
      await tx.materialBatchEntry.deleteMany({ where: { materialId: { in: ids } } });
      await tx.material.deleteMany({ where: { id: { in: ids } } });
      return { materialCount: ids.length };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
  );
}
