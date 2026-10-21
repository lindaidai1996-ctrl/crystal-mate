import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import {
  materialStockSummary,
  correctedRemainingQuantity,
  MAX_STOCK,
  validMaterialQuantity,
} from '@/lib/inventory';
import { calculatePurchase, emptyPurchase, type MaterialPurchase } from '@/lib/material-purchase';
import type { MaterialValues } from '@/lib/client-types';
import {
  materialBatchEntrySchema,
  materialBatchEntryUpdateSchema,
  materialCreateSchema,
  materialMasterSchema,
} from '@/lib/validation';

type CreateInput = z.infer<typeof materialCreateSchema>;
type EntryInput = z.infer<typeof materialBatchEntrySchema>;
type EntryUpdateInput = z.infer<typeof materialBatchEntryUpdateSchema>;
type MasterInput = z.infer<typeof materialMasterSchema>;
type Tx = Prisma.TransactionClient;
type Selection = CreateInput['selection'];

const emptyChildDetails = {
  childCount: null,
  childWeightGrams: null,
  childUnitPrice: null,
  childPriceSource: null,
  saleChildUnitPrice: null,
  saleChildManual: false,
} as const;

export const entryInclude = {
  batch: true,
  stockAdjustments: { orderBy: { createdAt: 'desc' } },
  distributor: true,
  images: { orderBy: { position: 'asc' } },
} satisfies Prisma.MaterialBatchEntryInclude;

export const materialInclude = {
  category: true,
  tags: { include: { tag: true } },
  images: { orderBy: { position: 'asc' } },
  batchEntries: { include: entryInclude },
} satisfies Prisma.MaterialInclude;

type MaterialWithRelations = Prisma.MaterialGetPayload<{ include: typeof materialInclude }>;
type EntryWithRelations = Prisma.MaterialBatchEntryGetPayload<{ include: typeof entryInclude }>;

const decimalFields = [
  'purchaseUnitPrice',
  'weightGrams',
  'purchaseGramPrice',
  'lengthMm',
  'widthMm',
  'heightMm',
  'childWeightGrams',
  'childUnitPrice',
  'saleRuleValue',
  'saleUnitPrice',
  'saleGramPrice',
  'saleChildUnitPrice',
] as const;

function amounts(record: MaterialWithRelations | EntryWithRelations) {
  return Object.fromEntries(
    decimalFields.map((field) => [field, record[field]?.toFixed(2) ?? null]),
  );
}

export function serializeEntry(entry: EntryWithRelations) {
  const purchase: MaterialPurchase = {
    ...emptyPurchase(),
    mode: entry.purchaseInputMode as MaterialPurchase['mode'],
    totalWeightGrams: entry.purchaseTotalWeightGrams?.toFixed(2) ?? null,
    totalAmount: entry.purchaseTotalAmount?.toFixed(2) ?? null,
    quotedGramPrice: entry.purchaseQuotedGramPrice?.toFixed(2) ?? null,
    autoField: entry.purchaseAutoField as MaterialPurchase['autoField'],
    sampleWeightGrams: entry.sampleWeightGrams?.toFixed(2) ?? null,
    manualUnitPrice: entry.manualPurchaseUnitPrice?.toFixed(2) ?? null,
    unitInputs: entry.purchaseUnitInputs as MaterialPurchase['unitInputs'],
  };
  return {
    ...entry,
    ...amounts(entry),
    purchase,
    receivedQty: entry.receivedQty?.toNumber() ?? null,
    remainingQty: entry.remainingQty?.toNumber() ?? null,
    stockAdjustments: entry.stockAdjustments.map((record) => ({
      ...record,
      beforeQty: record.beforeQty?.toNumber() ?? null,
      afterQty: record.afterQty.toNumber(),
      delta: record.delta?.toNumber() ?? null,
    })),
  };
}

