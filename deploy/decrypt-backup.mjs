import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { decryptBackup } from './backup-crypto.mjs';

const [source, destination, keyFile] = process.argv.slice(2);
if (!source || !destination || !keyFile) {
  throw new Error('Usage: node deploy/decrypt-backup.mjs archive.enc output.dump key.env');
}
const { BACKUP_ENCRYPTION_KEY } = dotenv.parse(await readFile(keyFile));
await decryptBackup(source, destination, BACKUP_ENCRYPTION_KEY);
console.log('Backup decrypted and authenticated.');
