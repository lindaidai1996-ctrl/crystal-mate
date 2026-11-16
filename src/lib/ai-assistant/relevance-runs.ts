import { randomUUID } from 'node:crypto';
import {
  assistantQuerySchema,
  candidateKey,
  completenessSchema,
  type AssistantQuery,
  type QueryCandidate,
  type SemanticDecision,
} from './contracts';
import { CandidateQueryError, CANDIDATE_RUN_TTL_MS } from './candidate-contracts';
import { RecallRuns } from './recall-runs';
import type { RecallPage } from './recall-contracts';
import {
  executionBudgetSchema,
  relevanceCommandSchema,
  relevanceReadSchema,
  relevanceCandidate,
  validateRelevanceOutput,
  RELEVANCE_PROMPT_VERSION,
  type ExecutionBudget,
} from './relevance-contracts';
import {
  buildRelevanceInput,
  RELEVANCE_SYSTEM_PROMPT,
  type RelevanceModel,
} from './relevance-model';

type StopReason =
  | 'running'
  | 'budget'
  | 'timeout'
  | 'query_failed'
  | 'model_failed'
  | 'cancelled'
  | null;
type Attempt = {
  number: number;
  keys: string[];
  startedAt: string;
  durationMs: number;
  outcome: 'running' | 'success' | 'missing' | 'model_failed' | 'timeout' | 'cancelled';
  errorCode: string | null;
  model: string | null;
  returned: number;
  reservedTokens: number;
  usage: { promptTokens: number; completionTokens: number } | null;
  adjustments: {
    key: string;
    modelStatus: SemanticDecision['status'];
    effectiveStatus: SemanticDecision['status'];
  }[];
};
type Run = {
  accountId: string;
  query: AssistantQuery;
  page: RecallPage;
  queriedAt: string;
  expires: number;
  revision: number;
  candidates: Map<string, QueryCandidate>;
  decisions: Map<string, SemanticDecision>;
  sources: RecallPage['sources'];
  budget: ExecutionBudget;
  attempts: Attempt[];
  reservedTokens: number;
  stopReason: StopReason;
  lastErrorCode: string | null;
  controller: AbortController | null;
};
type Load = Parameters<RecallRuns['query']>[2];

