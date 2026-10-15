import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import type { DistributorPurchaseEntry, DistributorPurchaseSummary } from '@/lib/client-types';

export const distributorIdSchema = z.string().cuid();
const paginationFields = {
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};
export const distributorPurchaseQuerySchema = z.object({
  type: z.enum(['all', 'product', 'material']).default('all'),
  q: z.string().trim().max(200).default(''),
  ...paginationFields,
});
export const distributorEntryQuerySchema = z.object({
  type: z.enum(['product', 'material']),
  itemId: z.string().cuid(),
  ...paginationFields,
});

async function requireDistributor(id: string) {
  const item = await db.distributor.findUnique({ where: { id }, select: { id: true } });
  if (!item) throw new ApiError(404, 'NOT_FOUND');
}

type SummaryRow = Omit<
  DistributorPurchaseSummary,
  'latestReceivedAt' | 'totalAmount' | 'totalWeightGrams'
> & {
  latestReceivedAt: Date;
  totalAmount: Prisma.Decimal | null;
  totalWeightGrams: Prisma.Decimal | null;
  total: bigint;
};

export async function getDistributorPurchaseSummary(
  distributorId: string,
  options: z.infer<typeof distributorPurchaseQuerySchema>,
) {
  await requireDistributor(distributorId);
  // Both sources must be grouped and ordered together before LIMIT/OFFSET.
  // The left join retains the count even for an empty or out-of-range page.
  const rows = await db.$queryRaw<
    (Omit<SummaryRow, 'itemId'> & { itemId: string | null })[]
  >(Prisma.sql`
    WITH purchases AS (
      SELECT 'PRODUCT'::text AS type, p.id AS "itemId", p.name, p.code,
        'PIECE'::text AS unit, e."batchId", b."receivedAt",
        e.quantity::numeric AS quantity, e.quantity::numeric * e."unitCost" AS amount,
        NULL::numeric AS weight
      FROM "ProductPurchaseEntry" e
      JOIN "Product" p ON p.id = e."productId"
      JOIN "MaterialBatch" b ON b.id = e."batchId"
      WHERE e."distributorId" = ${distributorId}
        AND ${options.type} IN ('all', 'product')
        AND (strpos(lower(p.name), lower(${options.q})) > 0
          OR strpos(lower(p.code), lower(${options.q})) > 0)
      UNION ALL
      SELECT 'MATERIAL', m.id, m.name, NULL::text, m.unit::text,
        e."batchId", b."receivedAt", e."receivedQty"::numeric,
        COALESCE(e."purchaseTotalAmount", e."receivedQty"::numeric * e."purchaseUnitPrice"),
        COALESCE(e."purchaseTotalWeightGrams", e."receivedQty"::numeric * e."weightGrams")
      FROM "MaterialBatchEntry" e
      JOIN "Material" m ON m.id = e."materialId"
      JOIN "MaterialBatch" b ON b.id = e."batchId"
      WHERE e."distributorId" = ${distributorId}
        AND ${options.type} IN ('all', 'material')
        AND strpos(lower(m.name), lower(${options.q})) > 0
    ), grouped AS (
      SELECT type, "itemId", name, code, unit,
        COUNT(DISTINCT "batchId")::int AS "batchCount",
        MAX("receivedAt") AS "latestReceivedAt",
        SUM(quantity)::double precision AS "knownQuantity",
        bool_or(quantity IS NULL) AS "hasUnknownQuantity",
        SUM(amount) AS "totalAmount", bool_or(amount IS NULL) AS "hasUnknownAmount",
        SUM(weight) AS "totalWeightGrams", bool_or(type = 'MATERIAL' AND weight IS NULL) AS "hasUnknownWeight"
      FROM purchases GROUP BY type, "itemId", name, code, unit
    )
    SELECT paged.*, counted.total
    FROM (SELECT COUNT(*) AS total FROM grouped) counted
    LEFT JOIN (
      SELECT * FROM grouped
      ORDER BY "latestReceivedAt" DESC, type COLLATE "C", "itemId" COLLATE "C"
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    ) paged ON true
    ORDER BY "latestReceivedAt" DESC, type COLLATE "C", "itemId" COLLATE "C"
  `);
  return {
    items: rows
      .filter((row) => row.itemId !== null)
      .map((row) => ({
        type: row.type,
        itemId: row.itemId!,
        name: row.name,
        code: row.code,
        unit: row.unit,
        batchCount: row.batchCount,
        knownQuantity: row.knownQuantity,
        hasUnknownQuantity: row.hasUnknownQuantity,
        hasUnknownAmount: row.hasUnknownAmount,
        hasUnknownWeight: row.hasUnknownWeight,
        latestReceivedAt: row.latestReceivedAt.toISOString(),
        totalAmount: row.totalAmount?.toFixed(2) ?? null,
        totalWeightGrams: row.totalWeightGrams?.toFixed(2) ?? null,
      })),
    total: Number(rows[0].total),
    page: options.page,
    pageSize: options.pageSize,
  };
}

export async function getDistributorPurchaseEntries(
  distributorId: string,
  options: z.infer<typeof distributorEntryQuerySchema>,
) {
  await requireDistributor(distributorId);
  const paging = { skip: (options.page - 1) * options.pageSize, take: options.pageSize };
  const batch = { select: { id: true, name: true, receivedAt: true } };
  const orderBy = [{ batch: { receivedAt: 'desc' as const } }, { id: 'asc' as const }];
  let items: DistributorPurchaseEntry[];
  let total: number;
  if (options.type === 'product') {
    const where = { distributorId, productId: options.itemId };
    const [entries, count] = await db.$transaction([
      db.productPurchaseEntry.findMany({ where, include: { batch }, orderBy, ...paging }),
      db.productPurchaseEntry.count({ where }),
    ]);
    total = count;
    items = entries.map((entry) => ({
      id: entry.id,
      type: 'PRODUCT',
      batchId: entry.batch.id,
      batchName: entry.batch.name,
      receivedAt: entry.batch.receivedAt.toISOString(),
      quantity: entry.quantity,
      unit: 'PIECE',
      unitPrice: entry.unitCost.toFixed(2),
      amount: entry.unitCost.mul(entry.quantity).toFixed(2),
      weightGrams: null,
      gramPrice: null,
      priceSource: null,
    }));
  } else {
    const where = { distributorId, materialId: options.itemId };
    const [entries, count] = await db.$transaction([
      db.materialBatchEntry.findMany({
        where,
        include: { batch, material: { select: { unit: true } } },
        orderBy,
        ...paging,
      }),
      db.materialBatchEntry.count({ where }),
    ]);
    total = count;
    items = entries.map((entry) => ({
      id: entry.id,
      type: 'MATERIAL',
      batchId: entry.batch.id,
      batchName: entry.batch.name,
      receivedAt: entry.batch.receivedAt.toISOString(),
      quantity: entry.receivedQty,
      unit: entry.material.unit,
      unitPrice: entry.purchaseUnitPrice?.toFixed(2) ?? null,
      amount:
        (
          entry.purchaseTotalAmount ??
          (entry.receivedQty === null ? null : entry.purchaseUnitPrice?.mul(entry.receivedQty))
        )?.toFixed(2) ?? null,
      weightGrams:
        (
          entry.purchaseTotalWeightGrams ??
          (entry.receivedQty === null ? null : entry.weightGrams?.mul(entry.receivedQty))
        )?.toFixed(2) ?? null,
      gramPrice: entry.purchaseGramPrice?.toFixed(2) ?? null,
      priceSource: entry.unitPriceSource,
    }));
  }
  return { items, total, page: options.page, pageSize: options.pageSize };
}
