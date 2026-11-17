// Explicit real, synthetic-only compatibility check. No database imports.
import dotenv from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { runAssistantLoop, newAssistantExecution } from '../src/lib/ai-assistant/orchestrator';
import { createAssistantToolModel } from '../src/lib/ai-assistant/orchestration-model';
dotenv.config({ quiet: true });
async function main() {
  if (!process.argv.includes('--real')) {
    console.log(
      'Pass --real for synthetic forced-tool loop compatibility verification. No DB access.',
    );
    return;
  }
  const execution = await runAssistantLoop({
    execution: newAssistantExecution(null),
    text: '只查本月的商品采购，不需要其他条件，查看明细。',
    model: createAssistantToolModel(),
    facts: async () => ({
      status: 'no_results',
      result: { synthetic: true, rows: [] },
      checkpoint: null,
    }),
    save: async () => {},
    signal: new AbortController().signal,
  });
  const report = {
    checkedAt: new Date().toISOString(),
    kind: 'real-model-synthetic-tools-no-database',
    protocol: 'forced-single-tool-sequential-non-streaming',
    status: execution.status,
    calls: execution.calls,
    reservedTokens: execution.reservedTokens,
    state: execution.state,
    trace: execution.trace,
    errorCode: execution.errorCode,
    passed:
      execution.status === 'no_results' &&
      execution.calls === 3 &&
      execution.state?.query.hard.purchaseDate?.from === '2026-11-01',
    limitations: [
      'No auto/parallel/streaming tools',
      'No business query or real account/HTTP verification',
      'Synthetic tool result only',
    ],
  };
  const file = `docs/plans/ai-assistant/verification/${new Date().toISOString().replace(/[:.]/g, '-')}-p4-loop-protocol.json`;
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({ file, passed: report.passed, status: report.status, calls: report.calls }),
  );
  if (!report.passed) process.exitCode = 1;
}
main().catch(() => {
  console.error('LOOP_PROTOCOL_CHECK_FAILED');
  process.exitCode = 1;
});
