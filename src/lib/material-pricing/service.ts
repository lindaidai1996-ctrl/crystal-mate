import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { marketService } from '@/lib/metal-market-service';
import { shanghaiDate, type MetalHistory, type MetalQuote } from '@/lib/metal-market';
import { computePricing, recentStart, summarizePurchases } from './calculations';
import { signCostBasis } from './basis';
import {
  pricingGroupSchema,
  pricingGroupUpdateSchema,
  pricingPublishSchema,
  type PricingGroup,
  type PricingGroupInput,
  type PricingPreview,
  type PricingPublication,
  type PricingPurchase,
} from './contracts';

type Tx = Prisma.TransactionClient;
async function pricingTransaction<T>(operation: (tx: Tx) => Promise<T>) {
  try {
    return await db.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      throw new ApiError(409, 'PRICING_CHANGED');
    throw error;
  }
}

const groupInclude = {
  materials: { select: { id: true, name: true, unit: true }, orderBy: { id: 'asc' as const } },
  publications: { take: 1, orderBy: { version: 'desc' as const } },
};
type GroupRow = Prisma.MaterialPricingGroupGetPayload<{ include: typeof groupInclude }>;
export function serializePublication(
  row: Prisma.MaterialPricingPublicationGetPayload<object>,
): PricingPublication {
  return {
    id: row.id,
    version: row.version,
    saleGramPrice: row.saleGramPrice.toFixed(2),
    createdAt: row.createdAt.toISOString(),
    fingerprint: row.fingerprint,
    costBasis: row.costBasis as unknown as PricingPublication['costBasis'],
  };
}
function serializeGroup(row: GroupRow): PricingGroup {
  return {
    id: row.id,
    name: row.name,
    lossRate: row.lossRate.toFixed(2),
    marketLinked: row.marketLinked,
    marketCoefficient: row.marketCoefficient.toFixed(4),
    pricingRule: row.pricingRule as PricingGroupInput['pricingRule'],
    pricingValue: row.pricingValue?.toFixed(2) ?? null,
    enabled: row.enabled,
    version: row.version,
    materials: row.materials,
    publication: row.publications[0] ? serializePublication(row.publications[0]) : null,
  };
}
async function loadState(tx: Tx, id: string, now: Date) {
  const row = await tx.materialPricingGroup.findUnique({ where: { id }, include: groupInclude });
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  const group = serializeGroup(row);
  const purchases: PricingPurchase[] = [];
  let cursor: string | undefined;
  for (;;) {
    const entries = await tx.materialBatchEntry.findMany({
      where: { material: { pricingGroupId: id } },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        materialId: true,
        material: { select: { name: true } },
        batchId: true,
        batch: { select: { name: true, receivedAt: true } },
        distributorId: true,
        distributor: { select: { name: true } },
        purchaseTotalAmount: true,
        purchaseTotalWeightGrams: true,
      },
    });
    for (const entry of entries)
      purchases.push({
        id: entry.id,
        materialId: entry.materialId,
        materialName: entry.material.name,
        batchId: entry.batchId,
        batchName: entry.batch.name,
        distributorId: entry.distributorId,
        distributorName: entry.distributor.name,
        receivedAt: entry.batch.receivedAt.toISOString().slice(0, 10),
        amount: entry.purchaseTotalAmount?.toFixed(2) ?? null,
        weight: entry.purchaseTotalWeightGrams?.toFixed(2) ?? null,
      });
    if (entries.length < 500) break;
    cursor = entries.at(-1)!.id;
  }
  const input = { ...group, materialIds: group.materials.map((item) => item.id) };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        name: group.name,
        materialIds: input.materialIds,
        lossRate: group.lossRate,
        marketLinked: group.marketLinked,
        marketCoefficient: group.marketCoefficient,
        pricingRule: group.pricingRule,
        pricingValue: group.pricingValue,
        date: shanghaiDate(now),
        purchases,
      }),
    )
    .digest('hex');
  return { group, input, fingerprint, summary: summarizePurchases(purchases, group.lossRate, now) };
}
function readState(id: string, now: Date) {
  return db.$transaction((tx) => loadState(tx, id, now), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30000,
  });
}
async function previewState(
  state: Awaited<ReturnType<typeof readState>>,
  now: Date,
): Promise<PricingPreview> {
  let market: { quote: MetalQuote; points: MetalHistory['points'] } | null = null;
  if (state.group.marketLinked && state.summary.recent.count) {
    try {
      const lookback = new Date(`${recentStart(now)}T00:00:00Z`);
      lookback.setUTCDate(lookback.getUTCDate() - 30);
      const [quote, history] = await Promise.all([
        marketService.read('silver', 'quote', '', '') as Promise<MetalQuote>,
        marketService.read(
          'silver',
          'history',
          lookback.toISOString().slice(0, 10),
          shanghaiDate(now),
        ) as Promise<MetalHistory>,
      ]);
      market = { quote, points: history.points };
    } catch {
      /* Historical costs remain available when external data is unavailable. */
    }
  }
  return {
    ...state.summary,
    ...computePricing(state.input, state.summary, market, now),
    fingerprint: state.fingerprint,
    lossRate: state.group.lossRate,
    pricingRule: state.group.pricingRule,
    pricingValue: state.group.pricingValue,
    marketLinked: state.group.marketLinked,
    marketCoefficient: state.group.marketCoefficient,
    changed: !!state.group.publication && state.group.publication.fingerprint !== state.fingerprint,
  };
}
export async function listPricingGroups() {
  const [groups, materials] = await db.$transaction([
    db.materialPricingGroup.findMany({ include: groupInclude, orderBy: { createdAt: 'asc' } }),
    db.material.findMany({
      where: { unit: 'GRAM' },
      select: { id: true, name: true, pricingGroupId: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return { items: groups.map(serializeGroup), materials };
}
export async function getPricingPreview(id: string, now = new Date()) {
  const state = await readState(id, now);
  return { group: state.group, preview: await previewState(state, now) };
}
async function checkMaterials(tx: Tx, materialIds: string[], id?: string) {
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, unit: true, pricingGroupId: true },
  });
  if (materials.length !== materialIds.length || materials.some((row) => row.unit !== 'GRAM'))
    throw new ApiError(400, 'PRICING_GRAM_ONLY');
  if (materials.some((row) => row.pricingGroupId && row.pricingGroupId !== id))
    throw new ApiError(409, 'PRICING_MATERIAL_IN_USE');
}
export async function savePricingGroup(value: unknown, id?: string) {
  const data = id ? pricingGroupUpdateSchema.parse(value) : pricingGroupSchema.parse(value);
  const { materialIds, ...fields } = data;
  return pricingTransaction(async (tx) => {
    await checkMaterials(tx, materialIds, id);
    const values = {
      name: fields.name,
      lossRate: fields.lossRate,
      marketLinked: fields.marketLinked,
      marketCoefficient: fields.marketCoefficient,
      pricingRule: fields.pricingRule,
      pricingValue: fields.pricingValue,
      enabled: fields.enabled,
    };
    if (id) {
      const updated = await tx.materialPricingGroup.updateMany({
        where: { id, version: 'version' in fields ? (fields.version as number) : -1 },
        data: { ...values, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ApiError(409, 'PRICING_CHANGED');
      await tx.material.updateMany({
        where: { pricingGroupId: id, id: { notIn: materialIds } },
        data: { pricingGroupId: null },
      });
    } else {
      if (fields.enabled) throw new ApiError(400, 'PRICING_PUBLISH_FIRST');
      id = (await tx.materialPricingGroup.create({ data: values })).id;
    }
    await tx.material.updateMany({
      where: { id: { in: materialIds } },
      data: { pricingGroupId: id },
    });
    const state = await loadState(tx, id, new Date());
    if (fields.enabled && (!state.group.publication || state.summary.totals.adjustedCost === null))
      throw new ApiError(400, 'PRICING_PUBLISH_FIRST');
    return state.group;
  });
}
export async function publishPricingGroup(id: string, value: unknown) {
  const data = pricingPublishSchema.parse(value);
  const now = new Date();
  const state = await readState(id, now);
  if (state.group.version !== data.version || state.fingerprint !== data.fingerprint)
    throw new ApiError(409, 'PRICING_CHANGED');
  const preview = await previewState(state, now);
  if (preview.totals.adjustedCost === null) throw new ApiError(400, 'PRICING_NO_COST');
  return pricingTransaction(async (tx) => {
    const current = await loadState(tx, id, now);
    if (current.fingerprint !== data.fingerprint) throw new ApiError(409, 'PRICING_CHANGED');
    const changed = await tx.materialPricingGroup.updateMany({
      where: { id, version: data.version },
      data: {
        version: { increment: 1 },
        ...(!current.group.publication ? { enabled: true } : {}),
      },
    });
    if (changed.count !== 1) throw new ApiError(409, 'PRICING_CHANGED');
    // Keep full derivation, but avoid copying an unbounded purchase ledger into every publication.
    const costBasis = {
      ...preview,
      purchases: [],
      excluded: preview.excluded.map(({ id, reason }) => ({ id, reason })),
    };
    return serializePublication(
      await tx.materialPricingPublication.create({
        data: {
          groupId: id,
          version: data.version + 1,
          saleGramPrice: data.saleGramPrice,
          fingerprint: state.fingerprint,
          costBasis: costBasis as unknown as Prisma.InputJsonValue,
        },
      }),
    );
  });
}
export async function listPricingHistory(id: string, page = 1) {
  const where = { groupId: id };
  const [items, total] = await db.$transaction([
    db.materialPricingPublication.findMany({
      where,
      orderBy: { version: 'desc' },
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.materialPricingPublication.count({ where }),
  ]);
  return { items: items.map(serializePublication), total, page, pageSize: 20 };
}
export async function listPricingOptions() {
  const ids = await db.materialPricingGroup.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const now = new Date();
  const items = await Promise.all(
    ids.map(async ({ id }) => {
      const { group, summary } = await readState(id, now);
      const publication = group.publication;
      const { rawCost, adjustedCost } = summary.totals;
      if (!group.enabled || !publication || rawCost === null || adjustedCost === null) return null;
      const basis = {
        groupId: id,
        publicationId: publication.id,
        name: group.name,
        rawCost,
        adjustedCost,
        lossRate: group.lossRate,
        capturedAt: now.toISOString(),
      };
      return {
        id,
        name: group.name,
        publicationId: publication.id,
        saleGramPrice: publication.saleGramPrice,
        unitCost: adjustedCost,
        rawCost,
        lossRate: group.lossRate,
        costBasisToken: signCostBasis(basis),
      };
    }),
  );
  return { items: items.filter((item) => item !== null) };
}
