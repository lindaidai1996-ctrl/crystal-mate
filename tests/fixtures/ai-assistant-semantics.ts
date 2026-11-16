import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { assistantQuerySchema, type QueryCandidate } from '../../src/lib/ai-assistant/contracts';
import type { CandidateDetail } from '../../src/lib/ai-assistant/candidate-contracts';
export const fixtureId = (n: number) => `c${n.toString().padStart(24, '0')}`;
export const semanticQuery = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
    location: { text: '荔湾广场', kind: 'exact_place' },
  },
  semantic: [
    { concept: 'material', text: '绿松石', relation: 'is' },
    { concept: 'purpose', text: '配件', relation: 'is' },
  ],
  ruleVersion: 'v1',
  pagination: { limit: 5 },
});
export function semanticFixture(
  name: string,
  category: string,
  tags: string[] = [],
  aliases: string[] = [],
  notes = '',
  type: 'MATERIAL' | 'PRODUCT' = 'MATERIAL',
): QueryCandidate {
  const item = { type, id: fixtureId(1) };
  return {
    item,
    purchase: null,
    evidence: [
      { entity: item, field: 'name', value: name },
      { entity: item, field: 'aliases', value: aliases },
      { entity: item, field: type === 'MATERIAL' ? 'notes' : 'description', value: notes },
      {
        entity: {
          type: type === 'MATERIAL' ? 'MATERIAL_CATEGORY' : 'PRODUCT_CATEGORY',
          id: fixtureId(2),
        },
        field: 'name',
        value: category,
      },
      ...tags.map((tag, i) => ({
        entity: { type: 'TAG' as const, id: fixtureId(10 + i) },
        field: 'name' as const,
        value: tag,
      })),
    ],
  };
}
export const frozenDetails: CandidateDetail[] = baseline.scopedCandidates.map((row) => {
  const category = baseline.categories.find((c) => c.name === row.category)!;
  const item = { type: 'MATERIAL' as const, id: row.materialId };
  return {
    candidate: {
      item,
      purchase: { type: 'MATERIAL_PURCHASE', id: row.id },
      evidence: [
        { entity: item, field: 'name', value: row.name },
        { entity: item, field: 'aliases', value: row.aliases },
        { entity: item, field: 'notes', value: row.notes },
        {
          entity: { type: 'MATERIAL_CATEGORY', id: category.id },
          field: 'name',
          value: category.name,
        },
        {
          entity: { type: 'MATERIAL_CATEGORY', id: category.id },
          field: 'aliases',
          value: category.aliases,
        },
        ...row.tags.map((name) => ({
          entity: { type: 'TAG' as const, id: baseline.tags.find((t) => t.name === name)!.id },
          field: 'name' as const,
          value: name,
        })),
      ],
    },
    code: null,
    batch: null,
    distributor: { type: 'DISTRIBUTOR', id: row.distributorId },
  };
});
