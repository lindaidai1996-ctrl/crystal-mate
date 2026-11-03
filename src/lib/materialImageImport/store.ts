import { MAX_ATTACHMENTS } from '@/lib/attachments';
import { Prisma } from '@prisma/client';
import { normalizeAliases } from '@/lib/catalog-aliases';
import { catalogAliasesSchema } from '@/lib/validation';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { createMaterialInTransaction, createMaterialEntryInTransaction } from '@/lib/materials';
import {
  imageRecognitionConfig,
  IMAGE_PROMPT_VERSION,
  recognizeImage,
} from '@/lib/ai/imageRecognition';
import {
  importDraftSchema,
  importItemDataSchema,
  importSettingsSchema,
  type createImportSchema,
  type commitImportSchema,
  type recognizeImportSchema,
  type ImageImport,
} from './contracts';
import type { z } from 'zod';
import { readImportSource } from './sourceImage';
import { materialInputFromImport } from './materialInput';
import { holdDraftImages, heldDraftImageUrls } from './draftImages';

const include = { items: { orderBy: { position: 'asc' as const } } };
type StoredImport = Prisma.MaterialImageImportGetPayload<{ include: typeof include }>;
const json = (value: unknown) => value as Prisma.InputJsonValue;

function serialize(item: StoredImport): ImageImport {
  return {
    id: item.id,
    sourceUrl: item.sourceUrl,
    fileName: item.fileName,
    width: item.width,
    height: item.height,
    provider: item.provider,
    model: item.model,
    status: item.status,
    version: item.version,
    updatedAt: item.updatedAt.toISOString(),
    settings: importSettingsSchema.parse(item.settings),
    warnings: item.warnings as string[],
    errorCode: item.errorCode,
    leaseUntil: item.leaseUntil?.toISOString() ?? null,
    archivedAt: item.archivedAt?.toISOString() ?? null,
    items: item.items.map((row) => ({
      id: row.id,
      data: importItemDataSchema.parse(row.data),
      materialId: row.materialId,
      entryId: row.entryId,
    })),
  };
}

export async function getImageImport(id: string) {
  const item = await db.materialImageImport.findUnique({ where: { id }, include });
  if (!item) throw new ApiError(404, 'NOT_FOUND');
  return serialize(item);
}