export function serializeMaterial(material: MaterialWithRelations) {
  const { tags, ...fields } = material;
  const batchEntries = material.batchEntries
    .map(serializeEntry)
    .sort(
      (a, b) =>
        b.batch.receivedAt.getTime() - a.batch.receivedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
  return {
    ...fields,
    tags: tags.map(({ tag }) => tag),
    ...amounts(material),
    batchEntries,
    ...materialStockSummary(batchEntries),
  };
}

async function validateTags(tx: Tx, tagIds: string[]) {
  if (!tagIds.length) return;
  const count = await tx.tag.count({ where: { id: { in: tagIds } } });
  if (count !== tagIds.length) throw new ApiError(400, 'TAG_NOT_FOUND');
}

function detailValues(
  input: CreateInput['values'],
  master: Pick<MaterialValues, 'name' | 'categoryId' | 'unit' | 'notes'>,
  purchaseInput: MaterialPurchase,
  receivedQty: number | null,
) {
  const { imageKeys, ...fields } = input;
  const calculated = calculatePurchase(
    {
      ...fields,
      name: master.name,
      categoryId: master.categoryId,
      unit: master.unit,
      notes: master.notes,
    },
    purchaseInput,
    receivedQty,
  );
  if (receivedQty !== null && !validMaterialQuantity(receivedQty, master.unit))
    throw new ApiError(400, 'INVALID_INPUT');
  if (input.unit !== master.unit) throw new ApiError(409, 'MATERIAL_UNIT_LOCKED');
  if (
    master.unit === 'GRAM' &&
    (receivedQty === null || receivedQty !== Number(calculated.purchase.totalWeightGrams))
  )
    throw new ApiError(400, 'INVALID_INPUT');
  if (!calculated.valid) throw new ApiError(400, 'INVALID_INPUT');
  const {
    name: _name,
    categoryId: _categoryId,
    unit: _unit,
    notes: _notes,
    ...detail
  } = calculated.values;
  void _name;
  void _categoryId;
  void _unit;
  void _notes;
  if (
    decimalFields.some((field) => {
      const value = detail[field];
      return value !== null && !/^\d{1,10}(?:\.\d{1,2})?$/.test(value);
    })
  )
    throw new ApiError(400, 'INVALID_INPUT');
  const { purchase } = calculated;
  return {
    detail: {
      ...detail,
      purchaseInputMode: purchase.mode,
      purchaseTotalWeightGrams: purchase.totalWeightGrams,
      purchaseTotalAmount: purchase.totalAmount,
      purchaseQuotedGramPrice: purchase.quotedGramPrice,
      purchaseAutoField: purchase.autoField,
      sampleWeightGrams: purchase.sampleWeightGrams,
      manualPurchaseUnitPrice: purchase.manualUnitPrice,
      purchaseUnitInputs: purchase.unitInputs ?? Prisma.DbNull,
      unitPriceSource: calculated.source,
    },
    imageKeys,
  };
}

async function resolveBatch(tx: Tx, selection: Selection) {
  if ('batchId' in selection) {
    const batch = await tx.materialBatch.findUnique({ where: { id: selection.batchId } });
    if (!batch) throw new ApiError(400, 'MATERIAL_BATCH_NOT_FOUND');
    return batch;
  }
  const data = selection.newBatch;
  if (await tx.materialBatch.findUnique({ where: { name: data.name } }))
    throw new ApiError(409, 'MATERIAL_BATCH_NAME_EXISTS');
  return tx.materialBatch.create({
    data: { ...data, receivedAt: new Date(`${data.receivedAt}T00:00:00.000Z`) },
  });
}

async function imageUrls(tx: Tx, materialId: string | null, imageKeys: string[]) {
  const known = new Map<string, string>();
  if (materialId) {
    const [legacy, batched] = await Promise.all([
      tx.materialImage.findMany({ where: { materialId, objectKey: { in: imageKeys } } }),
      tx.materialBatchImage.findMany({
        where: { entry: { materialId }, objectKey: { in: imageKeys } },
      }),
    ]);
    for (const image of [...legacy, ...batched]) known.set(image.objectKey, image.url);
  }
  const fresh = imageKeys.filter((key) => !known.has(key));
  const grants = await tx.uploadGrant.findMany({
    where: {
      objectKey: { in: fresh },
      uploadedAt: { not: null },
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (grants.length !== fresh.length) throw new ApiError(400, 'INVALID_IMAGE');
  for (const grant of grants) known.set(grant.objectKey, grant.url);
  return { known, fresh };
}

async function replaceEntryImages(
  tx: Tx,
  entryId: string,
  imageKeys: string[],
  known: Map<string, string>,
) {
  await tx.materialBatchImage.deleteMany({ where: { entryId } });
  if (imageKeys.length)
    await tx.materialBatchImage.createMany({
      data: imageKeys.map((objectKey, position) => ({
        entryId,
        objectKey,
        url: known.get(objectKey)!,
        position,
      })),
    });
}

async function consumeGrants(tx: Tx, fresh: string[]) {
  if (fresh.length)
    await tx.uploadGrant.updateMany({
      where: { objectKey: { in: fresh }, usedAt: null },
      data: { usedAt: new Date() },
    });
}

export async function createMaterial(input: CreateInput) {
  return db.$transaction(
    async (tx) => {
      const { name, categoryId, unit, notes } = input.values;
      if (!(await tx.materialCategory.findUnique({ where: { id: categoryId } })))
        throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
      await validateTags(tx, input.tagIds);
      if (!(await tx.distributor.findUnique({ where: { id: input.distributorId } })))
        throw new ApiError(400, 'DISTRIBUTOR_NOT_FOUND');
      const batch = await resolveBatch(tx, input.selection);
      const { detail, imageKeys } = detailValues(
        input.values,
        { name, categoryId, unit, notes },
        input.purchase,
        input.receivedQty,
      );
      const { known, fresh } = await imageUrls(tx, null, imageKeys);
      const material = await tx.material.create({
        data: {
          name,
          categoryId,
          unit,
          notes,
          tags: { create: input.tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
        },
      });
      const entry = await tx.materialBatchEntry.create({
        data: {
          ...detail,
          materialId: material.id,
          batchId: batch.id,
          distributorId: input.distributorId,
          receivedQty: input.receivedQty,
          remainingQty: input.receivedQty,
        },
      });
      await replaceEntryImages(tx, entry.id, imageKeys, known);
      await consumeGrants(tx, fresh);
      return serializeMaterial(
        await tx.material.findUniqueOrThrow({
          where: { id: material.id },
          include: materialInclude,
        }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function writeMaterialMaster(
  tx: Tx,
  material: { id: string; unit: MaterialValues['unit'] },
  input: MasterInput,
) {
  if (
    material.unit !== input.unit &&
    (await tx.materialBatchEntry.count({ where: { materialId: material.id } }))
  )
    throw new ApiError(409, 'MATERIAL_UNIT_LOCKED');
  const { tagIds, ...fields } = input;
  if (!(await tx.materialCategory.findUnique({ where: { id: input.categoryId } })))
    throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
  if (tagIds) await validateTags(tx, tagIds);
  const clearChildDetails = material.unit === 'STRAND' && input.unit !== 'STRAND';
  await tx.material.update({
    where: { id: material.id },
    data: { ...fields, ...(clearChildDetails ? emptyChildDetails : {}) },
  });
  if (clearChildDetails)
    await tx.materialBatchEntry.updateMany({
      where: { materialId: material.id },
      data: emptyChildDetails,
    });
  if (tagIds) {
    await tx.materialTag.deleteMany({
      where: { materialId: material.id, tagId: { notIn: tagIds } },
    });
    const existing = await tx.materialTag.findMany({
      where: { materialId: material.id },
      select: { tagId: true },
    });
    const existingIds = new Set(existing.map(({ tagId }) => tagId));
    const added = tagIds.filter((tagId) => !existingIds.has(tagId));
    if (added.length)
      await tx.materialTag.createMany({
        data: added.map((tagId) => ({ materialId: material.id, tagId })),
      });
  }
}

export async function updateMaterialMaster(id: string, input: MasterInput) {
  return db.$transaction(
    async (tx) => {
      const material = await tx.material.findUnique({ where: { id } });
      if (!material) throw new ApiError(404, 'NOT_FOUND');
      await writeMaterialMaster(tx, material, input);
      return serializeMaterial(
        await tx.material.findUniqueOrThrow({ where: { id }, include: materialInclude }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function createMaterialEntry(materialId: string, input: EntryInput) {
  return db.$transaction(
    async (tx) => {
      const material = await tx.material.findUnique({ where: { id: materialId } });
      if (!material) throw new ApiError(404, 'NOT_FOUND');
      if (!(await tx.distributor.findUnique({ where: { id: input.distributorId } })))
        throw new ApiError(400, 'DISTRIBUTOR_NOT_FOUND');
      const batch = await resolveBatch(tx, input.selection);
      if (
        await tx.materialBatchEntry.findUnique({
          where: { materialId_batchId: { materialId, batchId: batch.id } },
        })
      )
        throw new ApiError(409, 'MATERIAL_ALREADY_IN_BATCH');
      const { detail, imageKeys } = detailValues(
        input.values,
        material,
        input.purchase,
        input.receivedQty,
      );
      const { known, fresh } = await imageUrls(tx, materialId, imageKeys);
      const entry = await tx.materialBatchEntry.create({
        data: {
          ...detail,
          materialId,
          batchId: batch.id,
          distributorId: input.distributorId,
          receivedQty: input.receivedQty,
          remainingQty: input.receivedQty,
        },
      });
      await replaceEntryImages(tx, entry.id, imageKeys, known);
      await consumeGrants(tx, fresh);
      return serializeEntry(
        await tx.materialBatchEntry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateMaterialEntry(
  materialId: string,
  entryId: string,
  input: EntryUpdateInput,
) {
  return db.$transaction(
    async (tx) => {
      const [material, current] = await Promise.all([
        tx.material.findUnique({ where: { id: materialId } }),
        tx.materialBatchEntry.findUnique({ where: { id: entryId } }),
      ]);
      if (!material || !current || current.materialId !== materialId)
        throw new ApiError(404, 'NOT_FOUND');
      const remainingQty = correctedRemainingQuantity(
        {
          receivedQty: current.receivedQty?.toNumber() ?? null,
          remainingQty: current.remainingQty?.toNumber() ?? null,
        },
        input.receivedQty,
      );
      if (remainingQty !== null && (remainingQty < 0 || remainingQty > MAX_STOCK))
        throw new ApiError(409, 'MATERIAL_STOCK_OUT_OF_RANGE');
      if (!(await tx.distributor.findUnique({ where: { id: input.distributorId } })))
        throw new ApiError(400, 'DISTRIBUTOR_NOT_FOUND');
      const master = {
        name: input.values.name,
        categoryId: input.values.categoryId,
        unit: input.values.unit,
        notes: material.notes,
        tagIds: input.tagIds,
      };
      await writeMaterialMaster(tx, material, master);
      const { detail, imageKeys } = detailValues(
        input.values,
        master,
        input.purchase,
        input.receivedQty,
      );
      const { known, fresh } = await imageUrls(tx, materialId, imageKeys);
      await tx.materialBatchEntry.update({
        where: { id: entryId },
        data: {
          ...detail,
          distributorId: input.distributorId,
          receivedQty: input.receivedQty,
          remainingQty,
        },
      });
      await replaceEntryImages(tx, entryId, imageKeys, known);
      await consumeGrants(tx, fresh);
      return serializeEntry(
        await tx.materialBatchEntry.findUniqueOrThrow({
          where: { id: entryId },
          include: entryInclude,
        }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
