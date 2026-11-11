import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';
import { encryptBackup } from './backup-crypto.mjs';

const [source, backupName] = process.argv.slice(2);
if (!source || !/^crystal-[\w-]+\.dump$/.test(backupName || '')) {
  throw new Error('Provide the archive path and its crystal-*.dump filename.');
}
for (const name of [
  'COS_SECRET_ID',
  'COS_SECRET_KEY',
  'COS_BUCKET',
  'COS_REGION',
  'BACKUP_ENCRYPTION_KEY',
]) {
  if (!process.env[name]) throw new Error(`Missing ${name}.`);
}

const directory = await mkdtemp(path.join(tmpdir(), 'crystal-backup-'));
try {
  const encrypted = path.join(directory, 'archive.enc');
  await encryptBackup(source, encrypted, process.env.BACKUP_ENCRYPTION_KEY);
  const client = new COS({
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY,
  });
  const object = {
    Bucket: process.env.COS_BUCKET,
    Region: process.env.COS_REGION,
    Key: `crystal-mate/db-backups/${new Date().toISOString().slice(0, 10)}/${backupName}.enc`,
  };
  const { size } = await stat(encrypted);
  await client.putObject({
    ...object,
    Body: createReadStream(encrypted),
    ContentLength: size,
    ContentType: 'application/octet-stream',
  });
  const metadata = await client.headObject(object);
  if (Number(metadata.headers?.['content-length']) !== size) {
    throw new Error('Uploaded backup size does not match.');
  }
  console.log(JSON.stringify({ key: object.Key, bytes: size, encrypted: true }));
} catch {
  console.error('Encrypted off-server backup failed; check COS access and server logs.');
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
