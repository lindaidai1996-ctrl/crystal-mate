import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { transformFactSet } from '@/lib/ai-assistant/fact-operations';
import { factPreview, type FactRow, type FactSet } from '@/lib/ai-assistant/fact-sets';
import { answerDocumentView, renderAnswerDocument } from '@/lib/ai-assistant/answer-document';
import { answerIntentSchema, nextActionSchema } from '@/lib/ai-assistant/composable-contracts';
import { prepareAgentExecution, runComposableAssistant } from '@/lib/ai-assistant/composable-agent';
import type { Execution, FactExecutor } from '@/lib/ai-assistant/orchestrator';
import type { ToolModel } from '@/lib/ai-assistant/orchestration-model';
import { purchaseEntrySchema } from '@/lib/ai-assistant/purchase-contracts';
import { summarizeAssistantPurchases } from '@/lib/ai-assistant/purchase-summary';
import { fixtureId } from '../fixtures/ai-assistant-semantics';

const item = `MATERIAL:${fixtureId(1)}`;
const row = (id: string, overrides: Partial<FactRow['values']> = {}): FactRow => ({
  id,
  values: {
    item,
    purchase: `MATERIAL_PURCHASE:${id}`,
    name: '1.5mmS925方形碎银',
    specification: '1.5 × 1.5 × 1.5 mm',
    date: '2026-11-14',
    distributor: '明发',
    distributorId: fixtureId(3),
    quantity: '2.00',
    unit: 'GRAM',
    amount: '20.00',
    unitPrice: '10.00',
    currency: 'CNY',
    stock: '3.00',
    stockUnknown: '0',
    ...overrides,
  },
  href: `/admin/materials/${fixtureId(1)}/batches/${id}`,
  sources: [id],
});
const set = (rows = [row('p1')], complete = true): FactSet => ({
  id: randomUUID(),
  rows,
  complete,
  observations: ['2026-11-18T00:00:00.000Z'],
  warnings: [],
  parents: [],
  query: {},
});
const names = answerIntentSchema.parse({ format: 'names', fields: ['name'], concise: true });
const data = (s: FactSet, fields = ['name']) => ({
  type: 'data' as const,
  format: 'names' as const,
  set: s.id,
  fields: fields as ['name'],
});

