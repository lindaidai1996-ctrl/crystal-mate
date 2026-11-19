import { expect, it, vi } from 'vitest';
import { createAssistantFacts } from '@/lib/ai-assistant/orchestration-facts';
import { annotateRecall } from '@/lib/ai-assistant/recall-data';
import { candidateKey } from '@/lib/ai-assistant/contracts';
import { purchaseEntrySchema } from '@/lib/ai-assistant/purchase-contracts';
import { summarizeAssistantPurchases } from '@/lib/ai-assistant/purchase-summary';
import { assistantResultView } from '@/lib/ai-assistant/result-view';
import { factSetFromResult, factPreview } from '@/lib/ai-assistant/fact-sets';
import { semanticQuery, frozenDetails, fixtureId } from '../fixtures/ai-assistant-semantics';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';

const details = frozenDetails
  .filter((row) => baseline.goldenCase.includedEntryIds.includes(row.candidate.purchase!.id))
  .slice(0, 2);
const rows = details.map(({ candidate }) => {
  const source = baseline.scopedCandidates.find((row) => row.id === candidate.purchase!.id)!;
  return purchaseEntrySchema.parse({
    item: candidate.item,
    purchase: candidate.purchase,
    name: source.name,
    code: null,
    batch: { id: fixtureId(90), name: 'test batch', receivedAt: source.date },
    distributor: { id: source.distributorId, name: 'test distributor' },
    quantity: source.quantity,
    unit: source.unit,
    unitPrice: null,
    amount: source.amount,
    amountBasis: 'recorded_total',
    currency: 'CNY',
    currencyBasis: 'business_default',
  });
});

it('reads confirmed and uncertain purchases separately, with independent exact summaries', async () => {
  const purchases = vi.fn(async (input) => ({
    rows: rows.filter((row) =>
      input.selectedPurchases.some((p: { id: string }) => p.id === row.purchase.id),
    ),
    candidates: [],
    scopeCandidateCount: 2,
  }));
  const result = await createAssistantFacts({
    accountId: 'synthetic-verifier',
    recall: async () => annotateRecall(details, semanticQuery),
    purchases,
    stock: vi.fn(),
    model: async ({ candidates }) => ({
      model: 'synthetic',
      usage: null,
      output: {
        decisions: candidates.map((candidate) => ({
          key: candidate.key,
          status: candidate.key === candidateKey(details[0].candidate) ? 'include' : 'uncertain',
          evidenceIndexes: [0],
          reason: '测试：需核对本体材质',
        })),
      },
    }),
  })({ query: semanticQuery, view: 'details' }, null, new AbortController().signal, async () => {});
  expect(result.status).toBe('needs_confirmation');
  expect(purchases).toHaveBeenCalledTimes(2);
  expect(purchases.mock.calls.map(([input]) => input.selectedPurchases)).toEqual(
    details.map((row) => [row.candidate.purchase]),
  );
  const view = assistantResultView(result.result, false)!;
  expect(view.purchases).toEqual([rows[0]]);
  expect(view.summary!.totals.amounts[0].knownAmount).toBe(rows[0].amount);
  expect(view.uncertainPurchases!.items).toEqual([
    { ...rows[1], reason: '模型与 v1 规则存在分歧或字段冲突，需确认；测试：需核对本体材质' },
  ]);
  expect(view.uncertainPurchases!.summary.totals.amounts[0].knownAmount).toBe(rows[1].amount);
  const set = factSetFromResult(result.result, { query: semanticQuery, view: 'details' });
  expect(set.rows.map((row) => row.id)).toEqual([rows[0].purchase.id]);
  expect(set.complete).toBe(false);
  expect(set.warnings.join('')).toContain(`待确认记录的已知金额合计 ${rows[1].amount} CNY`);
  expect(assistantResultView(result.result, true)!.uncertainPurchases).toBeUndefined();
  expect(factPreview(set, true).warnings).toEqual(['部分记录待确认或查询未完成。']);
});

it('retains unknown pending amounts without treating them as zero or exposing pending facts in privacy mode', () => {
  const uncertain = {
    ...rows[1],
    amount: null,
    amountBasis: 'unknown' as const,
    reason: '材质待核对',
  };
  const raw = {
    facts: {
      items: [rows[0]],
      summary: summarizeAssistantPurchases([rows[0]], 2, 'selected_purchases'),
      queriedAt: '2026-11-19T02:00:00.000Z',
    },
    uncertainPurchases: {
      items: [uncertain],
      summary: summarizeAssistantPurchases(
        [{ ...rows[1], amount: null, amountBasis: 'unknown' }],
        2,
        'selected_purchases',
      ),
    },
  };
  const view = assistantResultView(raw, false)!;
  expect(view.uncertainPurchases!.items[0].amount).toBeNull();
  expect(view.uncertainPurchases!.summary.totals.amounts[0].unknownAmountEntryCount).toBe(1);
  const privateView = assistantResultView(raw, true)!;
  expect(privateView.uncertainPurchases).toBeUndefined();
  expect(JSON.stringify(privateView)).not.toContain('材质待核对');
  expect(JSON.stringify(privateView)).not.toContain(rows[1].name);
});
