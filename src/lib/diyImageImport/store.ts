import { randomUUID } from 'node:crypto';
import { Prisma, type DiyImageImport } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { withProductTransaction } from '@/lib/product-code-store';
import { imageRecognitionConfig } from '@/lib/ai/imageRecognition';
import { readImportSource } from '@/lib/materialImageImport/sourceImage';
import {
  diyDataSchema,
  diyPartSchema,
  diyImagesSchema,
  emptyDiyData,
  mergeDiyRecognition,
  type DiyImport,
  type DiyImage,
  type diyCreateSchema,
  type diySaveSchema,
  type diyRecognizeSchema,
} from './contracts';
import { detectDiyParts, DIY_PROMPT_VERSION } from './vision';
import { matchDiyParts } from './matching';

export const diyJson = (value: unknown) => value as Prisma.InputJsonValue;
export function serializeDiyImport(row: DiyImageImport): DiyImport {
  return {
    id: row.id,
    images: diyImagesSchema.parse(row.images),
    data: diyDataSchema.parse(row.data),
    version: row.version,
    status: row.status,
    warnings: z.array(z.string()).parse(row.warnings),
    errorCode: row.errorCode,
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    provider: row.provider,
    model: row.model,
    productId: row.productId,
    runId: row.runId,
  };
}
export async function getDiyImport(id: string) {
  const row = await db.diyImageImport.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return serializeDiyImport(row);
}
export async function lockDiyDraft(tx: Prisma.TransactionClient, id: string, version: number) {
  const row = await tx.diyImageImport.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  if (row.status === 'COMMITTED') throw new ApiError(409, 'DIY_ALREADY_COMMITTED');
  if (
    row.version !== version ||
    (row.status === 'PROCESSING' && row.leaseUntil && row.leaseUntil > new Date())
  )
    throw new ApiError(409, 'DIY_CONFLICT');
  const locked = await tx.diyImageImport.updateMany({
    where: { id, version },
    data: { version: { increment: 1 } },
  });
  if (locked.count !== 1) throw new ApiError(409, 'DIY_CONFLICT');
  return row;
}
async function claimImages(
  tx: Prisma.TransactionClient,
  images: DiyImage[],
  previous: DiyImage[] = [],
) {
  // An image can remain attached to this draft, but cannot be borrowed from another draft/product.
  const old = new Map(previous.map((image) => [image.objectKey, image]));
  const keys = images.filter((image) => !old.has(image.objectKey)).map((image) => image.objectKey);
  const now = new Date();
  const grants = await tx.uploadGrant.findMany({
    where: {
      objectKey: { in: keys },
      usedAt: null,
      uploadedAt: { not: null },
      expiresAt: { gt: now },
    },
  });
  if (grants.length !== keys.length) throw new ApiError(400, 'INVALID_IMAGE');
  if (keys.length) {
    const claimed = await tx.uploadGrant.updateMany({
      where: {
        objectKey: { in: keys },
        usedAt: null,
        uploadedAt: { not: null },
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== keys.length) throw new ApiError(409, 'DIY_CONFLICT');
  }
  return images.map((image) => {
    const existing = old.get(image.objectKey);
    if (
      existing &&
      (existing.id !== image.id ||
        existing.width !== image.width ||
        existing.height !== image.height)
    )
      throw new ApiError(400, 'INVALID_IMAGE');
    return {
      ...image,
      url: existing?.url ?? grants.find((grant) => grant.objectKey === image.objectKey)!.url,
    };
  });
}
export async function createDiyImport(input: z.infer<typeof diyCreateSchema>) {
  return withProductTransaction(async (tx) => {
    const existing = await tx.diyImageImport.findUnique({ where: { id: input.id } });
    if (existing) return serializeDiyImport(existing);
    const data = emptyDiyData();
    const silver = await tx.silverPricing.findUnique({ where: { id: 'default' } });
    if (silver)
      data.silverCost = {
        weightGrams: '0',
        costGramPrice: silver.costGramPrice.toFixed(2),
        quoteGramPrice: silver.quoteGramPrice.toFixed(2),
      };
    if (input.targetProductId) {
      const product = await tx.product.findUnique({ where: { id: input.targetProductId } });
      if (!product || (product.origin !== null && product.origin !== 'DIY'))
        throw new ApiError(400, 'PRODUCT_ORIGIN_MISMATCH');
      Object.assign(data, {
        targetProductId: product.id,
        name: product.name,
        code: product.code,
        categoryId: product.categoryId,
        salePrice: (product.priceCents / 100).toFixed(2),
      });
    }
    return serializeDiyImport(
      await tx.diyImageImport.create({
        data: {
          id: input.id,
          images: diyJson(await claimImages(tx, input.images)),
          data: diyJson(data),
        },
      }),
    );
  });
}
export async function saveDiyImport(id: string, input: z.infer<typeof diySaveSchema>) {
  return withProductTransaction(async (tx) => {
    const current = await lockDiyDraft(tx, id, input.version);
    const previous = serializeDiyImport(current);
    if (input.data.targetProductId !== previous.data.targetProductId)
      throw new ApiError(400, 'INVALID_INPUT');
    const images = await claimImages(tx, input.images, previous.images);
    return serializeDiyImport(
      await tx.diyImageImport.update({
        where: { id },
        data: {
          images: diyJson(images),
          data: diyJson(input.data),
          status: 'DRAFT',
          runToken: null,
          leaseUntil: null,
          errorCode: null,
        },
      }),
    );
  });
}
export async function deleteDiyImport(id: string, version: number) {
  return withProductTransaction(async (tx) => {
    await lockDiyDraft(tx, id, version);
    await tx.diyImageImport.delete({ where: { id } });
  });
}

export async function recognizeDiyImport(id: string, input: z.infer<typeof diyRecognizeSchema>) {
  const config = imageRecognitionConfig(input.provider);
  const token = randomUUID();
  const current = await withProductTransaction(async (tx) => {
    const row = await lockDiyDraft(tx, id, input.version);
    const job = serializeDiyImport(row);
    const part = input.partId ? job.data.parts.find((part) => part.id === input.partId) : undefined;
    if (input.partId && (!part || part.reviewed || part.excluded || !part.views.length))
      throw new ApiError(400, 'DIY_PART_NOT_EDITABLE');
    await tx.diyImageImport.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        runToken: token,
        leaseUntil: new Date(Date.now() + 4 * 60_000),
        provider: input.provider,
        model: config.model,
        promptVersion: DIY_PROMPT_VERSION,
        errorCode: null,
      },
    });
    return job;
  });
  try {
    const images = await Promise.all(
      current.images.map(async (image) => ({
        id: image.id,
        ...(await readImportSource(image.objectKey)),
      })),
    );
    const target = current.data.parts.find((part) => part.id === input.partId);
    const result = await detectDiyParts(input.provider, images, current.data.hint, target);
    const matched = await matchDiyParts(input.provider, result.parts, images);
    const parts = mergeDiyRecognition(
      current.data.parts,
      matched.parts.map((part) =>
        diyPartSchema.parse(
          Object.fromEntries(
            Object.keys(diyPartSchema.shape).map((key) => [key, part[key as keyof typeof part]]),
          ),
        ),
      ),
      input.partId,
    );
    if (parts.length > 50) throw new ApiError(502, 'DIY_TOO_MANY_PARTS');
    const warnings = [...result.warnings, ...matched.warnings].slice(0, 20);
    const updated = await db.diyImageImport.updateMany({
      where: { id, runToken: token, status: 'PROCESSING' },
      data: {
        data: diyJson({ ...current.data, parts }),
        warnings: diyJson(warnings),
        status: 'DRAFT',
        version: { increment: 1 },
        runToken: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) throw new ApiError(409, 'DIY_CONFLICT');
    return await getDiyImport(id);
  } catch (error) {
    await db.diyImageImport.updateMany({
      where: { id, runToken: token },
      data: {
        status: 'DRAFT',
        version: { increment: 1 },
        runToken: null,
        leaseUntil: null,
        errorCode: error instanceof ApiError ? error.code : 'IMPORT_MODEL_UNAVAILABLE',
      },
    });
    throw error;
  }
}
