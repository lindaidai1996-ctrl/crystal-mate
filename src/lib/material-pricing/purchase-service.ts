import { createHash } from 'node:crypto';
import { z } from 'zod';
import { procurementTransaction } from './transaction';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { correctedRemainingQuantity, MAX_STOCK } from '@/lib/inventory';
import { emptyMaterial } from '@/lib/material-defaults';
import { emptyPurchase } from '@/lib/material-purchase';
import { pricingBatchNameBase } from './batch-names';
import { reservePricingBatchName } from './purchase-batch-name';
import {
  createMaterialEntryInTransaction,
  detailValues,
  serializeEntry,
  entryInclude,
} from '@/lib/materials';
import { materialBatchEntrySchema, materialSchema } from '@/lib/validation';
import {
  procurementSchema,
  procurementUpdateSchema,
  procurementMetrics,
  type ProcurementRow,
} from './purchase-contracts';

type Tx = Prisma.TransactionClient;
const batchRelations = {
  entries: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { ...entryInclude, material: { include: { pricingGroup: true } } },
  },
  _count: { select: { productEntries: true } },
} satisfies Prisma.MaterialBatchInclude;

async function procurementBatch(tx: Tx, id: string) {
  z.string().cuid().parse(id);
  const batch = await tx.materialBatch.findUnique({ where: { id }, include: batchRelations });
  if (!batch) throw new ApiError(404, 'NOT_FOUND');
  return batch;
}
function editable(batch: Awaited<ReturnType<typeof procurementBatch>>) {
  return (
    batch.entries.length > 0 &&
    batch._count.productEntries === 0 &&
    batch.entries.every(
      (entry) => entry.material.unit === 'GRAM' && entry.material.pricingGroupId !== null,
    ) &&
    new Set(batch.entries.map((entry) => entry.distributorId)).size === 1
  );
}
function fingerprint(batch: Awaited<ReturnType<typeof procurementBatch>>) {
  return createHash('sha256').update(JSON.stringify(batch)).digest('hex');
}
export async function getProcurement(id: string) {
  return db.$transaction(
    async (tx) => {
      const batch = await procurementBatch(tx, id);
      if (!editable(batch)) throw new ApiError(409, 'PRICING_MIXED_BATCH');
      return {
        fingerprint: fingerprint(batch),
        receivedAt: batch.receivedAt.toISOString().slice(0, 10),
        distributorId: batch.entries[0].distributorId,
        notes: batch.notes,
        initialStock: 'FULL' as const,
        lines: batch.entries.map((entry) => ({
          entryId: entry.id,
          materialId: entry.materialId,
          weight: entry.purchaseTotalWeightGrams?.toFixed(2) ?? '',
          amount: entry.purchaseTotalAmount?.toFixed(2) ?? '',
          quote: entry.purchaseQuotedGramPrice?.toFixed(2) ?? null,
          quotePurpose: entry.purchaseQuotePurpose as 'LEGACY' | 'BEFORE_DISCOUNT',
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function writeProcurementInTransaction(tx: Tx, raw: unknown) {
  const input = procurementSchema.parse(raw);
  if (input.lines.some((line) => line.entryId)) throw new ApiError(400, 'INVALID_INPUT');
  const materials = await tx.material.findMany({
    where: { id: { in: input.lines.map((line) => line.materialId) } },
    include: { pricingGroup: true },
  });
  const orderedMaterials = input.lines.map((line) =>
    materials.find((item) => item.id === line.materialId),
  );
  if (
    orderedMaterials.some(
      (material) => !material || material.unit !== 'GRAM' || !material.pricingGroup,
    )
  )
    throw new ApiError(400, 'PRICING_MATERIAL_REQUIRED');
  const distributor = await tx.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) throw new ApiError(400, 'INVALID_INPUT');
  const name = await reservePricingBatchName(
    tx,
    pricingBatchNameBase(
      input.receivedAt,
      orderedMaterials.map((material) => material!.pricingGroup!),
      [distributor],
    ),
  );
  const batch = await tx.materialBatch.create({
    data: {
      name,
      receivedAt: new Date(`${input.receivedAt}T00:00:00Z`),
      purpose: 'PRICING',
      notes: input.notes,
    },
  });
  const entryIds: string[] = [];
  for (const line of input.lines) {
    const material = materials.find((item) => item.id === line.materialId)!;
    const entry = await createMaterialEntryInTransaction(
      tx,
      material.id,
      materialBatchEntrySchema.parse({
        values: {
          ...emptyMaterial(),
          imageKeys: [],
          name: material.name,
          categoryId: material.categoryId,
          unit: 'GRAM',
          notes: material.notes,
        },
        selection: { batchId: batch.id },
        distributorId: input.distributorId,
        receivedQty: Number(line.weight),
        initialStock: input.initialStock,
        purchase: {
          ...emptyPurchase(),
          mode: 'BATCH',
          quotePurpose: line.quotePurpose,
          quotedGramPrice: line.quote,
          totalWeightGrams: line.weight,
          totalAmount: line.amount,
          autoField: null,
        },
      }),
    );
    entryIds.push(entry.id);
  }
  return { batchId: batch.id, entryIds };
}
export async function saveProcurement(raw: unknown, id?: string) {
  if (!id) return procurementTransaction((tx) => writeProcurementInTransaction(tx, raw));
  const input = procurementUpdateSchema.parse(raw);
  return procurementTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MaterialBatch" WHERE id = ${id} FOR UPDATE`;
    const batch = await procurementBatch(tx, id);
    if (!editable(batch)) throw new ApiError(409, 'PRICING_MIXED_BATCH');
    if (input.fingerprint !== fingerprint(batch))
      throw new ApiError(409, 'PRICING_PURCHASE_CHANGED');
    if (
      input.lines.length !== batch.entries.length ||
      input.lines.some(
        (line) =>
          !batch.entries.some(
            (entry) => entry.id === line.entryId && entry.materialId === line.materialId,
          ),
      )
    )
      throw new ApiError(400, 'INVALID_INPUT');
    for (const line of input.lines) {
      const current = batch.entries.find((entry) => entry.id === line.entryId)!;
      const serialized = serializeEntry(current);
      const source = {
        ...serialized,
        ...current.material,
        ...serialized,
        name: current.material.name,
        categoryId: current.material.categoryId,
        unit: 'GRAM',
        notes: current.material.notes,
        imageKeys: [],
      };
      const values = materialSchema.parse(
        Object.fromEntries(
          Object.keys(materialSchema.shape)
            .filter((key) => key in source)
            .map((key) => [key, source[key as keyof typeof source]]),
        ),
      );
      const { detail } = detailValues(
        values,
        current.material,
        {
          ...emptyPurchase(),
          mode: 'BATCH',
          quotePurpose: line.quotePurpose,
          quotedGramPrice: line.quote,
          totalWeightGrams: line.weight,
          totalAmount: line.amount,
        },
        Number(line.weight),
      );
      const remainingQty = correctedRemainingQuantity(
        {
          receivedQty: current.receivedQty?.toNumber() ?? null,
          remainingQty: current.remainingQty?.toNumber() ?? null,
        },
        Number(line.weight),
      );
      if (remainingQty !== null && (remainingQty < 0 || remainingQty > MAX_STOCK))
        throw new ApiError(409, 'MATERIAL_STOCK_OUT_OF_RANGE');
      await tx.materialBatchEntry.update({
        where: { id: current.id },
        data: {
          ...detail,
          receivedQty: line.weight,
          remainingQty,
          distributorId: input.distributorId,
        },
      });
    }
    const distributor = await tx.distributor.findUnique({ where: { id: input.distributorId } });
    if (!distributor) throw new ApiError(400, 'INVALID_INPUT');
    const name =
      batch.purpose === 'PRICING'
        ? await reservePricingBatchName(
            tx,
            pricingBatchNameBase(
              input.receivedAt,
              batch.entries.map((entry) => entry.material.pricingGroup!),
              [distributor],
            ),
            id,
          )
        : batch.name;
    await tx.materialBatch.update({
      where: { id },
      data: { name, receivedAt: new Date(`${input.receivedAt}T00:00:00Z`), notes: input.notes },
    });
    return { batchId: id, entryIds: batch.entries.map((entry) => entry.id) };
  });
}
export async function listProcurement() {
  return db.$transaction(
    async (tx) => {
      const entries = await tx.materialBatchEntry.findMany({
        where: { material: { unit: 'GRAM', pricingGroupId: { not: null } } },
        include: { material: { include: { pricingGroup: true } }, batch: true, distributor: true },
        orderBy: [{ batch: { receivedAt: 'desc' } }, { id: 'asc' }],
        take: 5001,
      });
      if (entries.length > 5000) throw new ApiError(400, 'PRICING_PURCHASE_LIMIT');
      const items: ProcurementRow[] = entries.map((entry) => {
        const weight = entry.purchaseTotalWeightGrams?.toFixed(2) ?? null;
        const amount = entry.purchaseTotalAmount?.toFixed(2) ?? null;
        const quote = entry.purchaseQuotedGramPrice?.toFixed(2) ?? null;
        return {
          id: entry.id,
          batchId: entry.batchId,
          batchName: entry.batch.name,
          receivedAt: entry.batch.receivedAt.toISOString().slice(0, 10),
          distributorId: entry.distributorId,
          distributorName: entry.distributor.name,
          materialId: entry.materialId,
          materialName: entry.material.name,
          groupId: entry.material.pricingGroupId!,
          groupName: entry.material.pricingGroup!.name,
          weight,
          amount,
          quote,
          quotePurpose: entry.purchaseQuotePurpose,
          ...procurementMetrics(
            weight,
            amount,
            entry.purchaseQuotePurpose === 'BEFORE_DISCOUNT' ? quote : null,
          ),
          remaining: entry.remainingQty?.toFixed(2) ?? null,
        };
      });
      const [materials, distributors, groups, categories] = await Promise.all([
        tx.material.findMany({
          where: { unit: 'GRAM', pricingGroupId: { not: null } },
          select: {
            id: true,
            name: true,
            pricingGroupId: true,
            pricingGroup: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
        }),
        tx.distributor.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        tx.materialPricingGroup.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        tx.materialCategory.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);
      return { items, materials, distributors, groups, categories };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export type ProcurementCatalog = Awaited<ReturnType<typeof listProcurement>>;
