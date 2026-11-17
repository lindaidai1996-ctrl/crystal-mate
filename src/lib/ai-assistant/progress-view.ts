import { z } from 'zod';
import { locationResolutionSchema } from './reference-contracts';
import { completenessSchema, semanticDecisionSchema, type SemanticDecision } from './contracts';
import type { Execution } from './orchestrator';

export type AssistantProgress = {
  countBasis: 'purchase_entry' | 'catalog' | 'distributor';
  totalCandidates: number | null;
  readCandidates: number | null;
  evaluatedCandidates: number | null;
  included: number | null;
  excluded: number | null;
  uncertain: number | null;
  notEvaluated: number | null;
  unreadCandidates: number | null;
  traversal: string;
  evaluation: string;
  decisions: {
    item: SemanticDecision['item'];
    purchase: SemanticDecision['purchase'];
    status: SemanticDecision['status'];
    name: string | null;
    reason: string | null;
    evidence: SemanticDecision['evidence'];
  }[];
  calls: number;
  reservedTokens: number;
  relevanceCalls: number;
  relevanceReservedTokens: number;
};
const count = z.number().int().nonnegative();
const checkpointSchema = z.object({
  decisions: z.array(semanticDecisionSchema).max(5000),
  attempts: z.array(z.unknown()).max(200),
  reservedTokens: count,
});
export function assistantProgressView(execution: Execution, privacy: boolean): AssistantProgress {
  const relevance = z
    .object({
      relevance: z
        .object({
          completeness: completenessSchema,
          decisions: z.array(semanticDecisionSchema).max(5000),
        })
        .nullable(),
    })
    .safeParse(execution.result);
  const final = relevance.success ? relevance.data.relevance : null;
  const checkpoint = checkpointSchema.safeParse(execution.checkpoint);
  const candidate = [...execution.trace]
    .reverse()
    .filter((event) => event.stage === 'candidate' && event.outcome === 'success')
    .map((event) =>
      z
        .object({ totalCandidates: count.nullable(), readCandidates: count })
        .safeParse(event.completeness),
    )
    .find((result) => result.success);
  const candidateData = candidate?.success ? candidate.data : null;
  const decisions = final?.decisions ?? (checkpoint.success ? checkpoint.data.decisions : []);
  const noSemantic = execution.state?.query.semantic.length === 0;
  const complete = ['completed', 'no_results'].includes(execution.status);
  const counts = final?.completeness;
  const total = counts?.totalCandidates ?? candidateData?.totalCandidates ?? null;
  const read = counts?.readCandidates ?? candidateData?.readCandidates ?? null;
  const evaluated =
    counts?.evaluatedCandidates ??
    (checkpoint.success ? decisions.length : noSemantic && complete ? read : null);
  const location = z
    .object({
      facts: z.object({ kind: z.literal('distributors'), resolution: locationResolutionSchema }),
    })
    .safeParse(execution.result);
  const locationCounts = location.success
    ? {
        countBasis: 'distributor' as const,
        totalCandidates: location.data.facts.resolution.scannedCount,
        readCandidates: location.data.facts.resolution.scannedCount,
        evaluatedCandidates: location.data.facts.resolution.scannedCount,
        included: location.data.facts.resolution.confirmed.length,
        uncertain: location.data.facts.resolution.uncertain.length,
        excluded:
          location.data.facts.resolution.scannedCount -
          location.data.facts.resolution.confirmed.length -
          location.data.facts.resolution.uncertain.length,
        notEvaluated: 0,
        unreadCandidates: 0,
        traversal: location.data.facts.resolution.scanComplete ? 'complete' : 'partial',
        evaluation: 'not_required',
      }
    : {};
  return {
    countBasis:
      execution.state?.view === 'distributors'
        ? 'distributor'
        : execution.state?.query.subject === 'catalog'
          ? 'catalog'
          : 'purchase_entry',
    totalCandidates: total,
    readCandidates: read,
    evaluatedCandidates: evaluated,
    included:
      counts?.included ??
      (checkpoint.success
        ? decisions.filter((d) => d.status === 'include').length
        : noSemantic && complete
          ? read
          : null),
    excluded:
      counts?.excluded ??
      (checkpoint.success
        ? decisions.filter((d) => d.status === 'exclude').length
        : noSemantic && complete
          ? 0
          : null),
    uncertain:
      counts?.uncertain ??
      (checkpoint.success
        ? decisions.filter((d) => d.status === 'uncertain').length
        : noSemantic && complete
          ? 0
          : null),
    notEvaluated:
      counts?.notEvaluated ??
      (read !== null && evaluated !== null ? Math.max(0, read - evaluated) : null),
    unreadCandidates:
      counts?.unreadCandidates ??
      (total !== null && read !== null ? Math.max(0, total - read) : null),
    traversal:
      counts?.traversal ??
      (total !== null && read === total ? 'complete' : read === null ? 'not_started' : 'partial'),
    evaluation: noSemantic
      ? 'not_required'
      : (counts?.evaluation ??
        (evaluated !== null && total !== null && evaluated === total
          ? 'complete'
          : evaluated
            ? 'partial'
            : 'not_started')),
    decisions: decisions.map((row) => ({
      item: row.item,
      purchase: row.purchase,
      status: row.status,
      name: privacy
        ? null
        : ((row.evidence.find(
            (e) =>
              e.entity.type === row.item.type && e.entity.id === row.item.id && e.field === 'name',
          )?.value as string | undefined) ?? null),
      reason: privacy ? null : row.reason,
      evidence: privacy ? [] : row.evidence,
    })),
    calls: execution.calls,
    reservedTokens: execution.reservedTokens,
    relevanceCalls: checkpoint.success ? checkpoint.data.attempts.length : 0,
    relevanceReservedTokens: checkpoint.success ? checkpoint.data.reservedTokens : 0,
    ...locationCounts,
  };
}
