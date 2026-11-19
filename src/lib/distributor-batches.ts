import { attachmentListInclude } from '@/lib/shared-attachment-query';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { getDistributorItemCounts } from '@/lib/distributor-purchases';
import type { DistributorBatchPage, DistributorBatchEntriesPage } from '@/lib/client-types';

export const distributorBatchPagination = z.object({
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export const distributorBatchQuery = distributorBatchPagination
  .extend({
    q: z.string().trim().max(200).default(''),
    receivedFrom: z.iso.date().optional(),
    receivedTo: z.iso.date().optional(),
  })
  .refine(
    (value) => !value.receivedFrom || !value.receivedTo || value.receivedFrom <= value.receivedTo,
  );

// Keep the purchase amount calculation identical to the existing distributor purchase view.
function purchases(distributorId?: string) {
  return Prisma.sql`
    SELECT e.id, e."distributorId", e."batchId", 'PRODUCT'::text AS type,
      p.id AS "itemId", p.name, p.code, 'PIECE'::text AS unit,
      e.quantity::numeric AS quantity, e."unitCost" AS "unitPrice",
      e.quantity::numeric * e."unitCost" AS amount
    FROM "ProductPurchaseEntry" e JOIN "Product" p ON p.id = e."productId"
    WHERE ${distributorId ? Prisma.sql`e."distributorId" = ${distributorId}` : Prisma.sql`true`}
    UNION ALL
    SELECT e.id, e."distributorId", e."batchId", 'MATERIAL',
      m.id, m.name, NULL::text, m.unit::text, e."receivedQty", e."purchaseUnitPrice",
      COALESCE(e."purchaseTotalAmount", e."receivedQty" * e."purchaseUnitPrice")
    FROM "MaterialBatchEntry" e JOIN "Material" m ON m.id = e."materialId"
    WHERE ${distributorId ? Prisma.sql`e."distributorId" = ${distributorId}` : Prisma.sql`true`}
  `;
}

export async function getDistributorBatchStats(distributorId?: string) {
  const rows = await db.$queryRaw<
    { distributorId: string; batchCount: number; latestReceivedAt: Date }[]
  >(Prisma.sql`
    WITH purchases AS (${purchases(distributorId)})
    SELECT p."distributorId", COUNT(DISTINCT p."batchId")::int AS "batchCount",
      MAX(b."receivedAt") AS "latestReceivedAt"
    FROM purchases p JOIN "MaterialBatch" b ON b.id = p."batchId"
    GROUP BY p."distributorId"
  `);
  return new Map(
    rows.map((row) => [
      row.distributorId,
      {
        batchCount: row.batchCount,
        latestReceivedAt: row.latestReceivedAt.toISOString(),
      },
    ]),
  );
}

export async function getDistributorStats(id: string) {
  const [items, batches] = await Promise.all([
    getDistributorItemCounts(id),
    getDistributorBatchStats(id),
  ]);
  return {
    itemCounts: items.get(id) ?? { total: 0, products: 0, materials: 0 },
    ...(batches.get(id) ?? { batchCount: 0, latestReceivedAt: null }),
  };
}

async function requireDistributor(id: string) {
  if (!(await db.distributor.findUnique({ where: { id }, select: { id: true } })))
    throw new ApiError(404, 'NOT_FOUND');
}

export async function getDistributorBatches(
  id: string,
  options: z.infer<typeof distributorBatchQuery>,
): Promise<DistributorBatchPage> {
  await requireDistributor(id);
  type Row = {
    id: string | null;
    name: string;
    receivedAt: Date;
    products: number;
    materials: number;
    totalAmount: Prisma.Decimal | null;
    hasUnknownAmount: boolean;
    total: bigint;
  };
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH purchases AS (${purchases(id)}), grouped AS (
      SELECT b.id, b.name, b."receivedAt",
        (COUNT(DISTINCT p."itemId") FILTER (WHERE p.type = 'PRODUCT'))::int AS products,
        (COUNT(DISTINCT p."itemId") FILTER (WHERE p.type = 'MATERIAL'))::int AS materials,
        SUM(p.amount) AS "totalAmount", bool_or(p.amount IS NULL) AS "hasUnknownAmount"
      FROM purchases p JOIN "MaterialBatch" b ON b.id = p."batchId"
      WHERE strpos(lower(b.name), lower(${options.q})) > 0
        ${options.receivedFrom ? Prisma.sql`AND b."receivedAt" >= ${options.receivedFrom}::date` : Prisma.empty}
        ${options.receivedTo ? Prisma.sql`AND b."receivedAt" <= ${options.receivedTo}::date` : Prisma.empty}
      GROUP BY b.id
    )
    SELECT paged.*, counted.total FROM (SELECT COUNT(*) AS total FROM grouped) counted
    LEFT JOIN (
      SELECT * FROM grouped ORDER BY "receivedAt" DESC, id COLLATE "C" DESC
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    ) paged ON true
    ORDER BY "receivedAt" DESC, id COLLATE "C" DESC
  `);
  const ids = rows.flatMap((row) => (row.id ? [row.id] : []));
  const batches = ids.length
    ? await db.materialBatch.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          coverObjectKey: true,
          attachments: attachmentListInclude,
        },
      })
    : [];
  const covers = new Map(batches.map((batch) => [batch.id, batch]));
  return {
    items: rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id!,
        name: row.name,
        receivedAt: row.receivedAt.toISOString(),
        itemCounts: {
          products: row.products,
          materials: row.materials,
          total: row.products + row.materials,
        },
        totalAmount: row.totalAmount?.toFixed(2) ?? null,
        hasUnknownAmount: row.hasUnknownAmount,
        coverObjectKey: covers.get(row.id!)?.coverObjectKey ?? null,
        attachments: covers.get(row.id!)?.attachments ?? [],
      })),
    total: Number(rows[0]?.total ?? 0),
    page: options.page,
    pageSize: options.pageSize,
  };
}

export async function getDistributorBatchEntries(
  id: string,
  batchId: string,
  options: z.infer<typeof distributorBatchPagination>,
): Promise<DistributorBatchEntriesPage> {
  await requireDistributor(id);
  type Row = {
    id: string | null;
    type: 'PRODUCT' | 'MATERIAL';
    itemId: string;
    name: string;
    code: string | null;
    unit: string;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
    total: bigint;
  };
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    WITH purchases AS (${purchases(id)}), selected AS (
      SELECT * FROM purchases WHERE "batchId" = ${batchId}
    )
    SELECT paged.*, counted.total FROM (SELECT COUNT(*) AS total FROM selected) counted
    LEFT JOIN (
      SELECT * FROM selected ORDER BY type COLLATE "C", id COLLATE "C"
      LIMIT ${options.pageSize} OFFSET ${(options.page - 1) * options.pageSize}
    ) paged ON true
    ORDER BY type COLLATE "C", id COLLATE "C"
  `);
  const total = Number(rows[0]?.total ?? 0);
  if (!total) throw new ApiError(404, 'NOT_FOUND');
  return {
    items: rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id!,
        type: row.type,
        itemId: row.itemId,
        name: row.name,
        code: row.code,
        unit: row.unit,
        quantity: row.quantity?.toNumber() ?? null,
        unitPrice: row.unitPrice?.toFixed(2) ?? null,
        amount: row.amount?.toFixed(2) ?? null,
      })),
    total,
    page: options.page,
    pageSize: options.pageSize,
  };
}
