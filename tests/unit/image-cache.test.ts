import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedImage, IMAGE_CACHE_SECONDS } from '@/lib/image-cache';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'crystal-image-cache-'));
  vi.stubEnv('MEDIA_CACHE_DIR', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('private image disk cache', () => {
  it('shares concurrent loads and retains bytes on disk', async () => {
    const load = vi.fn(async () => Buffer.from('original'));
    const results = await Promise.all(Array.from({ length: 8 }, () => cachedImage('image', load)));
    expect(results.every((result) => result.toString() === 'original')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await readdir(directory)).filter((file) => file.endsWith('.bin'))).toHaveLength(1);
    await cachedImage('image', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads an expired file', async () => {
    await cachedImage('image', async () => Buffer.from('old'));
    const path = join(directory, (await readdir(directory))[0]);
    const past = new Date(Date.now() - (IMAGE_CACHE_SECONDS + 1) * 1000);
    await utimes(path, past, past);
    expect((await cachedImage('image', async () => Buffer.from('fresh'))).toString()).toBe('fresh');
  });

  it('evicts old files to respect the byte budget', async () => {
    vi.stubEnv('MEDIA_CACHE_MAX_MB', String(10 / 1024 ** 2));
    await cachedImage('first', async () => Buffer.alloc(6, 1));
    await cachedImage('second', async () => Buffer.alloc(6, 2));
    expect(await readdir(directory)).toHaveLength(1);
    const load = vi.fn(async () => Buffer.alloc(6, 1));
    await cachedImage('first', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries failed loads without storing errors', async () => {
    await expect(
      cachedImage('image', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await readdir(directory)).toHaveLength(0);
    expect((await cachedImage('image', async () => Buffer.from('recovered'))).toString()).toBe(
      'recovered',
    );
  });
});
