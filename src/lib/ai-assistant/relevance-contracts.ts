import { z } from 'zod';
import {
  candidateKey,
  decisionsForCandidatesSchema,
  type QueryCandidate,
  type AssistantQuery,
} from './contracts';
import {
  catalogSemanticEvidence,
  assessSemanticCandidate,
  SEMANTIC_POLICY,
} from './semantic-policy';
import { CandidateQueryError } from './candidate-contracts';

export const RELEVANCE_PROMPT_VERSION = 'relevance-v4';
export const executionBudgetSchema = z.strictObject({
  batchSize: z.number().int().min(1).max(50).default(10),
  maxCalls: z.number().int().min(1).max(200).default(20),
  maxReservedTokens: z.number().int().min(1).max(2_000_000).default(200_000),
  maxCandidates: z.number().int().min(1).max(5000).default(5000),
  maxCallsPerStep: z.number().int().min(1).max(20).default(2),
  stepTimeoutMs: z.number().int().min(1).max(120_000).default(60_000),
  callTimeoutMs: z.number().int().min(1).max(60_000).default(30_000),
  maxInputBytes: z.number().int().min(1).max(1_000_000).default(100_000),
  maxOutputTokens: z.number().int().min(128).max(16_000).default(4000),
});
export type ExecutionBudget = z.infer<typeof executionBudgetSchema>;
export const relevanceCommandSchema = z.strictObject({
  runId: z.uuid(),
  revision: z.number().int().nonnegative(),
  budget: executionBudgetSchema.optional(),
});
export const relevanceReadSchema = relevanceCommandSchema.pick({ runId: true });

// Only semantic DTO fields reach the model. Indexes bind citations to the
// immutable candidate values; models never get to rewrite evidence values.
export function relevanceCandidate(candidate: QueryCandidate) {
  return { ...candidate, evidence: catalogSemanticEvidence(candidate) };
}
export function validateRelevanceOutput(
  input: unknown,
  candidates: QueryCandidate[],
  conditions: AssistantQuery['semantic'],
) {
  const parsed = z
    .strictObject({
      decisions: z
        .array(
          z.strictObject({
            key: z.string().max(250),
            status: z.enum(['include', 'exclude', 'uncertain']),
            evidenceIndexes: z.array(z.number().int().min(0).max(199)).min(1).max(50),
            reason: z.string().trim().min(1).max(500),
          }),
        )
        .max(candidates.length),
    })
    .parse(input);
  const byKey = new Map(candidates.map((c) => [candidateKey(c), c]));
  if (byKey.size !== candidates.length) throw new CandidateQueryError('DUPLICATE_CANDIDATE');
  const seen = new Set<string>();
  const decisions = parsed.decisions.map((row) => {
    const candidate = byKey.get(row.key);
    if (!candidate || seen.has(row.key)) throw new CandidateQueryError('MODEL_INVALID_REFERENCE');
    seen.add(row.key);
    if (
      new Set(row.evidenceIndexes).size !== row.evidenceIndexes.length ||
      row.evidenceIndexes.some((i) => !candidate.evidence[i])
    )
      throw new CandidateQueryError('MODEL_INVALID_EVIDENCE');
    const rule = assessSemanticCandidate(candidate, conditions);
    const conflict = rule.conditions.some(
      (c) => c.status === 'uncertain' && /冲突|待核对/.test(c.reason),
    );
    const disagreement =
      rule.decision && rule.decision.status !== 'uncertain' && rule.decision.status !== row.status;
    const ambiguousQuery = conditions.some((condition) =>
      SEMANTIC_POLICY.ambiguousTerms.some((term) => term === condition.text.trim()),
    );
    const noFacts = candidate.evidence.every(
      (e) => e.value === null || e.value === '' || (Array.isArray(e.value) && !e.value.length),
    );
    return {
      item: candidate.item,
      purchase: candidate.purchase,
      status:
        conflict || disagreement || ambiguousQuery || noFacts || !conditions.length
          ? ('uncertain' as const)
          : row.status,
      evidence: [
        ...new Map(
          [
            ...row.evidenceIndexes.map((i) => candidate.evidence[i]),
            ...(conflict || disagreement ? (rule.decision?.evidence ?? []) : []),
          ].map((e) => [JSON.stringify(e), e]),
        ).values(),
      ],
      reason:
        conflict || disagreement || ambiguousQuery
          ? `模型与 v1 规则存在分歧或字段冲突，需确认；${row.reason}`.slice(0, 500)
          : row.reason,
      ruleVersion: 'v1' as const,
    };
  });
  return decisionsForCandidatesSchema(candidates).parse(decisions);
}
