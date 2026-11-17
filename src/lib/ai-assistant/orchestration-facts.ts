import type { AssistantQuery, QueryCandidate } from './contracts';
import type { RelevanceModel } from './relevance-model';
import { RelevanceRuns, type RelevanceCheckpoint } from './relevance-runs';
import { executionBudgetSchema } from './relevance-contracts';
import type { readAssistantRecall } from './recall-data';
import type { readAssistantPurchases } from './purchase-data';
import type { readAssistantStock } from './stock-data';
import { purchaseQuerySchema } from './purchase-contracts';
import { stockQuerySchema } from './stock-contracts';
import { summarizeAssistantPurchases } from './purchase-summary';
import { CandidateQueryError } from './candidate-contracts';
import { safeAssistantCode, type FactExecutor, type TraceEvent } from './orchestrator';
import type { readAssistantDisplay } from './display-data';
import type { LocationResolution } from './reference-contracts';

export function createAssistantFacts(deps: {
  accountId: string;
  recall: (query: AssistantQuery) => ReturnType<typeof readAssistantRecall>;
  purchases: (
    input: Parameters<typeof readAssistantPurchases>[1],
  ) => ReturnType<typeof readAssistantPurchases>;
  stock: (input: Parameters<typeof readAssistantStock>[1]) => ReturnType<typeof readAssistantStock>;
  model: RelevanceModel;
  display?: (
    refs: Parameters<typeof readAssistantDisplay>[1],
  ) => ReturnType<typeof readAssistantDisplay>;
  relevanceBudget?: unknown;
  location?: (
    input: NonNullable<AssistantQuery['hard']['location']>,
  ) => Promise<LocationResolution>;
}): FactExecutor {
  return async (state, checkpoint, signal, event) => {
    let stage: TraceEvent['stage'] = 'candidate';
    let began = Date.now();
    let retained = checkpoint;
    const measured = async <T>(name: TraceEvent['stage'], work: () => Promise<T>) => {
      stage = name;
      began = Date.now();
      await event({
        stage,
        outcome: 'started',
        durationMs: 0,
        code: null,
        model: null,
        usage: null,
        completeness: null,
      });
      const result = await work();
      const completeness =
        name === 'candidate' && result && typeof result === 'object'
          ? 'completeness' in result
            ? result.completeness
            : 'rows' in result && Array.isArray(result.rows)
              ? {
                  traversal: 'complete',
                  totalCandidates: result.rows.length,
                  readCandidates: result.rows.length,
                  semanticEvaluation: 'not_performed',
                }
              : null
          : null;
      if (signal.aborted) throw new CandidateQueryError('EXECUTION_ABORTED');
      await event({
        stage,
        outcome: 'success',
        durationMs: Date.now() - began,
        code: null,
        model: null,
        usage: null,
        completeness,
      });
      return result;
    };
    try {
      const query = state.query;
      if (state.view === 'distributors') {
        if (
          !query.hard.location ||
          !deps.location ||
          query.semantic.length ||
          Object.keys(query.hard).some((key) => !['location', 'distributorIds'].includes(key))
        )
          return {
            status: 'needs_confirmation',
            result: null,
            checkpoint: null,
            clarification: '请明确渠道商地点；直接地点查询不接受采购日期或物料语义条件。',
          };
        const resolution = await measured('candidate', () => deps.location!(query.hard.location!));
        const ids = query.hard.distributorIds;
        const scoped = {
          ...resolution,
          confirmed: resolution.confirmed.filter((row) => !ids || ids.includes(row.distributor.id)),
          uncertain: resolution.uncertain.filter((row) => !ids || ids.includes(row.distributor.id)),
        };
        scoped.status = !scoped.scanComplete
          ? 'incomplete'
          : scoped.confirmed.length || !scoped.uncertain.length
            ? 'resolved'
            : 'needs_clarification';
        if (resolution.status === 'incomplete')
          return { status: 'incomplete', result: null, checkpoint: null };
        return {
          status: scoped.uncertain.length
            ? 'needs_confirmation'
            : scoped.confirmed.length
              ? 'completed'
              : 'no_results',
          result: {
            facts: {
              kind: 'distributors',
              resolution: scoped,
              queriedAt: new Date().toISOString(),
            },
          },
          checkpoint: null,
          ...(scoped.uncertain.length
            ? { clarification: '另有渠道商仅能证实较大区域或地点存在歧义，未纳入确定集合。' }
            : {}),
        };
      }
      if (
        state.view === 'purchase_remaining' &&
        (query.subject !== 'purchases' || query.itemTypes.includes('PRODUCT'))
      )
        return {
          status: 'needs_confirmation',
          result: null,
          checkpoint: null,
          clarification: '采购来源余量仅支持物料采购行；商品没有该字段，不能以当前总库存代替。',
        };
      let selection: Pick<QueryCandidate, 'item' | 'purchase'>[] = [];
      let relevance: Awaited<ReturnType<RelevanceRuns['start']>> | null = null;
      if (query.semantic.length) {
        const runs = new RelevanceRuns();
        relevance = await measured('candidate', () =>
          runs.start(
            deps.accountId,
            query,
            deps.recall,
            checkpoint as RelevanceCheckpoint | undefined,
          ),
        );
        stage = 'judgment';
        began = Date.now();
        const budget = executionBudgetSchema.parse(deps.relevanceBudget ?? {});
        relevance = await runs.advance(
          deps.accountId,
          { runId: relevance.runId, revision: relevance.revision, budget },
          (input, options) =>
            deps.model(input, { ...options, signal: AbortSignal.any([signal, options.signal]) }),
          async (progress) => {
            retained = progress;
            const attempt = progress.attempts.at(-1);
            await event(
              {
                stage: 'judgment',
                outcome:
                  attempt?.outcome === 'running'
                    ? 'started'
                    : attempt?.outcome === 'success'
                      ? 'success'
                      : 'failed',
                durationMs: attempt?.durationMs ?? 0,
                code: attempt?.errorCode ?? null,
                model: attempt?.model ?? null,
                usage: attempt?.usage ?? null,
                completeness: {
                  attempt: attempt?.number,
                  keys: attempt?.keys,
                  evaluated: progress.decisions.length,
                  reservedTokens: progress.reservedTokens,
                },
              },
              progress,
            );
          },
        );
        retained = runs.checkpoint(deps.accountId, relevance.runId);
        // Persist evidence-bound judgments, cumulative costs and completeness before facts.
        await event(
          {
            stage,
            outcome: relevance.completeness.stopReason === null ? 'success' : 'failed',
            durationMs: Date.now() - began,
            code: relevance.lastErrorCode,
            model: relevance.attempts.at(-1)?.model ?? null,
            usage: null,
            completeness: {
              completeness: relevance.completeness,
              coverage: relevance.coverage,
              attempts: relevance.attempts,
              usage: relevance.usage,
              ruleVersion: relevance.ruleVersion,
              promptVersion: relevance.promptVersion,
            },
          },
          retained,
        );
        if (signal.aborted) throw new CandidateQueryError('EXECUTION_ABORTED');
        if (relevance.completeness.stopReason !== null) {
          const stop = relevance.completeness.stopReason;
          return {
            status:
              stop === 'running'
                ? 'incomplete'
                : stop === 'scope_unresolved'
                  ? 'needs_confirmation'
                  : stop,
            result: { relevance, facts: null },
            checkpoint: retained,
            errorCode: relevance.lastErrorCode ?? undefined,
          };
        }
        // A complete evaluation may contain uncertain rows. Only confirmed
        // identities reach the fact readers; uncertainty remains visible below.
        selection = relevance.confirmedSelection;
      } else {
        const source = await measured('candidate', () => deps.recall(query));
        selection = source.rows.map((r) => ({
          item: r.candidate.item,
          purchase: r.candidate.purchase,
        }));
      }
      // No semantic filter means all backend-returned identities, never model-provided IDs.
      const selectedPurchases = selection.flatMap((r) => (r.purchase ? [r.purchase] : []));
      const facts = await measured('facts', async () => {
        const catalog = deps.display ? await deps.display(selection) : undefined;
        const stockInput = stockQuerySchema.parse({
          mode: state.view === 'purchase_remaining' ? 'purchase_remaining' : 'catalog_current',
          query,
          ...(query.subject === 'purchases'
            ? { selectedPurchases }
            : { selectedItems: selection.map((r) => r.item) }),
        });
        if (state.view === 'stock' || state.view === 'purchase_remaining')
          return { ...(await deps.stock(stockInput)), ...(catalog ? { catalog } : {}) };
        const stock = deps.display ? await deps.stock(stockInput) : undefined;
        if (query.subject === 'catalog')
          return {
            items: selection.map((r) => r.item),
            queriedAt: new Date().toISOString(),
            catalog,
            stock,
          };
        const source = await deps.purchases(
          purchaseQuerySchema.parse({ query, selectedPurchases }),
        );
        return {
          items: source.rows,
          summary: summarizeAssistantPurchases(
            source.rows,
            source.scopeCandidateCount,
            'selected_purchases',
          ),
          queriedAt: new Date().toISOString(),
          view: state.view,
          catalog,
          stock,
        };
      });
      return {
        status: relevance?.completeness.uncertain
          ? 'needs_confirmation'
          : selection.length
            ? 'completed'
            : 'no_results',
        result: { relevance, facts },
        checkpoint: retained,
        ...(relevance?.completeness.uncertain
          ? { clarification: '部分记录的语义依据待确认；汇总仅包含已确定记录，待确认项未计入。' }
          : {}),
      };
    } catch (error) {
      const code = safeAssistantCode(error, stage === 'judgment' ? 'MODEL_FAILED' : 'QUERY_FAILED');
      await event(
        {
          stage,
          outcome: 'failed',
          durationMs: Date.now() - began,
          code,
          model: null,
          usage: null,
          completeness: null,
        },
        retained,
      );
      return {
        status: signal.aborted
          ? 'cancelled'
          : code === 'LOCATION_INCOMPLETE'
            ? 'incomplete'
            : code.includes('BUDGET')
              ? 'budget'
              : code.includes('SCOPE_UNRESOLVED') ||
                  code.includes('LOCATION_UNRESOLVED') ||
                  code === 'LOCATION_NEEDS_CLARIFICATION'
                ? 'needs_confirmation'
                : stage === 'judgment'
                  ? 'model_failed'
                  : 'query_failed',
        result: null,
        checkpoint: retained,
        errorCode: code,
      };
    }
  };
}
