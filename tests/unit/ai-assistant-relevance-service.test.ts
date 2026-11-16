import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { frozenDetails, semanticQuery } from '../fixtures/ai-assistant-semantics';
import { annotateRecall } from '../../src/lib/ai-assistant/recall-data';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  read: vi.fn(),
  judge: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('../../src/lib/ai-assistant/recall-data', async (original) => ({
  ...(await original<typeof import('../../src/lib/ai-assistant/recall-data')>()),
  readAssistantRecall: mocks.read,
}));
vi.mock('../../src/lib/ai-assistant/relevance-model', async (original) => ({
  ...(await original<typeof import('../../src/lib/ai-assistant/relevance-model')>()),
  judgeAssistantRelevance: mocks.judge,
}));
import {
  startAssistantRelevance,
  continueAssistantRelevance,
  cancelAssistantRelevance,
  readAssistantRelevance,
} from '../../src/lib/ai-assistant/relevance-service';
const request = new NextRequest('http://localhost/api/assistant', {
  method: 'POST',
  headers: { origin: 'http://localhost' },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'a', name: 'admin' } });
  mocks.execute.mockResolvedValue(0);
  mocks.read.mockImplementation(async (_tx, q) =>
    annotateRecall(structuredClone(frozenDetails), q),
  );
  mocks.transaction.mockImplementation(async (callback) =>
    callback({ $executeRaw: mocks.execute }),
  );
  mocks.judge.mockImplementation(async (input) => ({
    model: 'mock',
    usage: null,
    output: {
      decisions: input.candidates.map(
        (c: { key: string; ruleAssessment: { decision: { status: string } } }) => ({
          key: c.key,
          status: c.ruleAssessment.decision.status,
          evidenceIndexes: [0],
          reason: 'mock',
        }),
      ),
    },
  }));
});
describe('authenticated relevance service (mock session and database)', () => {
  it.each([
    startAssistantRelevance,
    continueAssistantRelevance,
    cancelAssistantRelevance,
    readAssistantRelevance,
  ])('authenticates before parsing or accessing data/model %#', async (service) => {
    mocks.auth.mockResolvedValue(null);
    await expect(service(request, { sql: 'SELECT *', actorId: 'other' })).rejects.toThrow(
      'UNAUTHORIZED',
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.judge).not.toHaveBeenCalled();
  });
  it('reads a repeatable read-only snapshot, and resume cannot replace query/account/candidates', async () => {
    const run = await startAssistantRelevance(request, semanticQuery);
    expect(mocks.execute.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    expect(mocks.transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'RepeatableRead' });
    await expect(
      continueAssistantRelevance(request, {
        runId: run.runId,
        revision: 0,
        query: { hard: {} },
        candidates: [],
      }),
    ).rejects.toThrow();
    const next = await continueAssistantRelevance(request, {
      runId: run.runId,
      revision: 0,
      budget: { maxCallsPerStep: 1 },
    });
    expect(next.completeness.evaluatedCandidates).toBe(5);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(mocks.judge.mock.calls[0][0]);
    expect(payload).not.toContain('purchaseTotal');
    expect(payload).not.toContain('remainingQty');
    expect(payload).not.toContain('admin');
  });
  it('shares business facts while isolating read, continue and cancel by server account', async () => {
    const a = await startAssistantRelevance(request, semanticQuery);
    mocks.auth.mockResolvedValue({ user: { id: 'b', name: 'other' } });
    const b = await startAssistantRelevance(request, semanticQuery);
    expect(b.completeness).toEqual(a.completeness);
    for (const service of [
      readAssistantRelevance,
      continueAssistantRelevance,
      cancelAssistantRelevance,
    ]) {
      await expect(
        service(
          request,
          service === readAssistantRelevance ? { runId: a.runId } : { runId: a.runId, revision: 0 },
        ),
      ).rejects.toThrow('RUN_RESTART_REQUIRED');
    }
    expect(mocks.judge).not.toHaveBeenCalled();
  });
  it('rejects cross-origin execution before data access', async () => {
    const cross = new NextRequest('http://localhost/api/assistant', {
      method: 'POST',
      headers: { origin: 'https://other.example' },
    });
    await expect(startAssistantRelevance(cross, semanticQuery)).rejects.toThrow('INVALID_ORIGIN');
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