describe('composable factual operations', () => {
  it('joins verified stock by identity and refuses an ambiguous right-hand match', () => {
    const purchases = set([row('p1', { stock: null })]);
    const stock = set([row('s1', { stock: '7.00' })]);
    const operation = {
      op: 'join' as const,
      other: stock.id,
      keys: ['item' as const],
      fields: ['stock' as const],
    };
    const joined = transformFactSet(purchases, [operation], [purchases, stock]);
    expect(joined.rows[0].values).toMatchObject({ amount: '20.00', stock: '7.00' });
    expect(joined.parents).toContain(stock.id);
    expect(() =>
      transformFactSet(purchases, [{ ...operation, keys: ['unit'] }], [purchases, stock]),
    ).toThrow('FACT_JOIN_IDENTITY_REQUIRED');
    expect(() =>
      transformFactSet(purchases, [{ ...operation, keys: ['distributorId'] }], [purchases, stock]),
    ).toThrow('FACT_JOIN_ITEM_REQUIRED');
    stock.rows.push(row('s2'));
    expect(() => transformFactSet(purchases, [operation], [purchases, stock])).toThrow(
      'FACT_JOIN_AMBIGUOUS',
    );
  });
  it('never groups same-name distributors or items as one identity', () => {
    const s = set([
      row('p1'),
      row('p2', { distributorId: fixtureId(9), item: `MATERIAL:${fixtureId(8)}` }),
    ]);
    expect(
      transformFactSet(
        s,
        [{ op: 'group', keys: ['distributor'], metric: 'amount', calculation: 'sum' }],
        [s],
      ).rows,
    ).toHaveLength(2);
    expect(
      transformFactSet(
        s,
        [{ op: 'group', keys: ['name'], metric: 'quantity', calculation: 'sum' }],
        [s],
      ).rows,
    ).toHaveLength(2);
  });
  it('deduplicates catalog identities, preserves same-name different items and chooses the correct link', () => {
    const s = set([row('p1'), row('p2'), row('p3', { item: `MATERIAL:${fixtureId(2)}` })]);
    const doc = renderAnswerDocument([data(s)], [s], names, false);
    const block = doc.blocks[0];
    expect(block.type).toBe('data');
    if (block.type !== 'data') throw Error();
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0].cells[0].href).toBe(`/admin/materials/${fixtureId(1)}`);
    expect(block.rows[1].cells[0].href).toContain('/batches/p3');
    expect(Object.keys(block)).not.toContain('amount');
    expect(JSON.stringify(doc)).not.toContain('20.00');
  });
  it('retains the single selected purchase batch URL', () => {
    const s = set();
    const doc = renderAnswerDocument([data(s)], [s], names, false);
    expect(JSON.stringify(doc)).toContain('/batches/p1');
  });
  it('never sums repeated catalog stock once per purchase and keeps unknown stock unknown', () => {
    const s = set([
      row('p1'),
      row('p2'),
      row('p3', { item: 'MATERIAL:other', stock: null, stockUnknown: '1' }),
    ]);
    const result = transformFactSet(
      s,
      [{ op: 'group', keys: ['unit'], metric: 'stock', calculation: 'sum' }],
      [s],
    );
    expect(result.rows[0].values).toMatchObject({ stock: '3.00', unknown: '1' });
  });
  it('isolates currency and units in grouping, ranking and top N', () => {
    const s = set([
      row('p1'),
      row('p2', { currency: 'USD', unit: 'BEAD', amount: '100.00' }),
      row('p3', { amount: '40.00' }),
    ]);
    const result = transformFactSet(
      s,
      [
        { op: 'sort', field: 'amount', direction: 'desc' },
        { op: 'take', count: 1 },
      ],
      [s],
    );
    expect(result.rows.map((r) => r.values.amount)).toEqual(['40.00', '100.00']);
    const grouped = transformFactSet(
      s,
      [{ op: 'group', keys: ['distributorId'], metric: 'amount', calculation: 'sum' }],
      [s],
    );
    expect(grouped.rows.map((r) => r.values.amount)).toEqual(['60.00', '100.00']);
  });
  it('distinguishes missing values, zero stock and exclusions', () => {
    const s = set([row('p1', { unitPrice: null }), row('p2', { stock: '0.00' }), row('p3')]);
    expect(
      transformFactSet(
        s,
        [{ op: 'filter', field: 'unitPrice', relation: 'missing' }],
        [s],
      ).rows.map((r) => r.id),
    ).toEqual(['p1']);
    expect(
      transformFactSet(s, [{ op: 'filter', field: 'stock', relation: 'gt', value: '0' }], [s]).rows,
    ).toHaveLength(2);
    expect(() =>
      transformFactSet(s, [{ op: 'filter', field: 'name', relation: 'gt', value: '0' }], [s]),
    ).toThrow('FACT_NUMERIC_FIELD_REQUIRED');
  });
  it('keeps comparable ranking partitions when sorting and taking happen in separate tool calls', () => {
    const s = set([
      row('p1', { amount: '10.00' }),
      row('p2', { amount: '20.00' }),
      row('p3', { amount: '100.00', currency: 'USD' }),
    ]);
    const sorted = transformFactSet(s, [{ op: 'sort', field: 'amount', direction: 'desc' }], [s]);
    const top = transformFactSet(sorted, [{ op: 'take', count: 1 }], [s, sorted]);
    expect(top.rows.map((r) => [r.values.currency, r.values.amount])).toEqual([
      ['CNY', '20.00'],
      ['USD', '100.00'],
    ]);
  });
  it('compares full periods and marks unknown baselines or division by zero', () => {
    const before = set([row('p1', { amount: '0.00' })]),
      after = set([row('p2', { amount: '5.00' })]);
    const result = transformFactSet(
      after,
      [{ op: 'compare', other: before.id, keys: ['item'], metric: 'amount', mode: 'totals' }],
      [before, after],
    );
    expect(result.rows[0].values).toMatchObject({
      baseline: '0.00',
      current: '5.00',
      difference: '5.00',
      percent: null,
    });
    before.rows[0].values.amount = null;
    expect(
      transformFactSet(
        after,
        [{ op: 'compare', other: before.id, keys: ['item'], metric: 'amount', mode: 'totals' }],
        [before, after],
      ).rows[0].values.difference,
    ).toBeNull();
    before.complete = false;
    expect(() =>
      transformFactSet(
        after,
        [{ op: 'compare', other: before.id, keys: ['item'], metric: 'amount', mode: 'totals' }],
        [before, after],
      ),
    ).toThrow('FACT_COMPARISON_REQUIRES_COMPLETE');
  });
  it('labels partial known totals even when requested fields omit the unknown counter', () => {
    const s = set([row('p1'), row('p2', { amount: null })]);
    const grouped = transformFactSet(
      s,
      [{ op: 'group', keys: ['currency'], metric: 'amount', calculation: 'sum' }],
      [s],
    );
    const doc = renderAnswerDocument(
      [{ type: 'data', set: grouped.id, format: 'table', fields: ['amount'] }],
      [s, grouped],
      answerIntentSchema.parse({ fields: ['amount'], strictFields: true }),
      false,
    );
    expect(doc.blocks[0].type === 'data' && doc.blocks[0].rows[0].cells[0].text).toBe(
      '已知部分：20.00',
    );
    const stock = set([row('p1', { stockUnknown: '1' })]);
    const stockDoc = renderAnswerDocument(
      [{ type: 'data', set: stock.id, format: 'list', fields: ['stock'] }],
      [stock],
      answerIntentSchema.parse({ fields: ['stock'], strictFields: true }),
      false,
    );
    expect(stockDoc.blocks[0].type === 'data' && stockDoc.blocks[0].rows[0].cells[0].text).toBe(
      '已知部分：3.00',
    );
  });
  it('compares latest prices only with compatible identities, specifications, currency and units', () => {
    const before = set([row('p1')]),
      after = set([row('p2', { unitPrice: '12.00' })]);
    const op = {
      op: 'compare',
      other: before.id,
      keys: ['item'],
      metric: 'unitPrice',
      mode: 'latest_price',
    } as const;
    expect(
      transformFactSet(after, [{ ...op, keys: [...op.keys] }], [before, after]).rows[0].values,
    ).toMatchObject({ difference: '2.00', percent: '20.00' });
    after.rows.push(row('p3', { unitPrice: '13.00' }));
    expect(
      transformFactSet(after, [{ ...op, keys: [...op.keys] }], [before, after]).rows[0].values
        .difference,
    ).toBeNull();
    after.rows = [row('p2', { specification: null })];
    expect(
      transformFactSet(after, [{ ...op, keys: [...op.keys] }], [before, after]).rows.every(
        (r) => r.values.difference === null,
      ),
    ).toBe(true);
  });
  it('does not let models fabricate numbers, links, records or extra fields in answers', () => {
    const s = set();
    expect(() => renderAnswerDocument([data(s, ['amount'])], [s], names, false)).toThrow(
      'ANSWER_FIELDS_MISMATCH',
    );
    expect(() =>
      renderAnswerDocument(
        [{ type: 'paragraph', segments: [{ text: '总共999元' }], sources: [s.id] }],
        [s],
        answerIntentSchema.parse({}),
        false,
      ),
    ).toThrow('ANSWER_LITERAL_FACT');
    expect(() =>
      renderAnswerDocument(
        [
          {
            type: 'paragraph',
            segments: [{ set: s.id, row: 'invented', field: 'amount' }],
            sources: [s.id],
          },
        ],
        [s],
        answerIntentSchema.parse({}),
        false,
      ),
    ).toThrow('ANSWER_REFERENCE_INVALID');
    expect(() =>
      renderAnswerDocument([data({ ...s, id: randomUUID() })], [s], names, false),
    ).toThrow('FACT_REFERENCE_INVALID');
  });
  it('keeps whole result data independently of bounded model previews and preserves necessary warnings', () => {
    const s = set(
      Array.from({ length: 75 }, (_, i) => row(`p${i}`, { item: `MATERIAL:${fixtureId(i + 1)}` })),
      false,
    );
    s.warnings = ['部分记录待确认，以下只包含已确定记录。', '采购币种采用 CNY 业务默认值。'];
    expect(factPreview(s, false).rows).toHaveLength(50);
    const doc = renderAnswerDocument([data(s)], [s], names, false);
    expect(doc.warnings).toEqual([s.warnings[0]]);
    if (doc.blocks[0].type !== 'data') throw Error();
    expect(doc.blocks[0].rows).toHaveLength(75);
    expect(answerDocumentView(doc, true)).toBeNull();
    expect(JSON.stringify(factPreview(s, true))).not.toContain('明发');
    expect(JSON.stringify(factPreview(s, true))).not.toContain('10.00');
  });
});

