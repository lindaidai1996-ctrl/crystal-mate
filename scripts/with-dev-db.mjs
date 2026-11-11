import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensureDatabaseTunnel, projectDir } from './dev-db-tunnel.mjs';

try {
  if (process.env.DEV_DATABASE_SSH_HOST) await ensureDatabaseTunnel();
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Provide the development command to run.');
  const child = spawn(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${path.join(projectDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', () => {
    console.error('Cannot start the development command.');
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
} catch (error) {
  console.error(
    error instanceof TypeError ? 'Invalid development database settings.' : error.message,
  );
  process.exitCode = 1;
}
