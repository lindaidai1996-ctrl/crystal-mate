import { describe, expect, it, vi } from 'vitest';
import baseline from '../../docs/plans/ai-assistant/development-baseline.json';
import { CandidateRuns } from '../../src/lib/ai-assistant/candidate-runs';
import { assistantQuerySchema, type AssistantQuery } from '../../src/lib/ai-assistant/contracts';
import {
  CANDIDATE_RUN_TTL_MS,
  type CandidateDetail,
} from '../../src/lib/ai-assistant/candidate-contracts';

const id = (n: number) => `c${n.toString().padStart(24, '0')}`;
const query: AssistantQuery = assistantQuerySchema.parse({
  version: 'v1',
  subject: 'purchases',
  itemTypes: ['MATERIAL'],
  hard: {
    purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
    distributorIds: baseline.scope.distributorIds,
  },
  semantic: [{ concept: 'material', text: '绿松石', relation: 'is' }],
  ruleVersion: 'v1',
  pagination: { limit: 7 },
});
const rows: CandidateDetail[] = baseline.scopedCandidates.map((r) => ({
  candidate: {
    item: { type: 'MATERIAL', id: r.materialId },
    purchase: { type: 'MATERIAL_PURCHASE', id: r.id },
    evidence: [
      { entity: { type: 'MATERIAL', id: r.materialId }, field: 'name', value: r.name },
      { entity: { type: 'MATERIAL', id: r.materialId }, field: 'aliases', value: r.aliases },
    ],
  },
  code: null,
  batch: null,
  distributor: { type: 'DISTRIBUTOR', id: r.distributorId },
}));
const withCursor = (cursor: unknown, limit = 7) => ({ ...query, pagination: { limit, cursor } });

