import type { Prisma } from '@prisma/client';
import type { AssistantQuery, EntityRef, QueryCandidate } from './contracts';
import { CANDIDATE_LIMIT, CandidateQueryError, type CandidateDetail } from './candidate-contracts';
import { REFERENCE_SCAN_LIMIT } from './reference-contracts';
import { resolveLocationRows, resolvedLocationDistributorIds } from './reference-resolution';

const named = { id: true, name: true } as const;
const catalog = {
  id: true,
  name: true,
  aliases: true,
  createdAt: true,
  category: { select: named },
  tags: { select: { tag: { select: named } } },
} as const;
const materialSelect = {
  ...catalog,
  notes: true,
  category: { select: { ...named, aliases: true } },
} as const;
const productSelect = { ...catalog, code: true, description: true } as const;
const batchSelect = { id: true, name: true, receivedAt: true, createdAt: true } as const;
const distributorSelect = { ...named, createdAt: true } as const;
const take = CANDIDATE_LIMIT + 1;
const orderBy = { id: 'asc' } as const;
function requireIds(expected: string[], actual: { id: string }[]) {
  const found = new Set(actual.map((r) => r.id));
  if (expected.some((id) => !found.has(id))) throw new CandidateQueryError('REFERENCE_NOT_FOUND');
}
function bounded<T>(rows: T[], limit = CANDIDATE_LIMIT): T[] {
  if (rows.length > limit) throw new CandidateQueryError('CANDIDATE_BUDGET_EXCEEDED');
  return rows;
}

