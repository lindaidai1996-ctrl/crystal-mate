import type { Prisma } from '@prisma/client';
import { db } from './db';
import type { AttachmentOwner } from './attachments';
import type { AttachmentTarget, ReceiptEvidence } from './shared-attachment-contracts';

const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
const phone = (text: string) =>
  text
    .replace(/\D/g, '')
    .replace(/^0086/, '')
    .replace(/^86(?=1\d{10}$)/, '');
export function sellerMatches(
  evidence: ReceiptEvidence,
  distributor: { name: string; phone: string; address: string },
) {
  const name = normalize(evidence.seller.name ?? '');
  const actual = normalize(distributor.name);
  const extractedPhone = phone(evidence.seller.phone ?? '');
  const actualPhone = phone(distributor.phone);
  const phoneMatch = extractedPhone.length >= 7 && extractedPhone === actualPhone;
  const exactName = name.length >= 2 && name === actual;
  const partialName =
    name.length >= 3 && actual.length >= 3 && (actual.includes(name) || name.includes(actual));
  const conflictingPhone =
    extractedPhone.length >= 7 && actualPhone.length >= 7 && extractedPhone !== actualPhone;
  if (!phoneMatch && !exactName && !partialName) return null;
  return {
    score: phoneMatch ? 3 : exactName ? 2 : 1,
    reason: conflictingPhone
      ? 'namePhoneConflict'
      : phoneMatch
        ? 'sellerPhone'
        : exactName
          ? 'sellerName'
          : 'sellerNamePartial',
  };
}
export async function searchAttachmentTargets(
  type: 'batch' | 'distributor',
  owner: AttachmentOwner | undefined,
  q = '',
  page = 1,
) {
  const scope =
    owner?.type === 'batch' && type === 'distributor'
      ? {
          OR: [
            { materialBatchEntries: { some: { batchId: owner.id } } },
            { productPurchaseEntries: { some: { batchId: owner.id } } },
          ],
        }
      : undefined;
  const batchScope =
    owner?.type === 'distributor' && type === 'batch'
      ? {
          OR: [
            { entries: { some: { distributorId: owner.id } } },
            { productEntries: { some: { distributorId: owner.id } } },
          ],
        }
      : undefined;
  const take = 20;
  const items: AttachmentTarget[] = [];
  let total = 0;
  // Two deterministic groups: existing purchase relationship first, then all others.
  if (type === 'distributor') {
    const search: Prisma.DistributorWhereInput = {
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }],
    };
    const relatedWhere: Prisma.DistributorWhereInput = { AND: [search, ...(scope ? [scope] : [])] };
    const relatedCount = scope ? await db.distributor.count({ where: relatedWhere }) : 0;
    total = await db.distributor.count({ where: search });
    const offset = (page - 1) * take;
    if (scope && offset < relatedCount) {
      const rows = await db.distributor.findMany({
        where: relatedWhere,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: offset,
        take,
      });
      items.push(...rows.map((a) => ({ type, id: a.id, name: a.name, related: true })));
    }
    if (items.length < take) {
      const rows = await db.distributor.findMany({
        where: { AND: [search, ...(scope ? [{ NOT: scope }] : [])] },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: Math.max(0, offset - relatedCount),
        take: take - items.length,
      });
      items.push(...rows.map((a) => ({ type, id: a.id, name: a.name, related: false })));
    }
  } else {
    const search: Prisma.MaterialBatchWhereInput = { name: { contains: q, mode: 'insensitive' } };
    const relatedWhere: Prisma.MaterialBatchWhereInput = {
      AND: [search, ...(batchScope ? [batchScope] : [])],
    };
    const relatedCount = batchScope ? await db.materialBatch.count({ where: relatedWhere }) : 0;
    total = await db.materialBatch.count({ where: search });
    const offset = (page - 1) * take;
    if (batchScope && offset < relatedCount) {
      const rows = await db.materialBatch.findMany({
        where: relatedWhere,
        orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
        skip: offset,
        take,
      });
      items.push(
        ...rows.map((a) => ({
          type,
          id: a.id,
          name: a.name,
          receivedAt: a.receivedAt.toISOString().slice(0, 10),
          related: true,
        })),
      );
    }
    if (items.length < take) {
      const rows = await db.materialBatch.findMany({
        where: { AND: [search, ...(batchScope ? [{ NOT: batchScope }] : [])] },
        orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
        skip: Math.max(0, offset - relatedCount),
        take: take - items.length,
      });
      items.push(
        ...rows.map((a) => ({
          type,
          id: a.id,
          name: a.name,
          receivedAt: a.receivedAt.toISOString().slice(0, 10),
          related: false,
        })),
      );
    }
  }
  return { items, total, page };
}
export async function suggestReceiptTargets(
  evidence: ReceiptEvidence,
  owner: AttachmentOwner,
): Promise<AttachmentTarget[]> {
  if (owner.type === 'batch') {
    // Bounded candidates; matching runs locally, never sends the directory to a model.
    const rows = await db.distributor.findMany({
      take: 5001,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        materialBatchEntries: { where: { batchId: owner.id }, take: 1, select: { id: true } },
        productPurchaseEntries: { where: { batchId: owner.id }, take: 1, select: { id: true } },
      },
    });
    if (rows.length > 5000) return [];
    return rows
      .flatMap((row) => {
        const match = sellerMatches(evidence, row);
        return match
          ? [
              {
                type: 'distributor' as const,
                id: row.id,
                name: row.name,
                related: !!(row.materialBatchEntries.length || row.productPurchaseEntries.length),
                ...match,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          b.score - a.score || Number(b.related) - Number(a.related) || a.id.localeCompare(b.id),
      )
      .slice(0, 20);
  }
  const rows = await db.materialBatch.findMany({
    where: {
      OR: [
        { entries: { some: { distributorId: owner.id } } },
        { productEntries: { some: { distributorId: owner.id } } },
      ],
    },
    orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
    take: 5001,
    select: { id: true, name: true, receivedAt: true },
  });
  if (rows.length > 5000) return [];
  const date = evidence.dates.length === 1 ? Date.parse(evidence.dates[0].value) : null;
  return rows
    .sort((a, b) =>
      date === null
        ? b.receivedAt.getTime() - a.receivedAt.getTime()
        : Math.abs(a.receivedAt.getTime() - date) - Math.abs(b.receivedAt.getTime() - date),
    )
    .slice(0, 20)
    .map((a) => ({
      type: 'batch',
      id: a.id,
      name: a.name,
      receivedAt: a.receivedAt.toISOString().slice(0, 10),
      related: true,
      reason: date === null ? 'purchaseRelation' : 'receiptDate',
    }));
}
