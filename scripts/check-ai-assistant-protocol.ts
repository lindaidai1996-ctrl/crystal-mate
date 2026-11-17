// Explicit real calls only; no Prisma imports and no implicit retries.
import { config as dotenv } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assistantModelConfiguration } from '../src/lib/ai-assistant/model-config';
import { runAssistantModelProbe, PROBE_VERSION } from './lib/assistant-model-probe';

async function main() {
  if (process.argv.slice(2).join(' ') !== '--real') {
    console.log(
      'No model call made. Run with --real for five minimal synthetic protocol requests.',
    );
    return;
  }
  dotenv({ path: '.env' });
  const startedAt = new Date().toISOString();
  const path = `docs/plans/ai-assistant/verification/${startedAt.replace(/[:.]/g, '-')}-p4-01-protocol.json`;
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const names = [
    'next',
    'typescript',
    'zod',
    'dotenv',
    'tsx',
    'vitest',
    'ai',
    '@ai-sdk/deepseek',
    '@ai-sdk/openai-compatible',
    'openai',
  ];
  const dependencies = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        let installed: string | null = null;
        try {
          installed = JSON.parse(
            await readFile(`node_modules/${name}/package.json`, 'utf8'),
          ).version;
        } catch {
          /* absent SDK is recorded, not installed */
        }
        return [
          name,
          { installed, locked: lock.packages[`node_modules/${name}`]?.version ?? null },
        ];
      }),
    ),
  );
  let probe: Record<string, unknown>;
  let secret = '';
  try {
    const config = assistantModelConfiguration();
    secret = config.apiKey;
    probe = await runAssistantModelProbe(config);
  } catch (error) {
    probe = {
      probeVersion: PROBE_VERSION,
      passed: false,
      error:
        error instanceof Error && error.message === 'MODEL_NOT_CONFIGURED'
          ? 'MODEL_NOT_CONFIGURED'
          : 'LOCAL_PROBE_FAILURE',
      attempts: [],
    };
  }
  const report: Record<string, unknown> = {
    task: 'P4-01',
    startedAt,
    finishedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workspace: 'uncommitted P4-01 changes; see handoff',
    runtime: { node: process.version, undici: process.versions.undici },
    dependencies,
    ...probe,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  // Defense in depth even if an upstream returns a key as its model identifier.
  await writeFile(path, secret ? json.split(secret).join('[REDACTED]') : json, { flag: 'wx' });
  console.log(JSON.stringify({ path, passed: report.passed }));
  if (!report.passed) process.exitCode = 1;
}
void main();