describe('candidate snapshot traversal', () => {
  it.each([1, 7, 11, 44, 100])(
    'reads all 44 frozen purchase rows without gaps/duplicates at limit %i',
    async (limit) => {
      const runs = new CandidateRuns();
      const load = vi.fn(async () => [...rows].reverse());
      let page = await runs.query('account', { ...query, pagination: { limit } }, load);
      const ids: string[] = [];
      for (;;) {
        ids.push(...page.items.map((r) => r.purchase!.id));
        expect(page.completeness.totalCandidates).toBe(44);
        expect(page.completeness.readCandidates).toBe(ids.length);
        expect(page.completeness.notEvaluated).toBe(ids.length);
        if (!page.nextCursor) break;
        page = await runs.query('account', withCursor(page.nextCursor, limit), load);
      }
      expect(ids).toEqual(rows.map((r) => r.candidate.purchase!.id).sort());
      expect(new Set(ids).size).toBe(44);
      expect(page.completeness).toMatchObject({
        traversal: 'complete',
        evaluation: 'not_started',
        unreadCandidates: 0,
        uniqueCatalogItems: 44,
        stopReason: 'running',
      });
      expect(load).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves distinct purchases of one catalog item and stable type order', async () => {
    const runs = new CandidateRuns();
    const same = structuredClone(rows[0]);
    same.candidate.purchase!.id = id(99);
    const product: CandidateDetail = {
      candidate: {
        item: { type: 'PRODUCT', id: id(2) },
        purchase: { type: 'PRODUCT_PURCHASE', id: id(1) },
        evidence: [],
      },
      code: 'P001',
      batch: null,
      distributor: null,
    };
    const page = await runs.query(
      'a',
      { ...query, itemTypes: ['PRODUCT', 'MATERIAL'], pagination: { limit: 100 } },
      async () => [product, rows[0], same],
    );
    expect(page.items.map((r) => r.purchase!.type)).toEqual([
      'MATERIAL_PURCHASE',
      'MATERIAL_PURCHASE',
      'PRODUCT_PURCHASE',
    ]);
    expect(page.completeness).toMatchObject({ totalCandidates: 3, uniqueCatalogItems: 2 });
  });
  it('returns a complete empty scope, without claiming semantic results for failures', async () => {
    const runs = new CandidateRuns();
    const empty = await runs.query('a', query, async () => []);
    expect(empty).toMatchObject({
      items: [],
      nextCursor: null,
      completeness: {
        totalCandidates: 0,
        traversal: 'complete',
        evaluation: 'complete',
        stopReason: null,
      },
    });
    await expect(
      runs.query('a', query, async () => {
        throw new Error('DB_FAILED');
      }),
    ).rejects.toThrow('DB_FAILED');
  });
  it('retries a page idempotently and permits changing page size or reordering ID sets', async () => {
    const runs = new CandidateRuns();
    const load = vi.fn(async () => rows);
    const first = await runs.query('a', query, load);
    const next = withCursor(first.nextCursor, 2);
    const page = await runs.query('a', next, load);
    expect(await runs.query('a', next, load)).toEqual(page);
    const reordered = {
      ...next,
      hard: { ...query.hard, distributorIds: [...query.hard.distributorIds!].reverse() },
    };
    expect((await runs.query('a', reordered, load)).items).toEqual(page.items);
    expect(page.completeness.readCandidates).toBe(9);
  });
  it('keeps cumulative unique counts when replaying an earlier cursor after completion', async () => {
    const runs = new CandidateRuns();
    const load = async () => rows;
    const first = await runs.query('a', query, load);
    await runs.query('a', withCursor(first.nextCursor, 100), load);
    const replay = await runs.query('a', withCursor(first.nextCursor, 2), load);
    expect(replay.completeness).toMatchObject({
      readCandidates: 44,
      uniqueCatalogItems: 44,
      unreadCandidates: 0,
      traversal: 'complete',
    });
    expect(replay.nextCursor).toBeNull();
  });
  it('rejects unknown, expired, evicted and cross-account runs', async () => {
    let now = 0;
    const runs = new CandidateRuns(() => now);
    const load = async () => rows;
    const first = await runs.query('a', query, load);
    const next = withCursor(first.nextCursor);
    await expect(runs.query('b', next, load)).rejects.toThrow('RUN_RESTART_REQUIRED');
    await expect(new CandidateRuns().query('a', next, load)).rejects.toThrow(
      'RUN_RESTART_REQUIRED',
    );
    now = CANDIDATE_RUN_TTL_MS;
    await expect(runs.query('a', next, load)).rejects.toThrow('RUN_RESTART_REQUIRED');
    const old = await runs.query('a', query, load);
    for (let i = 0; i < 4; i++) await runs.query('a', query, load);
    await expect(runs.query('a', withCursor(old.nextCursor), load)).rejects.toThrow(
      'RUN_RESTART_REQUIRED',
    );
  });
  it('rejects scope tampering, unissued positions, final-row continuation and foreign runs', async () => {
    const runs = new CandidateRuns();
    const load = async () => rows;
    const first = await runs.query('a', query, load);
    const cursor = first.nextCursor!;
    await expect(runs.query('a', { ...withCursor(cursor), semantic: [] }, load)).rejects.toThrow(
      'CURSOR_SCOPE_MISMATCH',
    );
    await expect(
      runs.query('a', withCursor({ ...cursor, scopeKey: 'a'.repeat(64) }), load),
    ).rejects.toThrow('CURSOR_SCOPE_MISMATCH');
    for (const after of [
      rows[0].candidate.item,
      rows.at(-1)!.candidate.purchase,
      { type: 'MATERIAL_PURCHASE', id: id(7) },
    ])
      await expect(runs.query('a', withCursor({ ...cursor, after }), load)).rejects.toThrow();
    const foreign = await runs.query('a', { ...query, semantic: [] }, load);
    await expect(
      runs.query('a', withCursor({ ...cursor, runId: foreign.runId }), load),
    ).rejects.toThrow('CURSOR_SCOPE_MISMATCH');
  });
  it('freezes source fields and protects retained snapshots from caller mutation', async () => {
    const runs = new CandidateRuns();
    const source = structuredClone(rows);
    const first = await runs.query('a', query, async () => source);
    source[0].candidate.evidence[0].value = 'changed';
    first.items[0].evidence[0].value = 'tampered';
    const details = runs.details('a', {
      runId: first.runId,
      candidates: [{ item: first.items[0].item, purchase: first.items[0].purchase }],
    });
    expect(details.items[0].candidate.evidence[0].value).not.toBe('changed');
    expect(details.items[0].candidate.evidence[0].value).not.toBe('tampered');
  });
  it('details are limited to already-read exact identities, with duplicate and actor checks', async () => {
    const runs = new CandidateRuns();
    const first = await runs.query('a', query, async () => rows);
    const identity = (r: CandidateDetail) => ({
      item: r.candidate.item,
      purchase: r.candidate.purchase,
    });
    const input = { runId: first.runId, candidates: [identity(rows[0])] };
    expect(runs.details('a', input).items[0]).toEqual(rows[0]);
    expect(() => runs.details('b', input)).toThrow('RUN_RESTART_REQUIRED');
    expect(() => runs.details('a', { ...input, candidates: [identity(rows.at(-1)!)] })).toThrow(
      'DETAIL_OUTSIDE_READ_SCOPE',
    );
    expect(() =>
      runs.details('a', { ...input, candidates: [...input.candidates, ...input.candidates] }),
    ).toThrow('DETAIL_OUTSIDE_READ_SCOPE');
  });
  it('rejects oversized snapshots and duplicate identities', async () => {
    const runs = new CandidateRuns();
    await expect(
      runs.query('a', query, async () => Array.from({ length: 5001 }, () => rows[0])),
    ).rejects.toThrow('CANDIDATE_BUDGET_EXCEEDED');
    await expect(runs.query('a', query, async () => [rows[0], rows[0]])).rejects.toThrow(
      'DUPLICATE_CANDIDATE',
    );
  });
  it('supports catalog traversal without invented purchase identities', async () => {
    const runs = new CandidateRuns();
    const page = await runs.query(
      'a',
      { ...query, subject: 'catalog', hard: {}, pagination: { limit: 1 } },
      async () =>
        rows.slice(0, 2).map((r) => ({ ...r, candidate: { ...r.candidate, purchase: null } })),
    );
    expect(page.completeness.countBasis).toBe('catalog');
    expect(page.items[0].purchase).toBeNull();
    expect(page.nextCursor!.after.type).toBe('MATERIAL');
  });
});
