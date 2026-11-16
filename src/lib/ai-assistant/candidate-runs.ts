import { createHash, randomUUID } from 'node:crypto';
import {
  assistantQuerySchema,
  candidateKey,
  candidatePageSchema,
  type AssistantQuery,
  type CandidatePage,
} from './contracts';
import {
  CANDIDATE_LIMIT,
  CANDIDATE_RUN_TTL_MS,
  CandidateQueryError,
  candidateDetailSchema,
  candidateDetailsQuerySchema,
  candidateDetailsResultSchema,
  type CandidateDetail,
} from './candidate-contracts';

// Canonicalize object keys and set-like arrays. Pagination is transport state,
// not part of the business scope. Semantic conditions remain bound to this run.
function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function scopeKey(accountId: string, query: AssistantQuery, binding?: unknown) {
  const { pagination: _pagination, ...scope } = query;
  void _pagination;
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({ accountId, scope, ...(binding === undefined ? {} : { binding }) }),
      ),
    )
    .digest('hex');
}
type Run<T> = {
  data?: T;
  accountId: string;
  scopeKey: string;
  queriedAt: string;
  expires: number;
  rows: CandidateDetail[];
  issued: Map<string, number>;
  read: number;
};

// Process-local immutable snapshots: no cross-request DB snapshot is claimed.
// Eviction/restart/expiry requires a new run, never a silent live-query fallback.
export class CandidateRuns<T = undefined> {
  private runs = new Map<string, Run<T>>();
  constructor(private readonly now: () => number = Date.now) {}

  private prune() {
    for (const [id, run] of this.runs) if (run.expires <= this.now()) this.runs.delete(id);
  }
  private get(runId: string, accountId: string) {
    this.prune();
    const run = this.runs.get(runId);
    if (!run || run.accountId !== accountId) throw new CandidateQueryError('RUN_RESTART_REQUIRED');
    return run;
  }
  async query(
    accountId: string,
    input: unknown,
    load: (query: AssistantQuery) => Promise<CandidateDetail[]>,
  ): Promise<CandidatePage> {
    return this.queryWithData(accountId, input, async (query) => ({ rows: await load(query) }));
  }
  // Internal extension for tools that freeze additional, schema-validated facts
  // with the candidate identities. The binding isolates tool and selection scope.
  async queryWithData(
    accountId: string,
    input: unknown,
    load: (query: AssistantQuery) => Promise<{ rows: CandidateDetail[]; data?: T }>,
    binding?: unknown,
  ): Promise<CandidatePage> {
    const query = assistantQuerySchema.parse(input);
    const cursor = query.pagination.cursor;
    const key = scopeKey(accountId, query, binding);
    let runId: string;
    let run: Run<T>;
    let offset = 0;
    if (cursor) {
      runId = cursor.runId;
      run = this.get(runId, accountId);
      if (cursor.scopeKey !== key || run.scopeKey !== key)
        throw new CandidateQueryError('CURSOR_SCOPE_MISMATCH');
      const position = run.issued.get(JSON.stringify(cursor.after));
      if (position === undefined) throw new CandidateQueryError('CURSOR_NOT_ISSUED');
      offset = position;
    } else {
      const snapshot = await load(query);
      const rows = snapshot.rows.map((row) => candidateDetailSchema.parse(row));
      if (rows.length > CANDIDATE_LIMIT) throw new CandidateQueryError('CANDIDATE_BUDGET_EXCEEDED');
      rows.sort((a, b) => {
        const ar = a.candidate.purchase ?? a.candidate.item;
        const br = b.candidate.purchase ?? b.candidate.item;
        return compare(ar.type, br.type) || compare(ar.id, br.id);
      });
      if (new Set(rows.map((row) => candidateKey(row.candidate))).size !== rows.length)
        throw new CandidateQueryError('DUPLICATE_CANDIDATE');
      this.prune();
      // Bound retained snapshots per store and per account, including empty runs.
      for (const [id, old] of this.runs) {
        if ([...this.runs.values()].filter((r) => r.accountId === accountId).length < 4) break;
        if (old.accountId === accountId) this.runs.delete(id);
      }
      while (this.runs.size >= 32) this.runs.delete(this.runs.keys().next().value!);
      runId = randomUUID();
      run = {
        data: structuredClone(snapshot.data),
        accountId,
        scopeKey: key,
        queriedAt: new Date(this.now()).toISOString(),
        expires: this.now() + CANDIDATE_RUN_TTL_MS,
        rows,
        issued: new Map(),
        read: 0,
      };
      this.runs.set(runId, run);
    }
    const end = Math.min(offset + query.pagination.limit, run.rows.length);
    const items = run.rows.slice(offset, end).map((row) => row.candidate);
    run.read = Math.max(run.read, end);
    const last = items.at(-1);
    const after = last?.purchase ?? last?.item;
    const nextCursor = run.read < run.rows.length && after ? { runId, scopeKey: key, after } : null;
    if (nextCursor) run.issued.set(JSON.stringify(after), end);
    const total = run.rows.length;
    const read = run.read;
    return candidatePageSchema.parse({
      version: 'v1',
      runId,
      queriedAt: run.queriedAt,
      query,
      items,
      nextCursor,
      completeness: {
        scope: 'resolved',
        traversal: read === total ? 'complete' : 'partial',
        evaluation: total === 0 ? 'complete' : 'not_started',
        countBasis: query.subject === 'purchases' ? 'purchase_entry' : 'catalog',
        totalCandidates: total,
        readCandidates: read,
        uniqueCatalogItems: new Set(
          run.rows.slice(0, read).map((r) => JSON.stringify(r.candidate.item)),
        ).size,
        evaluatedCandidates: 0,
        included: 0,
        excluded: 0,
        uncertain: 0,
        notEvaluated: read,
        unreadCandidates: total - read,
        stopReason: total === 0 ? null : 'running',
      },
    });
  }
  snapshotData(accountId: string, runId: string): T {
    const data = this.get(runId, accountId).data;
    if (data === undefined) throw new CandidateQueryError('SNAPSHOT_DATA_UNAVAILABLE');
    return structuredClone(data);
  }
  details(accountId: string, input: unknown) {
    const query = candidateDetailsQuerySchema.parse(input);
    const run = this.get(query.runId, accountId);
    const available = new Map(
      run.rows.slice(0, run.read).map((r) => [candidateKey(r.candidate), r]),
    );
    const keys = query.candidates.map((candidate) => candidateKey({ ...candidate, evidence: [] }));
    if (new Set(keys).size !== keys.length || keys.some((key) => !available.has(key)))
      throw new CandidateQueryError('DETAIL_OUTSIDE_READ_SCOPE');
    return candidateDetailsResultSchema.parse({
      runId: query.runId,
      queriedAt: run.queriedAt,
      items: keys.map((key) => available.get(key)),
    });
  }
}