export class RelevanceRuns {
  private readonly runs = new Map<string, Run>();
  private readonly recall: RecallRuns;
  constructor(private readonly now: () => number = Date.now) {
    this.recall = new RecallRuns(now);
  }
  private prune() {
    for (const [id, run] of this.runs)
      if (run.expires <= this.now()) {
        run.controller?.abort();
        this.runs.delete(id);
      }
  }
  private get(accountId: string, id: string) {
    this.prune();
    const run = this.runs.get(id);
    if (!run || run.accountId !== accountId) throw new CandidateQueryError('RUN_RESTART_REQUIRED');
    return run;
  }
  private checkRevision(run: Run, revision: number) {
    if (run.revision !== revision) throw new CandidateQueryError('STALE_REVISION');
  }
  private ingest(run: Run, page: RecallPage) {
    for (const candidate of page.items) {
      const key = candidateKey(candidate);
      if (!run.candidates.has(key)) run.candidates.set(key, relevanceCandidate(candidate));
    }
    run.sources = [...new Map([...run.sources, ...page.sources].map((s) => [s.key, s])).values()];
    run.page = page;
  }
  async start(accountId: string, input: unknown, load: Load) {
    const query = assistantQuerySchema.parse(input);
    if (query.pagination.cursor)
      throw new CandidateQueryError('NEW_RELEVANCE_RUN_REQUIRES_NEW_SCOPE');
    const page = await this.recall.query(accountId, query, load);
    this.prune();
    for (const [id, old] of this.runs) {
      if ([...this.runs.values()].filter((r) => r.accountId === accountId).length < 4) break;
      if (old.accountId === accountId) {
        old.controller?.abort();
        this.runs.delete(id);
      }
    }
    while (this.runs.size >= 32) {
      const id = this.runs.keys().next().value!;
      this.runs.get(id)?.controller?.abort();
      this.runs.delete(id);
    }
    const id = randomUUID();
    const run: Run = {
      accountId,
      query,
      page,
      queriedAt: page.queriedAt,
      expires: this.now() + CANDIDATE_RUN_TTL_MS,
      revision: 0,
      candidates: new Map(),
      decisions: new Map(),
      sources: [],
      budget: executionBudgetSchema.parse({}),
      attempts: [],
      reservedTokens: 0,
      stopReason: page.completeness.totalCandidates === 0 ? null : 'running',
      controller: null,
      lastErrorCode: null,
    };
    this.ingest(run, page);
    this.runs.set(id, run);
    return this.snapshot(id, run);
  }
  read(accountId: string, input: unknown) {
    const { runId } = relevanceReadSchema.parse(input);
    return this.snapshot(runId, this.get(accountId, runId));
  }
  cancel(accountId: string, input: unknown) {
    const { runId, revision } = relevanceCommandSchema.omit({ budget: true }).parse(input);
    const run = this.get(accountId, runId);
    this.checkRevision(run, revision);
    if (run.stopReason === null) return this.snapshot(runId, run);
    run.revision++;
    run.stopReason = 'cancelled';
    run.lastErrorCode = 'CANCELLED';
    run.controller?.abort();
    run.controller = null;
    return this.snapshot(runId, run);
  }
  async advance(accountId: string, input: unknown, model: RelevanceModel) {
    const { runId, revision, budget } = relevanceCommandSchema.parse(input);
    const run = this.get(accountId, runId);
    this.checkRevision(run, revision);
    if (run.controller) throw new CandidateQueryError('RUN_BUSY');
    if (run.stopReason === null) return this.snapshot(runId, run);
    if (budget) run.budget = budget;
    const limits = run.budget;
    const generation = ++run.revision;
    const controller = new AbortController();
    run.controller = controller;
    run.stopReason = 'running';
    run.lastErrorCode = null;
    const started = this.now();
    const deadline = AbortSignal.timeout(limits.stepTimeoutMs);
    const active = () => this.get(accountId, runId) === run && run.revision === generation;
    let calls = 0;
    try {
      for (;;) {
        if (!active()) break;
        if (deadline.aborted || this.now() - started >= limits.stepTimeoutMs) {
          run.stopReason = 'timeout';
          run.lastErrorCode = 'STEP_TIMEOUT';
          break;
        }
        const pending = [...run.candidates.values()].filter(
          (c) => !run.decisions.has(candidateKey(c)),
        );
        if (!pending.length && !run.page.nextCursor) {
          run.stopReason = null;
          break;
        }
        if (
          run.attempts.length >= limits.maxCalls ||
          run.decisions.size >= limits.maxCandidates ||
          run.reservedTokens >= limits.maxReservedTokens
        ) {
          run.stopReason = 'budget';
          run.lastErrorCode = 'EXECUTION_BUDGET_EXCEEDED';
          break;
        }
        if (calls >= limits.maxCallsPerStep) {
          run.stopReason = 'budget';
          run.lastErrorCode = 'EXECUTION_BUDGET_EXCEEDED';
          break;
        }
        if (!pending.length) {
          try {
            const page = await this.recall.query(
              accountId,
              {
                ...run.query,
                pagination: { ...run.query.pagination, cursor: run.page.nextCursor! },
              },
              async () => {
                throw new CandidateQueryError('RUN_RESTART_REQUIRED');
              },
            );
            if (!active()) break;
            this.ingest(run, page);
          } catch {
            if (active()) {
              run.stopReason = 'query_failed';
              run.lastErrorCode = 'RECALL_CONTINUATION_FAILED';
            }
            break;
          }
          continue;
        }
        let batch = pending.slice(
          0,
          Math.min(limits.batchSize, limits.maxCandidates - run.decisions.size),
        );
        let payload = buildRelevanceInput(run.query, batch, run.sources);
        let bytes = Buffer.byteLength(RELEVANCE_SYSTEM_PROMPT + JSON.stringify(payload), 'utf8');
        while (
          batch.length > 1 &&
          (bytes > limits.maxInputBytes ||
            run.reservedTokens + bytes + limits.maxOutputTokens + 1024 > limits.maxReservedTokens)
        ) {
          batch = batch.slice(0, -1);
          payload = buildRelevanceInput(run.query, batch, run.sources);
          bytes = Buffer.byteLength(RELEVANCE_SYSTEM_PROMPT + JSON.stringify(payload), 'utf8');
        }
        const reservation = bytes + limits.maxOutputTokens + 1024;
        if (
          bytes > limits.maxInputBytes ||
          run.reservedTokens + reservation > limits.maxReservedTokens
        ) {
          run.stopReason = 'budget';
          run.lastErrorCode = 'EXECUTION_BUDGET_EXCEEDED';
          break;
        }
        const attempt: Attempt = {
          number: run.attempts.length + 1,
          keys: batch.map(candidateKey),
          startedAt: new Date(this.now()).toISOString(),
          durationMs: 0,
          outcome: 'running',
          errorCode: null,
          model: null,
          returned: 0,
          reservedTokens: reservation,
          usage: null,
          adjustments: [],
        };
        run.attempts.push(attempt);
        run.reservedTokens += reservation;
        calls++;
        const callStarted = this.now();
        const callTimeout = AbortSignal.timeout(limits.callTimeoutMs);
        const signal = AbortSignal.any([controller.signal, deadline, callTimeout]);
        let abortListener: (() => void) | undefined;
        try {
          // The race protects against adapters that ignore AbortSignal. They
          // receive a cloned DTO and cannot mutate the retained snapshot.
          const aborted = new Promise<never>((_, reject) => {
            abortListener = () => reject(new CandidateQueryError('MODEL_ABORTED'));
            if (signal.aborted) abortListener();
            else signal.addEventListener('abort', abortListener, { once: true });
          });
          const result = await Promise.race([
            model(structuredClone(payload), { signal, maxOutputTokens: limits.maxOutputTokens }),
            aborted,
          ]);
          if (!active() || signal.aborted) throw new CandidateQueryError('MODEL_ABORTED');
          attempt.model = result.model;
          attempt.usage = result.usage;
          const decisions = validateRelevanceOutput(result.output, batch, run.query.semantic);
          const raw = result.output as {
            decisions: { key: string; status: SemanticDecision['status'] }[];
          };
          attempt.adjustments = decisions.flatMap((d) => {
            const reported = raw.decisions.find((r) => r.key === candidateKey(d))!;
            return reported.status === d.status
              ? []
              : [{ key: candidateKey(d), modelStatus: reported.status, effectiveStatus: d.status }];
          });
          // Validation is atomic: one invalid citation rejects the entire batch.
          for (const decision of decisions) {
            const key = candidateKey(decision);
            if (run.decisions.has(key)) throw new CandidateQueryError('MODEL_DUPLICATE_DECISION');
          }
          decisions.forEach((d) => run.decisions.set(candidateKey(d), d));
          attempt.returned = decisions.length;
          attempt.outcome = decisions.length === batch.length ? 'success' : 'missing';
          if (attempt.outcome === 'missing') {
            attempt.errorCode = 'MODEL_MISSING_DECISIONS';
            run.stopReason = 'model_failed';
            run.lastErrorCode = 'MODEL_MISSING_DECISIONS';
            break;
          }
        } catch (error) {
          attempt.outcome = controller.signal.aborted
            ? 'cancelled'
            : deadline.aborted || callTimeout.aborted
              ? 'timeout'
              : 'model_failed';
          attempt.errorCode =
            error instanceof CandidateQueryError ? error.code : 'MODEL_INVALID_RESPONSE';
          if (active()) {
            run.stopReason = attempt.outcome;
            run.lastErrorCode = attempt.errorCode;
          }
          break;
        } finally {
          if (abortListener) signal.removeEventListener('abort', abortListener);
          attempt.durationMs = this.now() - callStarted;
        }
      }
    } catch (error) {
      if (active()) {
        const code = error instanceof CandidateQueryError ? error.code : 'MODEL_INPUT_INVALID';
        run.lastErrorCode = code;
        run.stopReason = code.includes('BUDGET') ? 'budget' : 'model_failed';
      }
    } finally {
      if (active()) run.controller = null;
    }
    return this.snapshot(runId, this.get(accountId, runId));
  }
  private snapshot(id: string, run: Run) {
    const candidates = [...run.candidates.values()];
    const decisions = [...run.decisions.values()];
    const total = run.page.completeness.totalCandidates!;
    const read = candidates.length,
      evaluated = decisions.length;
    const included = decisions.filter((d) => d.status === 'include');
    const complete = read === total && evaluated === total;
    const completeness = completenessSchema.parse({
      scope: 'resolved',
      traversal: read === total ? 'complete' : 'partial',
      evaluation: complete ? 'complete' : evaluated ? 'partial' : 'not_started',
      countBasis: run.query.subject === 'purchases' ? 'purchase_entry' : 'catalog',
      totalCandidates: total,
      readCandidates: read,
      uniqueCatalogItems: new Set(candidates.map((c) => JSON.stringify(c.item))).size,
      evaluatedCandidates: evaluated,
      included: included.length,
      excluded: decisions.filter((d) => d.status === 'exclude').length,
      uncertain: decisions.filter((d) => d.status === 'uncertain').length,
      notEvaluated: read - evaluated,
      unreadCandidates: total - read,
      stopReason: complete ? null : (run.stopReason ?? 'running'),
    });
    return structuredClone({
      version: 'v1' as const,
      promptVersion: RELEVANCE_PROMPT_VERSION,
      ruleVersion: 'v1' as const,
      runId: id,
      revision: run.revision,
      query: run.query,
      queriedAt: run.queriedAt,
      expiresAt: new Date(run.expires).toISOString(),
      busy: Boolean(run.controller),
      lastErrorCode: run.lastErrorCode,
      completeness,
      coverage: { traversal: total ? read / total : 1, evaluation: total ? evaluated / total : 1 },
      decisions,
      notEvaluatedKeys: candidates
        .filter((c) => !run.decisions.has(candidateKey(c)))
        .map(candidateKey),
      sourceCounts: run.page.sourceCounts,
      budget: run.budget,
      usage: {
        calls: run.attempts.length,
        reservedTokens: run.reservedTokens,
        knownPromptTokens: run.attempts.reduce((s, a) => s + (a.usage?.promptTokens ?? 0), 0),
        knownCompletionTokens: run.attempts.reduce(
          (s, a) => s + (a.usage?.completionTokens ?? 0),
          0,
        ),
        unknownUsageCalls: run.attempts.filter((a) => !a.usage).length,
      },
      attempts: run.attempts,
      confirmedSelection: included.map((d) => ({ item: d.item, purchase: d.purchase })),
      selectionIsPartial: !complete || completeness.uncertain > 0,
      canConcludeNoMatches: complete && !included.length && !completeness.uncertain,
    });
  }
}
