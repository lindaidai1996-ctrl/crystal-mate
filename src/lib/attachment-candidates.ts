import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from './api';
import { db } from './db';
import type { AttachmentCandidate, AttachmentOwner, AttachmentSource } from './attachments';

export const attachmentCandidateQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  type: z.enum(['all', 'material', 'product']).default('all'),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const attachmentOwnerIdSchema = z.string().cuid();

type CandidateRow = Omit<AttachmentCandidate, 'source' | 'fileName'> & {
  sourceKind: AttachmentSource['kind'];
  sourceId: string;
};

// Distributors use the material cover. A batch uses its own photo first.
function candidateSql(owner: AttachmentOwner) {
  const scopedMaterials =
    owner.type === 'batch'
      ? Prisma.sql`
          SELECT "materialId", id AS "batchEntryId" FROM "MaterialBatchEntry"
          WHERE "batchId" = ${owner.id}
        `
      : Prisma.sql`
          SELECT DISTINCT "materialId", NULL::text AS "batchEntryId" FROM "MaterialBatchEntry"
          WHERE "distributorId" = ${owner.id}
        `;
  const productScope =
    owner.type === 'batch'
      ? Prisma.sql`e."batchId" = ${owner.id}`
      : Prisma.sql`e."distributorId" = ${owner.id}`;
  return Prisma.sql`
    WITH scoped_materials AS (
      ${scopedMaterials}
    ), candidates AS (
      SELECT m.id AS "itemId", 'MATERIAL'::text AS type, m.name, NULL::text AS code,
        m.aliases,
        COALESCE(bi."objectKey", mi."objectKey", fi."objectKey") AS "objectKey",
        COALESCE(bi.url, mi.url, fi.url) AS url,
        CASE WHEN bi.id IS NOT NULL THEN 'MATERIAL_BATCH_IMAGE'
          WHEN mi.id IS NOT NULL THEN 'MATERIAL_IMAGE' ELSE 'MATERIAL_BATCH_IMAGE' END
          AS "sourceKind",
        COALESCE(bi.id, mi.id, fi.id) AS "sourceId"
      FROM scoped_materials e
      JOIN "Material" m ON m.id = e."materialId"
      LEFT JOIN LATERAL (
        SELECT id, "objectKey", url FROM "MaterialImage"
        WHERE "materialId" = m.id ORDER BY position ASC LIMIT 1
      ) mi ON true
      LEFT JOIN LATERAL (
        SELECT id, "objectKey", url FROM "MaterialBatchImage"
        WHERE "entryId" = e."batchEntryId"
        ORDER BY position ASC LIMIT 1
      ) bi ON true
      LEFT JOIN LATERAL (
        SELECT image.id, image."objectKey", image.url FROM "MaterialBatchImage" image
        JOIN "MaterialBatchEntry" entry ON entry.id = image."entryId"
        JOIN "MaterialBatch" batch ON batch.id = entry."batchId"
        WHERE entry."materialId" = m.id AND bi.id IS NULL AND mi.id IS NULL
        ORDER BY batch."receivedAt" DESC, entry."createdAt" DESC, entry.id DESC, image.position ASC
        LIMIT 1
      ) fi ON true
      WHERE bi.id IS NOT NULL OR mi.id IS NOT NULL OR fi.id IS NOT NULL
      UNION ALL
      SELECT p.id, 'PRODUCT', p.name, p.code, p.aliases,
        pi."objectKey", pi.url, 'PRODUCT_IMAGE', pi.id
      FROM "Product" p
      JOIN LATERAL (
        SELECT id, "objectKey", url FROM "ProductImage"
        WHERE "productId" = p.id ORDER BY position ASC LIMIT 1
      ) pi ON true
      WHERE EXISTS (SELECT 1 FROM "ProductPurchaseEntry" e
        WHERE e."productId" = p.id AND ${productScope})
    )
  `;
}

function serializeCandidate(row: CandidateRow): AttachmentCandidate {
  const extension = row.objectKey.split('.').pop() ?? 'jpg';
  return {
    itemId: row.itemId,
    type: row.type,
    name: row.name,
    code: row.code,
    objectKey: row.objectKey,
    url: row.url,
    fileName: `${row.name.slice(0, 240)}.${extension}`,
    source: { kind: row.sourceKind, id: row.sourceId },
  };
}

export async function getAttachmentCandidates(
  owner: AttachmentOwner,
  query: z.infer<typeof attachmentCandidateQuerySchema>,
) {
  const exists =
    owner.type === 'batch'
      ? await db.materialBatch.findUnique({ where: { id: owner.id }, select: { id: true } })
      : await db.distributor.findUnique({ where: { id: owner.id }, select: { id: true } });
  if (!exists) throw new ApiError(404, 'NOT_FOUND');
  const rows = await db.$queryRaw<(CandidateRow & { total: bigint })[]>(Prisma.sql`
    ${candidateSql(owner)}, filtered AS (
      SELECT * FROM candidates
      WHERE (${query.type} = 'all' OR lower(type) = ${query.type})
        AND (strpos(lower(name), lower(${query.q})) > 0
          OR strpos(lower(COALESCE(code, '')), lower(${query.q})) > 0
          OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias
            WHERE strpos(lower(alias), lower(${query.q})) > 0))
    )
    SELECT paged.*, counted.total
    FROM (SELECT COUNT(*) AS total FROM filtered) counted
    LEFT JOIN (
      SELECT * FROM filtered ORDER BY type COLLATE "C", "itemId" COLLATE "C"
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    ) paged ON true
    ORDER BY type COLLATE "C", "itemId" COLLATE "C"
  `);
  return {
    items: rows.filter((row) => row.itemId !== null).map(serializeCandidate),
    total: Number(rows[0]?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function resolveAttachmentSources(
  tx: Prisma.TransactionClient,
  owner: AttachmentOwner,
  inputs: { objectKey: string; source?: AttachmentSource }[],
) {
  if (!inputs.length) return new Map<string, AttachmentCandidate>();
  const rows = await tx.$queryRaw<CandidateRow[]>(Prisma.sql`
    ${candidateSql(owner)}
    SELECT * FROM candidates WHERE "sourceId" IN (${Prisma.join(inputs.map((item) => item.source!.id))})
  `);
  const candidates = new Map(rows.map((row) => [row.sourceId, serializeCandidate(row)]));
  const result = new Map<string, AttachmentCandidate>();
  for (const input of inputs) {
    const candidate = candidates.get(input.source!.id);
    if (
      !candidate ||
      candidate.source.kind !== input.source!.kind ||
      candidate.objectKey !== input.objectKey
    )
      throw new ApiError(400, 'INVALID_IMAGE');
    result.set(input.objectKey, candidate);
  }
  return result;
}