// Called only in a server-controlled RepeatableRead transaction. This function
// takes no model-supplied SQL, resolved location objects, actor or owner IDs.
export async function readAssistantCandidates(tx: Prisma.TransactionClient, query: AssistantQuery) {
  const hard = query.hard;
  for (const type of query.itemTypes) {
    const ids = hard.items?.filter((r) => r.type === type).map((r) => r.id) ?? [];
    if (ids.length)
      requireIds(
        ids,
        type === 'MATERIAL'
          ? await tx.material.findMany({ where: { id: { in: ids } }, select: { id: true } })
          : await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true } }),
      );
  }
  if (hard.tagIds)
    requireIds(
      hard.tagIds,
      await tx.tag.findMany({ where: { id: { in: hard.tagIds } }, select: { id: true } }),
    );
  let distributorIds = hard.distributorIds;
  if (distributorIds)
    requireIds(
      distributorIds,
      await tx.distributor.findMany({
        where: { id: { in: distributorIds } },
        select: { id: true },
      }),
    );
  if (hard.location) {
    const rows = await tx.distributor.findMany({
      select: { ...named, area: true, address: true, notes: true },
      orderBy,
      take: REFERENCE_SCAN_LIMIT + 1,
    });
    const resolved = resolveLocationRows(
      hard.location,
      rows.slice(0, REFERENCE_SCAN_LIMIT),
      rows.length <= REFERENCE_SCAN_LIMIT,
    );
    if (resolved.status !== 'resolved')
      throw new CandidateQueryError(
        resolved.status === 'incomplete' ? 'LOCATION_INCOMPLETE' : 'LOCATION_NEEDS_CLARIFICATION',
      );
    const locationIds = resolvedLocationDistributorIds(resolved);
    distributorIds = distributorIds
      ? distributorIds.filter((id) => locationIds.includes(id))
      : locationIds;
  }
  const materialCategories: string[] = [];
  const productCategories =
    hard.categories?.filter((r) => r.type === 'PRODUCT_CATEGORY').map((r) => r.id) ?? [];
  if (productCategories.length)
    requireIds(
      productCategories,
      await tx.category.findMany({
        where: { id: { in: productCategories } },
        select: { id: true },
      }),
    );
  const requestedMaterialCategories =
    hard.categories?.filter((r) => r.type === 'MATERIAL_CATEGORY') ?? [];
  if (requestedMaterialCategories.length) {
    const rows = bounded(
      await tx.materialCategory.findMany({ select: { id: true, parentId: true }, orderBy, take }),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    requireIds(
      requestedMaterialCategories.map((r) => r.id),
      rows,
    );
    // Validate parent chains before expanding; corrupt trees must not silently narrow a scope.
    for (const row of rows) {
      const seen = new Set<string>([row.id]);
      let parent = row.parentId;
      while (parent) {
        if (seen.has(parent) || !byId.has(parent))
          throw new CandidateQueryError('INVALID_CATEGORY_TREE');
        seen.add(parent);
        parent = byId.get(parent)!.parentId;
      }
    }
    for (const selected of requestedMaterialCategories) {
      materialCategories.push(selected.id);
      if (selected.includeDescendants) {
        const descendants = new Set([selected.id]);
        let previous = 0;
        while (previous !== descendants.size) {
          previous = descendants.size;
          for (const row of rows)
            if (row.parentId && descendants.has(row.parentId)) descendants.add(row.id);
        }
        materialCategories.push(...descendants);
      }
    }
  }
  const created = hard.createdAt;
  const createdRange = created
    ? { gte: new Date(created.from), lt: new Date(created.to) }
    : undefined;
  const commonCatalog = (type: 'MATERIAL' | 'PRODUCT') => ({
    ...(hard.items
      ? { id: { in: hard.items.filter((r) => r.type === type).map((r) => r.id) } }
      : {}),
    ...(hard.categories
      ? { categoryId: { in: type === 'MATERIAL' ? materialCategories : productCategories } }
      : {}),
    ...(hard.tagIds ? { tags: { some: { tagId: { in: hard.tagIds } } } } : {}),
    ...(created?.entity === 'catalog' ? { createdAt: createdRange } : {}),
  });
  const purchaseWhere = {
    ...(distributorIds !== undefined ? { distributorId: { in: distributorIds } } : {}),
    ...(created?.entity === 'purchase' ? { createdAt: createdRange } : {}),
    ...(hard.purchaseDate || created?.entity === 'batch'
      ? {
          batch: {
            ...(hard.purchaseDate
              ? {
                  receivedAt: {
                    gte: new Date(`${hard.purchaseDate.from}T00:00:00Z`),
                    lt: new Date(`${hard.purchaseDate.to}T00:00:00Z`),
                  },
                }
              : {}),
            ...(created?.entity === 'batch' ? { createdAt: createdRange } : {}),
          },
        }
      : {}),
    ...(created?.entity === 'distributor' ? { distributor: { createdAt: createdRange } } : {}),
  };
  const result: CandidateDetail[] = [];
  type CatalogRow = {
    id: string;
    name: string;
    aliases: string[];
    createdAt: Date;
    notes?: string;
    description?: string;
    code?: string;
    category: { id: string; name: string; aliases?: string[] };
    tags: { tag: { id: string; name: string } }[];
  };
  function detail(
    type: 'MATERIAL' | 'PRODUCT',
    row: CatalogRow,
    purchase: EntityRef | null = null,
    batch: { id: string; name: string; receivedAt: Date; createdAt: Date } | null = null,
    distributor: { id: string; name: string; createdAt: Date } | null = null,
    purchaseCreatedAt?: Date,
    purchaseNotes?: string,
  ) {
    const item = { type, id: row.id };
    const evidence: QueryCandidate['evidence'] = [];
    const add = (
      entity: EntityRef,
      field: QueryCandidate['evidence'][number]['field'],
      value: string | string[] | null,
    ) => evidence.push({ entity, field, value });
    add(item, 'name', row.name);
    add(item, 'aliases', row.aliases);
    add(
      item,
      type === 'MATERIAL' ? 'notes' : 'description',
      type === 'MATERIAL' ? row.notes! : row.description!,
    );
    add(item, 'createdAt', row.createdAt.toISOString());
    const category: EntityRef = {
      type: type === 'MATERIAL' ? 'MATERIAL_CATEGORY' : 'PRODUCT_CATEGORY',
      id: row.category.id,
    };
    add(category, 'name', row.category.name);
    if (row.category.aliases) add(category, 'aliases', row.category.aliases);
    for (const { tag } of [...row.tags].sort((a, b) => (a.tag.id < b.tag.id ? -1 : 1)))
      add({ type: 'TAG', id: tag.id }, 'name', tag.name);
    const batchRef = batch ? { type: 'BATCH' as const, id: batch.id } : null;
    const distributorRef = distributor
      ? { type: 'DISTRIBUTOR' as const, id: distributor.id }
      : null;
    if (batch && batchRef) {
      add(batchRef, 'name', batch.name);
      add(batchRef, 'receivedAt', batch.receivedAt.toISOString().slice(0, 10));
      add(batchRef, 'createdAt', batch.createdAt.toISOString());
    }
    if (distributor && distributorRef) {
      add(distributorRef, 'name', distributor.name);
      add(distributorRef, 'createdAt', distributor.createdAt.toISOString());
    }
    if (purchase && purchaseCreatedAt) add(purchase, 'createdAt', purchaseCreatedAt.toISOString());
    if (purchase && purchaseNotes !== undefined) add(purchase, 'notes', purchaseNotes);
    result.push({
      candidate: { item, purchase: purchase as QueryCandidate['purchase'], evidence },
      code: row.code ?? null,
      batch: batchRef,
      distributor: distributorRef,
    });
  }
  if (query.itemTypes.includes('MATERIAL')) {
    const where = commonCatalog('MATERIAL');
    if (query.subject === 'catalog') {
      const rows = bounded(
        await tx.material.findMany({
          where: {
            ...where,
            ...(distributorIds !== undefined
              ? { batchEntries: { some: { distributorId: { in: distributorIds } } } }
              : {}),
          },
          select: materialSelect,
          take,
          orderBy,
        }),
      );
      for (const row of rows) detail('MATERIAL', row);
    } else {
      const rows = bounded(
        await tx.materialBatchEntry.findMany({
          where: { ...purchaseWhere, material: where },
          select: {
            id: true,
            createdAt: true,
            material: { select: materialSelect },
            batch: { select: batchSelect },
            distributor: { select: distributorSelect },
          },
          take,
          orderBy,
        }),
      );
      for (const row of rows)
        detail(
          'MATERIAL',
          row.material,
          { type: 'MATERIAL_PURCHASE', id: row.id },
          row.batch,
          row.distributor,
          row.createdAt,
        );
    }
  }
  if (query.itemTypes.includes('PRODUCT')) {
    const where = commonCatalog('PRODUCT');
    if (query.subject === 'catalog') {
      const rows = bounded(
        await tx.product.findMany({
          where: {
            ...where,
            ...(distributorIds !== undefined
              ? { purchaseEntries: { some: { distributorId: { in: distributorIds } } } }
              : {}),
          },
          select: productSelect,
          take,
          orderBy,
        }),
      );
      for (const row of rows) detail('PRODUCT', row);
    } else {
      const rows = bounded(
        await tx.productPurchaseEntry.findMany({
          where: { ...purchaseWhere, product: where },
          select: {
            id: true,
            createdAt: true,
            notes: true,
            product: { select: productSelect },
            batch: { select: batchSelect },
            distributor: { select: distributorSelect },
          },
          take,
          orderBy,
        }),
      );
      for (const row of rows)
        detail(
          'PRODUCT',
          row.product,
          { type: 'PRODUCT_PURCHASE', id: row.id },
          row.batch,
          row.distributor,
          row.createdAt,
          row.notes,
        );
    }
  }
  return bounded(result);
}