const purchase = (amount = '20.00') =>
  purchaseEntrySchema.parse({
    item: { type: 'MATERIAL', id: fixtureId(1) },
    purchase: { type: 'MATERIAL_PURCHASE', id: fixtureId(2) },
    name: '1.5mmS925方形碎银',
    code: null,
    batch: { id: fixtureId(3), name: '测试批次', receivedAt: '2026-11-14' },
    distributor: { id: fixtureId(4), name: '明发' },
    quantity: '2.00',
    unit: 'GRAM',
    unitPrice: '10.00',
    amount,
    amountBasis: 'recorded_total',
    currency: 'CNY',
    currencyBasis: 'business_default',
  });
const business: FactExecutor = async () => ({
  status: 'completed',
  checkpoint: null,
  result: {
    facts: {
      items: [purchase()],
      summary: summarizeAssistantPurchases([purchase()], 1, 'selected_purchases'),
      queriedAt: '2026-11-18T00:00:00.000Z',
    },
  },
});
const query = {
  action: 'query',
  patch: {
    subject: 'purchases',
    itemTypes: ['MATERIAL'],
    hard: {},
    semantic: {},
    clarification: null,
  },
  intent: names,
};
function modelSequence(actions: ((input: Parameters<ToolModel>[0]) => unknown)[]): ToolModel {
  let i = 0;
  return vi.fn(async (input) => ({
    id: `call${i}`,
    name: 'next_action',
    arguments: JSON.stringify(actions[i++](input)),
    model: 'synthetic',
    usage: null,
  }));
}
function lastSet(input: Parameters<ToolModel>[0]) {
  const receipt = JSON.parse(input.messages.findLast((m) => m.role === 'tool')!.content!);
  return receipt.id as string;
}
function run(
  model: ToolModel,
  overrides: Partial<Parameters<typeof runComposableAssistant>[0]> = {},
) {
  return runComposableAssistant({
    execution: prepareAgentExecution(null, null, false),
    text: '仅名称',
    model,
    facts: business,
    save: async () => {},
    signal: new AbortController().signal,
    ...overrides,
  });
}