export async function deleteImageImport(id: string, version: number) {
  // Fence commits and recognition before deciding whether history can be deleted.
  // Committed receipts remain available for tracing stock back to the original image.
  await db.$transaction(async (tx) => {
    const locked = await tx.materialImageImport.updateMany({
      where: {
        id,
        version,
        archivedAt: null,
        OR: [{ status: { not: 'PROCESSING' } }, { leaseUntil: { lte: new Date() } }],
      },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1) {
      const exists = await tx.materialImageImport.findUnique({
        where: { id },
        select: { id: true },
      });
      throw new ApiError(exists ? 409 : 404, exists ? 'IMPORT_CONFLICT' : 'NOT_FOUND');
    }
    const committed = await tx.materialImageImportItem.count({
      where: { importId: id, entryId: { not: null } },
    });
    if (committed) {
      await tx.materialImageImport.update({
        where: { id },
        data: { archivedAt: new Date(), runToken: null, leaseUntil: null },
      });
    } else {
      await tx.materialImageImport.delete({ where: { id } });
    }
  });
}

export async function createImageImport(input: z.infer<typeof createImportSchema>) {
  const config = imageRecognitionConfig(input.provider);
  const { priceKind, ...source } = input;
  return db.$transaction(async (tx) => {
    const existing = await tx.materialImageImport.findUnique({
      where: { sourceKey: input.sourceKey },
      include,
    });
    if (existing) return serialize(existing);
    const grant = await tx.uploadGrant.findUnique({ where: { objectKey: input.sourceKey } });
    if (!grant?.uploadedAt || grant.usedAt || grant.expiresAt <= new Date())
      throw new ApiError(400, 'INVALID_IMAGE');
    const claimed = await tx.uploadGrant.updateMany({
      where: { id: grant.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ApiError(409, 'IMPORT_CONFLICT');
    return serialize(
      await tx.materialImageImport.create({
        data: {
          ...source,
          sourceUrl: grant.url,
          model: config.model,
          promptVersion: IMAGE_PROMPT_VERSION,
          settings: { distributorId: '', selection: null, priceKind },
          warnings: [],
        },
        include,
      }),
    );
  });
}

export async function saveImageImport(id: string, input: z.infer<typeof importDraftSchema>) {
  if (new Set(input.items.map((row) => row.id)).size !== input.items.length)
    throw new ApiError(400, 'INVALID_INPUT');
  return db.$transaction(async (tx) => {
    const locked = await tx.materialImageImport.updateMany({
      where: {
        id,
        version: input.version,
        archivedAt: null,
        OR: [{ status: { not: 'PROCESSING' } }, { leaseUntil: { lt: new Date() } }],
      },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1) throw new ApiError(409, 'IMPORT_CONFLICT');
    const current = await tx.materialImageImport.findUniqueOrThrow({ where: { id }, include });
    const committed = await tx.materialImageImportItem.findMany({
      where: { importId: id, entryId: { not: null } },
    });
    if (committed.length) {
      // Keep one import in one supplier/batch, even for requests outside this UI.
      if (
        JSON.stringify(importSettingsSchema.parse(current.settings)) !==
        JSON.stringify(input.settings)
      )
        throw new ApiError(409, 'IMPORT_ALREADY_COMMITTED');
    }
    const committedIds = new Set(committed.map((item) => item.id));
    for (const item of committed) {
      const incoming = input.items.find((row) => row.id === item.id);
      if (
        !incoming ||
        JSON.stringify(importItemDataSchema.parse(item.data)) !== JSON.stringify(incoming.data)
      )
        throw new ApiError(409, 'IMPORT_ALREADY_COMMITTED');
    }
    const rows = await holdDraftImages(tx, current.items, input.items, committedIds);
    // Only editable candidates are replaced. Imported records remain immutable.
    await tx.materialImageImportItem.deleteMany({ where: { importId: id, entryId: null } });
    const editable = rows.filter((row) => !committedIds.has(row.id));
    if (editable.length) {
      const start = Math.max(-1, ...committed.map((row) => row.position)) + 1;
      await tx.materialImageImportItem.createMany({
        data: editable.map((row, position) => ({
          id: row.id,
          importId: id,
          position: start + position,
          data: json(row.data),
        })),
      });
    }
    await tx.materialImageImport.update({
      where: { id },
      data: {
        settings: json(input.settings),
        ...(current.status === 'PROCESSING'
          ? { status: 'READY', runToken: null, leaseUntil: null, errorCode: null }
          : {}),
      },
    });
    return serialize(await tx.materialImageImport.findUniqueOrThrow({ where: { id }, include }));
  });
}

export async function recognizeImageImport(
  id: string,
  input: z.infer<typeof recognizeImportSchema>,
) {
  const config = imageRecognitionConfig(input.provider);
  const token = crypto.randomUUID();
  const leaseUntil = new Date(Date.now() + 120_000);
  const job = await db.$transaction(async (tx) => {
    const locked = await tx.materialImageImport.updateMany({
      where: {
        id,
        version: input.version,
        archivedAt: null,
        items: { none: { entryId: { not: null } } },
        OR: [{ status: { not: 'PROCESSING' } }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        status: 'PROCESSING',
        runToken: token,
        leaseUntil,
        errorCode: null,
      },
    });
    if (locked.count !== 1) throw new ApiError(409, 'IMPORT_CONFLICT');
    return tx.materialImageImport.findUniqueOrThrow({ where: { id } });
  });
  try {
    const settings = importSettingsSchema.parse(job.settings);
    const result = await recognizeImage(
      input.provider,
      await readImportSource(job.sourceKey),
      settings.priceKind,
    );
    await db.$transaction(async (tx) => {
      const locked = await tx.materialImageImport.updateMany({
        where: { id, runToken: token, version: input.version },
        data: {
          status: 'READY',
          provider: config.id,
          model: result.model,
          runToken: null,
          leaseUntil: null,
          warnings: result.warnings,
          promptVersion: IMAGE_PROMPT_VERSION,
          version: { increment: 1 },
        },
      });
      if (locked.count !== 1) throw new ApiError(409, 'IMPORT_CONFLICT');
      await tx.materialImageImportItem.deleteMany({ where: { importId: id } });
      await tx.materialImageImportItem.createMany({
        data: result.items.map((data, position) => ({ importId: id, position, data: json(data) })),
      });
    });
  } catch (error) {
    await db.materialImageImport.updateMany({
      where: { id, runToken: token },
      data: {
        status: 'FAILED',
        runToken: null,
        leaseUntil: null,
        errorCode: error instanceof ApiError ? error.code : 'IMPORT_MODEL_UNAVAILABLE',
      },
    });
    throw error;
  }
  return getImageImport(id);
}

export async function commitImageImportItem(id: string, input: z.infer<typeof commitImportSchema>) {
  return db
    .$transaction(
      async (tx) => {
        const previous = await tx.materialImageImportItem.findFirst({
          where: { id: input.itemId, importId: id },
        });
        if (!previous) throw new ApiError(404, 'NOT_FOUND');
        // A retry after a lost HTTP response returns the receipt without increasing stock again.
        if (previous.entryId)
          return serialize(
            await tx.materialImageImport.findUniqueOrThrow({ where: { id }, include }),
          );
        const locked = await tx.materialImageImport.updateMany({
          where: { id, version: input.version, archivedAt: null, status: { not: 'PROCESSING' } },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) throw new ApiError(409, 'IMPORT_CONFLICT');
        const job = await tx.materialImageImport.findUniqueOrThrow({ where: { id } });
        const settings = importSettingsSchema.parse(job.settings);
        const data = importItemDataSchema.parse(previous.data);
        const materialInput = materialInputFromImport(data, settings, input.imageKey);
        if (!materialInput) throw new ApiError(400, 'IMPORT_INCOMPLETE');
        const heldImages = await heldDraftImageUrls(tx, data);
        let materialId: string;
        let entryId: string;
        let batchId: string;
        if (data.existingMaterialId) {
          const entry = await createMaterialEntryInTransaction(
            tx,
            data.existingMaterialId,
            materialInput,
            heldImages,
          );
          const existing = await tx.material.findUniqueOrThrow({
            where: { id: data.existingMaterialId },
            select: { aliases: true },
          });
          await tx.material.update({
            where: { id: data.existingMaterialId },
            data: {
              aliases: catalogAliasesSchema.parse(
                normalizeAliases([...existing.aliases, ...(materialInput.values.aliases ?? [])]),
              ),
            },
          });
          materialId = data.existingMaterialId;
          entryId = entry.id;
          batchId = entry.batchId;
        } else {
          const material = await createMaterialInTransaction(tx, materialInput, heldImages);
          materialId = material.id;
          entryId = material.batchEntries[0].id;
          batchId = material.batchEntries[0].batchId;
        }
        const sourceAttachment = await tx.materialBatchAttachment.findUnique({
          where: { batchId_objectKey: { batchId, objectKey: job.sourceKey } },
        });
        if (!sourceAttachment) {
          const last = await tx.materialBatchAttachment.aggregate({
            where: { batchId },
            _max: { position: true },
            _count: { _all: true },
          });
          if (last._count._all >= MAX_ATTACHMENTS)
            throw new ApiError(400, 'ATTACHMENT_LIMIT_EXCEEDED');
          await tx.materialBatchAttachment.create({
            data: {
              batchId,
              objectKey: job.sourceKey,
              url: job.sourceUrl,
              fileName: job.fileName,
              notes: '图片批量录入原图',
              position: (last._max.position ?? -1) + 1,
            },
          });
        }
        await tx.materialImageImportItem.update({
          where: { id: input.itemId },
          data: { materialId, entryId },
        });
        await tx.materialImageImport.update({
          where: { id },
          data: { settings: json({ ...settings, selection: { batchId } }) },
        });
        return serialize(
          await tx.materialImageImport.findUniqueOrThrow({ where: { id }, include }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    )
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
        throw new ApiError(409, 'IMPORT_CONFLICT');
      throw error;
    });
}
