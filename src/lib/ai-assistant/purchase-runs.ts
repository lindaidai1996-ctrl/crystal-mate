import { CandidateRuns } from './candidate-runs';
import { readAssistantPurchases } from './purchase-data';
import {
  purchasePageSchema,
  purchaseQuerySchema,
  type PurchaseEntry,
  type PurchaseSummary,
} from './purchase-contracts';
import { purchaseIdentity, summarizeAssistantPurchases } from './purchase-summary';

type PurchaseSnapshot = { rows: PurchaseEntry[]; summary: PurchaseSummary };
export class PurchaseRuns {
  private readonly runs: CandidateRuns<PurchaseSnapshot>;
  constructor(now: () => number = Date.now) {
    this.runs = new CandidateRuns(now);
  }
  async query(
    accountId: string,
    input: unknown,
    load: (
      input: Parameters<typeof readAssistantPurchases>[1],
    ) => ReturnType<typeof readAssistantPurchases>,
  ) {
    const query = purchaseQuerySchema.parse(input);
    const page = await this.runs.queryWithData(
      accountId,
      query.query,
      async (assistantQuery) => {
        const source = await load({ ...query, query: assistantQuery });
        const summary = summarizeAssistantPurchases(
          source.rows,
          source.scopeCandidateCount,
          query.selectedPurchases === undefined ? 'hard_scope' : 'selected_purchases',
        );
        return { rows: source.candidates, data: { rows: source.rows, summary } };
      },
      { tool: 'purchase-v1', selectedPurchases: query.selectedPurchases ?? null },
    );
    const data = this.runs.snapshotData(accountId, page.runId);
    const byId = new Map(data.rows.map((r) => [purchaseIdentity(r.purchase), r]));
    return purchasePageSchema.parse({
      ...page,
      query,
      items: page.items.map((r) => byId.get(purchaseIdentity(r.purchase!))),
      summary: data.summary,
    });
  }
}
