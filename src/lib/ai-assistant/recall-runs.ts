import { CandidateRuns } from './candidate-runs';
import { candidateKey, type AssistantQuery } from './contracts';
import { recallPageSchema } from './recall-contracts';
import { readAssistantRecall, type RecallSnapshot } from './recall-data';
export class RecallRuns {
  private readonly runs: CandidateRuns<RecallSnapshot>;
  constructor(now: () => number = Date.now) {
    this.runs = new CandidateRuns(now);
  }
  async query(
    accountId: string,
    input: unknown,
    load: (query: AssistantQuery) => ReturnType<typeof readAssistantRecall>,
  ) {
    const page = await this.runs.queryWithData(accountId, input, load, {
      tool: 'recall-v1',
      policyVersion: 'v1',
    });
    const data = this.runs.snapshotData(accountId, page.runId);
    const byKey = new Map(data.sources.map((r) => [r.key, r]));
    return recallPageSchema.parse({
      ...page,
      policyVersion: 'v1',
      sources: page.items.map((r) => byKey.get(candidateKey(r))),
      sourceCounts: data.sourceCounts,
    });
  }
  details(accountId: string, input: unknown) {
    return this.runs.details(accountId, input);
  }
}
