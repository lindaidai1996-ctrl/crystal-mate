import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const IMAGE_CACHE_SECONDS = 30 * 24 * 60 * 60;

const pending = new Map<string, Promise<Buffer>>();
let writes = Promise.resolve();

function cacheConfig() {
  const configuredMb = Number(process.env.MEDIA_CACHE_MAX_MB ?? 512);
  return {
    directory: process.env.MEDIA_CACHE_DIR || join(process.cwd(), '.cache', 'images'),
    maxBytes: (Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 512) * 1024 ** 2,
  };
}

async function readFresh(path: string) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs >= IMAGE_CACHE_SECONDS * 1000) return;
    return await readFile(path);
  } catch {
    // A missing/unavailable disk cache must not prevent reading an image from storage.
    return;
  }
}

async function store(directory: string, path: string, bytes: Buffer, maxBytes: number) {
  if (bytes.length > maxBytes) return;
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  const files = (
    await Promise.all(
      entries
        .filter((name) => name.endsWith('.bin'))
        .map(async (name) => {
          const filePath = join(directory, name);
          const info = await stat(filePath);
          return { path: filePath, size: info.size, mtime: info.mtimeMs };
        }),
    )
  ).sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (
      file.path === path ||
      Date.now() - file.mtime >= IMAGE_CACHE_SECONDS * 1000 ||
      total + bytes.length > maxBytes
    ) {
      await rm(file.path, { force: true });
      total -= file.size;
    }
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Keys include storage identity and rendition version; no user-supplied paths reach the disk.
// Only completed, successful loads are stored. Concurrent requests share the same load.
export async function cachedImage(key: string, load: () => Promise<Buffer>): Promise<Buffer> {
  const { directory, maxBytes } = cacheConfig();
  const path = join(directory, `${createHash('sha256').update(key).digest('hex')}.bin`);
  const existing = pending.get(path);
  if (existing) return existing;
  const task = (async () => {
    const hit = await readFresh(path);
    if (hit) return hit;
    const bytes = await load();
    const write = writes.then(() => store(directory, path, bytes, maxBytes));
    writes = write.catch(() => {});
    try {
      await write;
    } catch {
      console.warn('Image disk cache unavailable; serving image without storing it.');
    }
    return bytes;
  })();
  pending.set(path, task);
  try {
    return await task;
  } finally {
    pending.delete(path);
  }
}
