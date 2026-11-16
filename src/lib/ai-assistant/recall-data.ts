import type { Prisma } from '@prisma/client';
import { readAssistantCandidates } from './candidate-data';
import { CANDIDATE_LIMIT, CandidateQueryError, type CandidateDetail } from './candidate-contracts';
import { candidateKey, type AssistantQuery, type QueryCandidate } from './contracts';
import { catalogSemanticEvidence, normalizeSemanticConditions } from './semantic-policy';
import type { RecallSource } from './recall-contracts';

export type RecallSnapshot = {
  sources: { key: string; sources: RecallSource[] }[];
  sourceCounts: { route: RecallSource['route']; candidateCount: number }[];
};
export function recallSources(
  candidate: QueryCandidate,
  query: AssistantQuery,
  ancestorIds: ReadonlySet<string> = new Set(),
): RecallSource[] {
  const terms = [...new Set(normalizeSemanticConditions(query.semantic).flatMap((c) => c.terms))];
  const routes = new Map<
    RecallSource['route'],
    { terms: Set<string>; evidence: QueryCandidate['evidence'] }
  >();
  for (const evidence of catalogSemanticEvidence(candidate)) {
    const values =
      evidence.value === null
        ? []
        : Array.isArray(evidence.value)
          ? evidence.value
          : [evidence.value];
    const matched = terms.filter((term) =>
      values.some((value) => value.toLowerCase().includes(term.toLowerCase())),
    );
    if (!matched.length) continue;
    const route: RecallSource['route'] = evidence.entity.type.endsWith('_CATEGORY')
      ? ancestorIds.has(evidence.entity.id)
        ? 'category_subtree'
        : 'category'
      : evidence.entity.type === 'TAG'
        ? 'tag'
        : evidence.field === 'notes' || evidence.field === 'description'
          ? 'notes'
          : evidence.field === 'aliases'
            ? 'aliases'
            : 'name';
    const source = routes.get(route) ?? { terms: new Set<string>(), evidence: [] };
    matched.forEach((term) => source.terms.add(term));
    source.evidence.push(evidence);
    routes.set(route, source);
  }
  return [...routes]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([route, value]) => ({ route, terms: [...value.terms].sort(), evidence: value.evidence }))
    .concat([{ route: 'full_scope', terms: [], evidence: [] }]);
}
export function annotateRecall(
  rows: CandidateDetail[],
  query: AssistantQuery,
  ancestors: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) {
  const sources = rows.map((row) => ({
    key: candidateKey(row.candidate),
    sources: recallSources(row.candidate, query, ancestors.get(candidateKey(row.candidate))),
  }));
  const counts = new Map<RecallSource['route'], number>([['full_scope', 0]]);
  for (const row of sources)
    for (const source of row.sources) counts.set(source.route, (counts.get(source.route) ?? 0) + 1);
  return {
    rows,
    data: {
      sources,
      sourceCounts: [...counts]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([route, candidateCount]) => ({ route, candidateCount })),
    },
  };
}
export async function readAssistantRecall(tx: Prisma.TransactionClient, query: AssistantQuery) {
  const rows = await readAssistantCandidates(tx, query);
  const ancestors = new Map<string, Set<string>>();
  if (rows.some((r) => r.candidate.item.type === 'MATERIAL')) {
    const categories = await tx.materialCategory.findMany({
      select: { id: true, name: true, aliases: true, parentId: true },
      orderBy: { id: 'asc' },
      take: CANDIDATE_LIMIT + 1,
    });
    if (categories.length > CANDIDATE_LIMIT)
      throw new CandidateQueryError('CANDIDATE_BUDGET_EXCEEDED');
    const byId = new Map(categories.map((c) => [c.id, c]));
    const paths = new Map<string, typeof categories>();
    for (const category of categories) {
      const seen = new Set([category.id]);
      const path: typeof categories = [];
      let parentId = category.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent || seen.has(parentId)) throw new CandidateQueryError('INVALID_CATEGORY_TREE');
        seen.add(parentId);
        path.push(parent);
        parentId = parent.parentId;
      }
      paths.set(category.id, path);
    }
    for (const row of rows) {
      if (row.candidate.item.type !== 'MATERIAL') continue;
      const direct = row.candidate.evidence.find((e) => e.entity.type === 'MATERIAL_CATEGORY');
      if (!direct || !byId.has(direct.entity.id))
        throw new CandidateQueryError('INVALID_CATEGORY_TREE');
      const path = paths.get(direct.entity.id)!;
      ancestors.set(candidateKey(row.candidate), new Set(path.map((p) => p.id)));
      for (const parent of path) {
        row.candidate.evidence.push(
          {
            entity: { type: 'MATERIAL_CATEGORY', id: parent.id },
            field: 'name',
            value: parent.name,
          },
          {
            entity: { type: 'MATERIAL_CATEGORY', id: parent.id },
            field: 'aliases',
            value: parent.aliases,
          },
        );
      }
      if (row.candidate.evidence.length > 200)
        throw new CandidateQueryError('EVIDENCE_BUDGET_EXCEEDED');
    }
  }
  return annotateRecall(rows, query, ancestors);
}
