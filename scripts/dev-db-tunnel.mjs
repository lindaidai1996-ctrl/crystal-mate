import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import dotenv from 'dotenv';

const execute = promisify(execFile);
export const projectDir = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: path.join(projectDir, '.env') });

function homePath(value) {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function configuration() {
  const settings = process.env;
  const host = settings.DEV_DATABASE_SSH_HOST;
  const user = settings.DEV_DATABASE_SSH_USER || 'ubuntu';
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !/^[a-zA-Z0-9_-]+$/.test(user))
    throw new Error('Configure DEV_DATABASE_SSH_HOST and DEV_DATABASE_SSH_USER in .env.');

  // A tunnel intended for development must never start against the production database.
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const url = new URL(settings[key]);
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '15432' ||
      url.pathname !== '/crystal_mate_dev' ||
      url.username !== 'crystal_dev'
    )
      throw new Error(`${key} must point to crystal_dev@127.0.0.1:15432/crystal_mate_dev.`);
  }

  return {
    destination: `${user}@${host}`,
    socket: path.join(projectDir, 'backups', 'dev-db.sock'),
    identity: homePath(
      settings.DEV_DATABASE_SSH_IDENTITY_FILE || '~/.ssh/crystal_mate_deploy_ed25519',
    ),
    knownHosts: homePath(
      settings.DEV_DATABASE_SSH_KNOWN_HOSTS_FILE || '~/.ssh/known_hosts_crystal_mate',
    ),
  };
}

function portInUse() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: 15432 });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(new Error('Cannot inspect the local database tunnel port.'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Timed out checking the local database tunnel port.'));
    });
  });
}

export async function ensureDatabaseTunnel() {
  const config = configuration();
  try {
    await execute('ssh', [
      '-F',
      '/dev/null',
      '-S',
      config.socket,
      '-O',
      'check',
      config.destination,
    ]);
    if (!(await portInUse())) throw new Error('The tunnel is running without its database port.');
    console.log('开发数据库 SSH 通道已连接（127.0.0.1:15432）。');
    return;
  } catch {
    if (await portInUse())
      throw new Error('Port 15432 is occupied by another connection; stop it before retrying.');
  }

  await mkdir(path.dirname(config.socket), { recursive: true, mode: 0o700 });
  try {
    await execute('ssh', [
      '-F',
      '/dev/null',
      '-M',
      '-S',
      config.socket,
      '-f',
      '-N',
      '-i',
      config.identity,
      '-o',
      `UserKnownHostsFile=${config.knownHosts}`,
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
      '-L',
      '127.0.0.1:15432:127.0.0.1:5433',
      config.destination,
    ]);
    console.log('开发数据库 SSH 通道已建立（127.0.0.1:15432）。');
  } catch {
    throw new Error(
      'SSH tunnel failed; check network access, the deployment key, and known hosts.',
    );
  }
}

async function stopDatabaseTunnel() {
  const config = configuration();
  try {
    await execute('ssh', [
      '-F',
      '/dev/null',
      '-S',
      config.socket,
      '-O',
      'exit',
      config.destination,
    ]);
    console.log('开发数据库 SSH 通道已关闭。');
  } catch {
    throw new Error('Cannot close the managed tunnel; it may already be disconnected.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'stop') await stopDatabaseTunnel();
    else await ensureDatabaseTunnel();
  } catch (error) {
    // Do not print connection URLs or SSH stderr, which may contain sensitive settings.
    console.error(
      error instanceof TypeError ? 'Invalid development database settings.' : error.message,
    );
    process.exitCode = 1;
  }
}
