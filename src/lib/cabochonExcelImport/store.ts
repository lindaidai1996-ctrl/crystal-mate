import { Prisma, type CabochonExcelImport } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { reserveProductCodeInTransaction, withProductTransaction } from '@/lib/product-code-store';
import { saveProduct } from '@/lib/products';
import { productSchema } from '@/lib/validation';
import {
  excelRowSchema,
  type ExcelImport,
  type ExcelRow,
  type ExcelRowInput,
  type createExcelImportSchema,
  type updateExcelRowSchema,
} from './contracts';
import { normalizeExcelCostNotes, normalizeExcelRow } from './normalize';
import { applyStyleReview, sourceStyle } from './styleReview';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const rowsSchema = z.array(excelRowSchema);
export function serializeExcelImport(row: CabochonExcelImport): ExcelImport {
  return { ...row, rows: rowsSchema.parse(row.rows), updatedAt: row.updatedAt.toISOString() };
}
export async function getExcelImport(id: string) {
  const row = await db.cabochonExcelImport.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return serializeExcelImport(row);
}
export async function listExcelImports(fileHash?: string, sheetName?: string) {
  const jobs = await db.cabochonExcelImport.findMany({
    where: { ...(fileHash ? { fileHash } : {}), ...(sheetName ? { sheetName } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  return jobs.map((job) => {
    const rows = rowsSchema.parse(job.rows);
    return {
      id: job.id,
      fileName: job.fileName,
      sheetName: job.sheetName,
      updatedAt: job.updatedAt.toISOString(),
      total: rows.length,
      committed: rows.filter((row) => row.receipt).length,
    };
  });
}

async function claimImages(
  tx: Prisma.TransactionClient,
  rows: ExcelRowInput[],
  previous: ExcelRow[] = [],
) {
  const held = new Map(
    previous.flatMap((row) => row.images.map((image) => [image.objectKey, image.url] as const)),
  );
  const keys = [...new Set(rows.flatMap((row) => row.imageKeys))].filter((key) => !held.has(key));
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
    if (claimed.count !== keys.length) throw new ApiError(409, 'EXCEL_CONFLICT');
  }
  for (const grant of grants) held.set(grant.objectKey, grant.url);
  return rows.map((row) => ({
    ...row,
    values: normalizeExcelCostNotes(row.values),
    sourceStyle: sourceStyle(row),
    images: row.imageKeys.map((objectKey) => ({ objectKey, url: held.get(objectKey)! })),
    receipt: null,
  }));
}

export async function createExcelImport(input: z.infer<typeof createExcelImportSchema>) {
  return withProductTransaction(async (tx) => {
    const existing = await tx.cabochonExcelImport.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.fileHash !== input.fileHash || existing.sheetName !== input.sheetName)
        throw new ApiError(409, 'EXCEL_CONFLICT');
      return serializeExcelImport(existing);
    }
    const rows = await claimImages(tx, input.rows);
    return serializeExcelImport(
      await tx.cabochonExcelImport.create({
        data: {
          id: input.id,
          fileHash: input.fileHash,
          fileName: input.fileName,
          sheetName: input.sheetName,
          rows: json(rows),
        },
      }),
    );
  });
}

export async function updateExcelRow(id: string, input: z.infer<typeof updateExcelRowSchema>) {
  return withProductTransaction(async (tx) => {
    const current = await tx.cabochonExcelImport.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    if (current.version !== input.version) throw new ApiError(409, 'EXCEL_CONFLICT');
    let rows = rowsSchema.parse(current.rows);
    const index = rows.findIndex((row) => row.rowNumber === input.row.rowNumber);
    if (index < 0) throw new ApiError(404, 'NOT_FOUND');
    if (rows[index].receipt) throw new ApiError(409, 'EXCEL_ALREADY_COMMITTED');
    const original = rows[index];
    // Original cells remain an immutable audit record. Review edits only change mapped values.
    const [updated] = await claimImages(
      tx,
      [{ ...input.row, original: original.original, sourceStyle: sourceStyle(original) }],
      [original],
    );
    rows = applyStyleReview(rows, updated, input.applySameStyle ?? false);
    rows[index] = updated;
    const changed = await tx.cabochonExcelImport.updateMany({
      where: { id, version: input.version },
      data: { rows: json(rows), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError(409, 'EXCEL_CONFLICT');
    return serializeExcelImport(await tx.cabochonExcelImport.findUniqueOrThrow({ where: { id } }));
  });
}

export async function commitExcelRow(id: string, rowNumber: number, version: number) {
  return withProductTransaction(async (tx) => {
    const current = await tx.cabochonExcelImport.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    const rows = rowsSchema.parse(current.rows);
    const row = rows.find((row) => row.rowNumber === rowNumber);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    // Receipt check precedes version check: retry after a lost response returns the same product.
    if (row.receipt) return serializeExcelImport(current);
    if (current.version !== version) throw new ApiError(409, 'EXCEL_CONFLICT');
    const [category, tags, styles] = await Promise.all([
      tx.category.findUnique({ where: { name: '蛋面' } }),
      tx.tag.findMany({ select: { id: true, name: true } }),
      tx.settingStyle.findMany({ select: { id: true, magicBoxStyle: true } }),
    ]);
    if (!category) throw new ApiError(400, 'CATEGORY_NOT_FOUND');
    const parsed = normalizeExcelRow(row, tags, styles);
    if (parsed.errors.length) throw new ApiError(400, 'EXCEL_ROW_INVALID');
    const locked = await tx.cabochonExcelImport.updateMany({
      where: { id, version },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1) throw new ApiError(409, 'EXCEL_CONFLICT');
    let settingStyleId = parsed.settingStyleId;
    if (!settingStyleId && parsed.magicBoxStyle) {
      const style = await tx.settingStyle.upsert({
        where: { magicBoxStyle: parsed.magicBoxStyle },
        create: { magicBoxStyle: parsed.magicBoxStyle },
        update: { magicBoxStyle: parsed.magicBoxStyle },
        select: { id: true },
      });
      settingStyleId = style.id;
    }
    const reservation = await reserveProductCodeInTransaction(tx, category.id);
    const product = await saveProduct(
      productSchema.parse({
        code: reservation.code,
        codeReservationToken: reservation.reservationToken,
        categoryId: category.id,
        name: parsed.name,
        aliases: [],
        description: parsed.notes,
        priceCents: Math.round(Number(parsed.price) * 100),
        saleRule: 'CUSTOM_AMOUNT',
        saleRuleValue: null,
        saleManual: true,
        currency: 'CNY',
        stock: parsed.stock,
        published: false,
        imageKeys: row.imageKeys,
        tagIds: parsed.tagIds,
        cost: parsed.cost,
        measurement: parsed.measurement,
        marketing: parsed.marketing,
        extraInfo: { settingStyleId },
      }),
      undefined,
      {
        tx,
        heldImages: new Map(row.images.map((image) => [image.objectKey, image.url])),
        historicalStock: {
          quantity: parsed.stock,
          reason: `Excel 历史库存导入：${current.fileName} / ${current.sheetName} / 第 ${row.rowNumber} 行`,
        },
      },
    );
    row.receipt = {
      productId: product.id,
      code: product.code,
      committedAt: new Date().toISOString(),
      settingStyle: settingStyleId
        ? {
            id: settingStyleId,
            name: parsed.magicBoxStyle,
            created: !styles.some((style) => style.id === settingStyleId),
          }
        : null,
    };
    return serializeExcelImport(
      await tx.cabochonExcelImport.update({ where: { id }, data: { rows: json(rows) } }),
    );
  }, true);
}
