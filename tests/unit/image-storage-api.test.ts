import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createGrant: vi.fn(),
  mode: vi.fn(),
  sign: vi.fn(),
  head: vi.fn(),
  stream: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { uploadGrant: { create: mocks.createGrant } } }));
vi.mock('@/lib/media', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/media')>()),
  storageMode: mocks.mode,
  cosConfig: () => ({
    bucket: 'fixture-bucket',
    region: 'fixture-region',
    client: {
      getObjectUrl: mocks.sign,
      headObject: mocks.head,
      getObjectStream: mocks.stream,
      getObject: mocks.get,
    },
  }),
}));

import { POST } from '@/app/api/uploads/route';
import { GET } from '@/app/api/images/[...path]/route';
import { readImportSource } from '@/lib/materialImageImport/sourceImage';
import { createImportSchema, commitImportSchema } from '@/lib/materialImageImport/contracts';
import { materialBatchWriteSchema } from '@/lib/validation';

const name = '123e4567-e89b-42d3-a456-426614174000.png';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const cases = [
  { purpose: undefined, prefix: 'images' },
  { purpose: 'import-source', prefix: 'material-imports/sources' },
  { purpose: 'import-crop', prefix: 'material-imports/crops' },
  { purpose: 'cabochon', prefix: 'cabochons/images' },
  { purpose: 'cabochon-excel', prefix: 'cabochons/images' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.mode.mockReturnValue('cos');
  mocks.createGrant.mockResolvedValue({ id: 'grant' });
  mocks.sign.mockReturnValue('https://cos.example/signed');
  mocks.head.mockResolvedValue({ headers: { 'content-length': String(png.length) } });
  mocks.stream.mockImplementation(() => Readable.from([png]));
  mocks.get.mockResolvedValue({ Body: png });
});

describe('image storage routing', () => {
  it.each(cases)('grants COS uploads under $prefix', async ({ purpose, prefix }) => {
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose }),
      }),
    );
    expect(response.status).toBe(200);
    const grant = await response.json();
    expect(grant.key).toMatch(new RegExp(`^${prefix}/[0-9a-f-]{36}\\.png$`));
    expect(grant.url).toBe(`/api/images/${prefix === 'images' ? grant.key.slice(7) : grant.key}`);
    expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ Key: grant.key }));
    expect(mocks.createGrant).toHaveBeenCalledWith({
      data: expect.objectContaining({ objectKey: grant.key, url: grant.url }),
    });
  });

  it.each(cases)('uses the same $prefix layout for local uploads', async ({ purpose, prefix }) => {
    mocks.mode.mockReturnValue('local');
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose }),
      }),
    );
    const grant = await response.json();
    expect(grant.key.startsWith(`${prefix}/`)).toBe(true);
    expect(grant.url).toBe(`/uploads/${grant.key}`);
    expect(grant.uploadUrl).toBe('/api/uploads/local');
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each([...cases, { prefix: 'cabochon-imports/images' }])(
    'streams private $prefix images, preserving legacy URLs',
    async ({ prefix }) => {
      const path = prefix === 'images' ? [name] : [...prefix.split('/'), name];
      const response = await GET(new NextRequest('http://localhost/api/images/fixture'), {
        params: Promise.resolve({ path }),
      });
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toContain('private');
      expect(mocks.head).toHaveBeenCalledWith(
        expect.objectContaining({ Key: `${prefix}/${name}` }),
      );
    },
  );

  it('rejects arbitrary prefixes and traversal before contacting COS', async () => {
    for (const path of [
      ['private', 'sources', name],
      ['material-imports', 'other', name],
      ['material-imports', '..', name],
      ['material-imports/sources', name],
      ['material-imports', 'sources', '../secret.png'],
      ['material-imports', 'sources', 'not-an-image.txt'],
    ]) {
      expect(
        (
          await GET(new NextRequest('http://localhost/api/images/fixture'), {
            params: Promise.resolve({ path }),
          })
        ).status,
      ).toBe(404);
    }
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('requires authentication for both new upload grants and image reads', async () => {
    mocks.auth.mockResolvedValue(null);
    expect(
      (await POST(new NextRequest('http://localhost/api/uploads', { method: 'POST' }))).status,
    ).toBe(401);
    expect(
      (
        await GET(new NextRequest('http://localhost/api/images/fixture'), {
          params: Promise.resolve({ path: ['material-imports', 'crops', name] }),
        })
      ).status,
    ).toBe(401);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.head).not.toHaveBeenCalled();
  });

  it('rejects client-supplied storage paths instead of accepting arbitrary prefixes', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/png', size: png.length, purpose: '../../private' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it.each(['images', 'material-imports/sources'])(
    'reads recognition originals from %s',
    async (prefix) => {
      expect(await readImportSource(`${prefix}/${name}`)).toEqual({
        bytes: png,
        mimeType: 'image/png',
      });
      expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ Key: `${prefix}/${name}` }));
    },
  );

  it('accepts original photos in batch edits while enforcing source and crop roles', async () => {
    const sourceKey = `material-imports/sources/${name}`;
    const cropKey = `material-imports/crops/${name}`;
    const source = {
      sourceKey,
      fileName: 'supplier.png',
      width: 100,
      height: 100,
      provider: 'deepseek',
      priceKind: 'PURCHASE',
    };
    const commit = { version: 0, itemId: crypto.randomUUID(), imageKey: cropKey };
    expect(createImportSchema.safeParse(source).success).toBe(true);
    expect(commitImportSchema.safeParse(commit).success).toBe(true);
    expect(createImportSchema.safeParse({ ...source, sourceKey: cropKey }).success).toBe(false);
    expect(commitImportSchema.safeParse({ ...commit, imageKey: sourceKey }).success).toBe(false);
    expect(createImportSchema.safeParse({ ...source, sourceKey: `images/${name}` }).success).toBe(
      true,
    );
    expect(commitImportSchema.safeParse({ ...commit, imageKey: `images/${name}` }).success).toBe(
      true,
    );
    expect(
      materialBatchWriteSchema.safeParse({
        name: '采购批次',
        receivedAt: '2026-10-21',
        notes: '',
        attachments: [{ objectKey: sourceKey, fileName: 'supplier.png', notes: '' }],
      }).success,
    ).toBe(true);
    await expect(readImportSource(cropKey)).rejects.toThrow('INVALID_IMAGE');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