describe('composable assistant execution', () => {
  it('lets the model correct schema errors without issuing an invalid query', async () => {
    const facts = vi.fn(business);
    const result = await run(
      modelSequence([
        () => ({ ...query, patch: { ...query.patch, hard: { month: 'this_month' } } }),
        () => query,
        (input) => ({
          action: 'answer',
          blocks: [{ type: 'data', set: lastSet(input), format: 'names', fields: ['name'] }],
        }),
      ]),
      { facts },
    );
    expect(result.status).toBe('completed');
    expect(facts).toHaveBeenCalledOnce();
    expect(result.calls).toBe(3);
    expect(result.trace.some((t) => t.code === 'TOOL_ARGUMENT_INVALID')).toBe(true);
  });
  it('clears old conditions, presentation and transforms when resetting the question', async () => {
    const previous = prepareAgentExecution(null, null, false);
    const first = await run(
      modelSequence([
        () => query,
        (input) => ({ action: 'answer', blocks: [data({ id: lastSet(input) } as FactSet)] }),
      ]),
      { execution: previous },
    );
    first.state!.query.hard.location = { text: '旧地点', kind: 'exact_place' };
    first.state!.task!.operations = [{ op: 'take', count: 1 }];
    const result = await run(
      modelSequence([
        () => ({ action: 'query', reset: true, patch: query.patch }),
        (input) => ({
          action: 'answer',
          blocks: [
            {
              type: 'data',
              set: lastSet(input),
              format: 'list',
              fields: ['name', 'quantity', 'unit'],
            },
          ],
        }),
      ]),
      { execution: prepareAgentExecution(null, first.state, false) },
    );
    expect(result.state!.query.hard.location).toBeUndefined();
    expect(result.state!.task!.operations).toEqual([]);
    expect(result.state!.task!.intent.format).toBe('list');
  });
  it('queries then produces only clickable names through the real answer path', async () => {
    const result = await run(
      modelSequence([
        () => query,
        (input) => ({
          action: 'answer',
          blocks: [{ type: 'data', set: lastSet(input), format: 'names', fields: ['name'] }],
        }),
      ]),
    );
    expect(result.status).toBe('completed');
    expect(result.calls).toBe(2);
    expect(JSON.stringify(result.answer)).toContain(`/batches/${fixtureId(2)}`);
    expect(result.answer!.blocks).toHaveLength(1);
    expect(result.state!.task!.intent).toEqual(names);
  });
  it('falls back to requested fields when generated answer validation fails', async () => {
    const result = await run(
      modelSequence([
        () => query,
        () => ({
          action: 'answer',
          blocks: [{ type: 'paragraph', segments: [{ text: '999元' }], sources: [] }],
        }),
        () => ({
          action: 'answer',
          blocks: [{ type: 'paragraph', segments: [{ text: '999元' }], sources: [] }],
        }),
      ]),
    );
    expect(result.status).toBe('completed');
    expect(result.answer!.fallback).toBe(true);
    expect(JSON.stringify(result.answer)).not.toContain('999');
  });
  it('keeps query failures and incomplete queries distinct from empty results', async () => {
    for (const status of ['query_failed', 'incomplete', 'budget', 'needs_confirmation'] as const) {
      const result = await run(modelSequence([() => query]), {
        facts: async () => ({ status, result: null, checkpoint: null }),
      });
      expect(result.status).toBe(status);
      expect(result.answer).toBeNull();
    }
  });
  it('uses the primary query for a fallback after reading a comparison collection', async () => {
    let reads = 0;
    const invalidAnswer = () => ({
      action: 'answer',
      blocks: [{ type: 'paragraph', segments: [{ text: '999元' }], sources: [] }],
    });
    const result = await run(
      modelSequence([
        () => query,
        () => ({ ...query, purpose: 'comparison' }),
        invalidAnswer,
        invalidAnswer,
      ]),
      {
        facts: async () => {
          const p = { ...purchase(), name: reads++ === 0 ? '主查询货品' : '对照查询货品' };
          return {
            status: 'completed',
            checkpoint: null,
            result: {
              facts: {
                items: [p],
                summary: summarizeAssistantPurchases([p], 1, 'selected_purchases'),
                queriedAt: '2026-11-18T00:00:00.000Z',
              },
            },
          };
        },
      },
    );
    expect(result.answer!.fallback).toBe(true);
    expect(JSON.stringify(result.answer)).toContain('主查询货品');
    expect(JSON.stringify(result.answer)).not.toContain('对照查询货品');
  });
  it('retains expressions but replaces only the requested date on a follow-up', async () => {
    const first = await run(
      modelSequence([
        () => query,
        (input) => ({
          action: 'answer',
          blocks: [{ type: 'data', set: lastSet(input), format: 'names', fields: ['name'] }],
        }),
      ]),
    );
    const result = await run(
      modelSequence([
        () => ({
          action: 'query',
          patch: {
            hard: {},
            semantic: {},
            subject: 'purchases',
            itemTypes: ['MATERIAL'],
            month: 'previous_month',
            clarification: null,
          },
        }),
        (input) => ({
          action: 'answer',
          blocks: [{ type: 'data', set: lastSet(input), format: 'names', fields: ['name'] }],
        }),
      ]),
      {
        execution: prepareAgentExecution(null, first.state, false),
        now: () => new Date('2026-11-18T00:00:00Z'),
      },
    );
    expect(result.state!.query.hard.purchaseDate).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(result.state!.task!.intent).toEqual(names);
  });
  it('rebuilds fresh facts and keeps original collection IDs and accumulated cost when continuing', async () => {
    const partial = await run(modelSequence([() => query]), { budget: { maxCalls: 1 } });
    expect(partial.status).toBe('budget');
    const oldId = partial.agent!.activeSet;
    const fresh = vi.fn(async () => {
      const p = purchase('30.00');
      return {
        status: 'completed' as const,
        checkpoint: null,
        result: {
          facts: {
            items: [p],
            summary: summarizeAssistantPurchases([p], 1, 'selected_purchases'),
            queriedAt: '2026-11-18T01:00:00.000Z',
          },
        },
      };
    });
    const result = await run(
      modelSequence([
        () => ({
          action: 'answer',
          blocks: [{ type: 'data', set: oldId, format: 'names', fields: ['name'] }],
        }),
      ]),
      {
        execution: prepareAgentExecution(partial, partial.state, false),
        facts: fresh,
        budget: { maxCalls: 1 },
      },
    );
    expect(result.calls).toBe(2);
    expect(fresh).toHaveBeenCalledOnce();
    expect(result.answer!.observations).toContain('2026-11-18T01:00:00.000Z');
    expect(result.agent!.sets[0].rows[0].values.amount).toBe('30.00');
  });
  it('removes protected history and facts before model input and blocks private semantic model calls', async () => {
    const model = modelSequence([
      () => query,
      (input) => ({
        action: 'answer',
        blocks: [{ type: 'data', set: lastSet(input), format: 'names', fields: ['name'] }],
      }),
    ]);
    const result = await run(model, {
      execution: prepareAgentExecution(null, null, true, [
        { role: 'user', text: 'private-cost-SECRET' },
      ]),
    });
    const payload = JSON.stringify(vi.mocked(model).mock.calls);
    expect(payload).not.toContain('private-cost-SECRET');
    expect(payload).not.toContain('明发');
    expect(payload).not.toContain('10.00');
    expect(result.answer!.blocks).toHaveLength(0);
    const facts = vi.fn(business);
    const blocked = await run(
      modelSequence([
        () => ({
          ...query,
          patch: {
            subject: 'purchases',
            itemTypes: ['MATERIAL'],
            hard: {},
            semantic: { material: [{ concept: 'material', text: '银', relation: 'is' }] },
            clarification: null,
          },
        }),
      ]),
      {
        execution: prepareAgentExecution(null, null, true),
        facts,
      },
    );
    expect(blocked.status).toBe('needs_confirmation');
    expect(facts).not.toHaveBeenCalled();
  });
  it('reserves cost on model failure and rejects unregistered tools and client identities', async () => {
    const result = await run(async () => {
      throw Error('private-provider-detail');
    });
    expect(result.status).toBe('model_failed');
    expect(result.calls).toBe(1);
    expect(result.reservedTokens).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('private-provider-detail');
    expect(() => nextActionSchema.parse({ ...query, accountId: 'foreign' })).toThrow();
    const bad = await run(async () => ({
      name: 'sql',
      id: 'x',
      arguments: '{}',
      model: 'mock',
      usage: null,
    }));
    expect(bad.errorCode).toBe('TOOL_NOT_ALLOWED');
  });
  it('cancels ignored-signal work and prevents late progress from mutating execution', async () => {
    const controller = new AbortController();
    let callback!: Parameters<FactExecutor>[3];
    const snapshots: Execution[] = [];
    const pending = run(modelSequence([() => query]), {
      signal: controller.signal,
      facts: async (_state, _checkpoint, _signal, progress) => {
        callback = progress;
        return new Promise(() => {});
      },
      save: async (e) => {
        snapshots.push(structuredClone(e));
      },
    });
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    const count = snapshots.length;
    await expect(
      callback({
        stage: 'facts',
        outcome: 'success',
        durationMs: 1,
        model: null,
        usage: null,
        code: null,
        completeness: null,
      }),
    ).rejects.toThrow();
    expect(snapshots).toHaveLength(count);
  });
});
