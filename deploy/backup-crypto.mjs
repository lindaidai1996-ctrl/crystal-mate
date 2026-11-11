import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, open, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const magic = Buffer.from('CMDBAK01');

function parseKey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) {
    throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  }
  return Buffer.from(value, 'hex');
}

export async function encryptBackup(source, destination, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', parseKey(secret), iv);
  const output = await open(destination, 'wx', 0o600);
  try {
    await output.write(Buffer.concat([magic, iv]));
    await pipeline(createReadStream(source), cipher, output.createWriteStream());
    await appendFile(destination, cipher.getAuthTag());
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally {
    await output.close();
  }
}

export async function decryptBackup(source, destination, secret) {
  const key = parseKey(secret);
  const input = await open(source, 'r');
  try {
    const { size } = await input.stat();
    if (size < 36) throw new Error('Invalid backup header.');
    const header = Buffer.alloc(20);
    const tag = Buffer.alloc(16);
    await input.read(header, 0, header.length, 0);
    await input.read(tag, 0, tag.length, size - tag.length);
    if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid backup header.');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
    decipher.setAuthTag(tag);
    const output = await open(destination, 'wx', 0o600);
    try {
      await pipeline(
        createReadStream(source, { start: 20, end: size - 17 }),
        decipher,
        output.createWriteStream(),
      );
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
