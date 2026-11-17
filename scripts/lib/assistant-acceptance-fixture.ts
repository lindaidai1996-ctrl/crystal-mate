// Frozen business values; missing relational labels/timestamps are explicitly synthetic.
// This adapter exercises the real readers. It never connects to a database.
import { Prisma } from '@prisma/client';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { fixtureId } from '../../tests/fixtures/ai-assistant-semantics';

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    const actual = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const condition = value as Row;
      if ('in' in condition) return (condition.in as unknown[]).includes(actual);
      if ('gte' in condition || 'lt' in condition)
        return (
          (!('gte' in condition) || (actual as Date) >= (condition.gte as Date)) &&
          (!('lt' in condition) || (actual as Date) < (condition.lt as Date))
        );
      if ('some' in condition)
        return (actual as Row[]).some((r) => matches(r, condition.some as Row));
      return !!actual && matches(actual as Row, condition);
    }
    return actual === value;
  });
}
export function frozenBusinessFixture() {
  const createdAt = new Date('2026-10-15T00:00:00Z');
  const distributors = baseline.locationEvidence.map((r) => ({
    id: r.id,
    name: '合成渠道商名称',
    area: r.area,
    address: r.addressMentionsLiwanPlaza ? '荔湾广场' : '',
    notes: '',
    createdAt,
  }));
  const entries = baseline.scopedCandidates.map((r, index) => {
    const category = baseline.categories.find((c) => c.name === r.category)!;
    const material = {
      id: r.materialId,
      name: r.name,
      notes: r.notes,
      aliases: r.aliases,
      unit: r.unit,
      createdAt,
      category,
      categoryId: category.id,
      tags: r.tags.map((name) => {
        const tag = baseline.tags.find((t) => t.name === name)!;
        return { tagId: tag.id, tag };
      }),
    };
    return {
      id: r.id,
      materialId: r.materialId,
      material,
      batchId: fixtureId(5000 + index),
      batch: {
        id: fixtureId(5000 + index),
        name: '合成批次名称',
        receivedAt: new Date(`${r.date}T00:00:00Z`),
        createdAt,
      },
      distributorId: r.distributorId,
      distributor: distributors.find((d) => d.id === r.distributorId)!,
      receivedQty: new Prisma.Decimal(r.quantity),
      remainingQty: new Prisma.Decimal(r.remainingQuantity),
      purchaseTotalAmount: new Prisma.Decimal(r.amount),
      purchaseUnitPrice: null as Prisma.Decimal | null,
      createdAt,
    };
  });
  const materials = entries.map((r) => r.material);
  const delegate = (rows: Row[]) => ({
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) =>
      rows.filter((r) => matches(r, where)).slice(0, take),
  });
  const tx = {
    distributor: delegate(distributors),
    materialCategory: delegate(baseline.categories),
    tag: delegate(baseline.tags),
    materialBatchEntry: delegate(entries),
    material: delegate(materials),
    product: delegate([]),
    productPurchaseEntry: delegate([]),
    category: delegate([]),
  } as unknown as Prisma.TransactionClient;
  return { tx, entries, materials, distributors };
}
