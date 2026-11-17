import type { Prisma } from '@prisma/client';
import type { ProductSourceInput } from '@/lib/client-types';
import { auditContext } from '@/lib/audit-context';

export const RECENT_LIMIT = 30;
type DiyInput = Extract<ProductSourceInput, { origin: 'DIY' }>;

export async function saveRecentUsage(
  tx: Prisma.TransactionClient,
  ownerId: string,
  input: DiyInput,
) {
  // Serialize saves by this account before upserting and pruning its bounded history.
  await tx.$queryRaw`SELECT "id" FROM "Admin" WHERE "id" = ${ownerId} FOR UPDATE`;
  const usedAt = new Date();
  for (const entryId of new Set(input.materials.map((line) => line.materialBatchEntryId))) {
    await tx.diyRecentMaterial.upsert({
      where: { ownerId_entryId: { ownerId, entryId } },
      create: { ownerId, entryId, usedAt },
      update: { usedAt },
    });
  }
  for (const productId of new Set(input.cabochons.map((line) => line.productId))) {
    await tx.diyRecentCabochon.upsert({
      where: { ownerId_productId: { ownerId, productId } },
      create: { ownerId, productId, usedAt },
      update: { usedAt },
    });
  }
  const materialOverflow = await tx.diyRecentMaterial.findMany({
    where: { ownerId },
    orderBy: [{ usedAt: 'desc' }, { entryId: 'asc' }],
    skip: RECENT_LIMIT,
    select: { entryId: true },
  });
  if (materialOverflow.length)
    await tx.diyRecentMaterial.deleteMany({
      where: { ownerId, entryId: { in: materialOverflow.map((row) => row.entryId) } },
    });
  const cabochonOverflow = await tx.diyRecentCabochon.findMany({
    where: { ownerId },
    orderBy: [{ usedAt: 'desc' }, { productId: 'asc' }],
    skip: RECENT_LIMIT,
    select: { productId: true },
  });
  if (cabochonOverflow.length)
    await tx.diyRecentCabochon.deleteMany({
      where: { ownerId, productId: { in: cabochonOverflow.map((row) => row.productId) } },
    });
}

export async function recordSavedDiyUsage(tx: Prisma.TransactionClient, input: DiyInput) {
  // Only requireAdmin's authenticated server context can supply the account.
  // Background imports without an interactive account have no personal history.
  const ownerId = auditContext.getStore()?.actor?.id;
  if (ownerId) await saveRecentUsage(tx, ownerId, input);
}
