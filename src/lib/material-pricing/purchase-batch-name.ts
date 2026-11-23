import type { Prisma } from '@prisma/client';
import { availablePricingBatchName } from './batch-names';

export async function reservePricingBatchName(
  tx: Prisma.TransactionClient,
  base: string,
  currentId?: string,
) {
  // Use the same transaction lock for imports, manual purchases and historical renaming.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pricing-purchase-batch-names'))`;
  const occupied = await tx.materialBatch.findMany({
    where: { name: { startsWith: base }, ...(currentId ? { id: { not: currentId } } : {}) },
    select: { name: true },
  });
  return availablePricingBatchName(
    base,
    occupied.map((batch) => batch.name),
  );
}
