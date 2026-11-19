import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/lib/ai/imageRecognition', () => ({
  imageRecognitionConfig: () => ({
    endpoint: 'https://fixture.invalid',
    apiKey: 'fixture',
    model: 'fixture-vision',
  }),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1])),
}));
import { db } from '@/lib/db';
import { createBatch } from '@/lib/material-batches';
import { attachmentDetails, commandAttachments } from '@/lib/shared-attachments';
import {
  cancelReceiptRecognition,
  getReceiptRecognition,
  recognizeReceipt,
} from '@/lib/attachment-recognition';
const name = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : '';
const enabled = !!process.env.INTEGRATION_DATABASE_URL && name.endsWith('_test');
const prefix = `receipt-state-${crypto.randomUUID()}`;
const assetIds: string[] = [];
const keys: string[] = [];
const evidence = {
  documentType: 'invoice',
  seller: { name: 'Fixture Supplier', phone: null, address: null },
  buyer: { name: 'Fixture Buyer', phone: null, address: null },
  dates: [{ value: '2026-11-19', label: 'Invoice' }],
  warnings: [],
};
function response() {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(evidence) } }],
      usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
async function fixture() {
  const objectKey = `images/${crypto.randomUUID()}.png`;
  keys.push(objectKey);
  await db.uploadGrant.create({
    data: {
      objectKey,
      url: `/uploads/${objectKey}`,
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const batch = await createBatch({
    name: `${prefix}-${crypto.randomUUID()}`,
    receivedAt: '2026-11-19',
    notes: '',
    attachments: [{ objectKey, fileName: 'receipt.png', notes: '' }],
  });
  assetIds.push(batch.attachments[0].assetId);
  return {
    id: batch.attachments[0].assetId,
    owner: { type: 'batch' as const, id: batch.id },
    accountId: prefix,
    provider: 'compatible',
    requestId: crypto.randomUUID(),
    force: false,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe.skipIf(!enabled)('receipt recognition persistence with a fixed model adapter', () => {
  afterAll(async () => {
    await db.materialBatch.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.sharedAttachment.deleteMany({ where: { id: { in: assetIds } } });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: keys } } });
    await db.$disconnect();
  });
  it('persists completed evidence and reuses the image-version cache without a second call', async () => {
    vi.stubEnv('MEDIA_STORAGE', 'local');
    const fetch = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetch);
    const input = await fixture();
    const first = await recognizeReceipt(input);
    expect(first.status).toBe('complete');
    expect(first.result?.seller.name).toBe('Fixture Supplier');
    const cached = await recognizeReceipt({ ...input, requestId: crypto.randomUUID() });
    expect(cached.id).toBe(first.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await getReceiptRecognition(input.id, input.owner))?.usage).toEqual({
      prompt_tokens: 50,
      completion_tokens: 40,
      total_tokens: 90,
    });
  });
  it('persists failures and retries explicitly without generating links', async () => {
    vi.stubEnv('MEDIA_STORAGE', 'local');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429 })),
    );
    const input = await fixture();
    await expect(recognizeReceipt(input)).rejects.toThrow('IMPORT_MODEL_RATE_LIMIT');
    expect((await getReceiptRecognition(input.id, input.owner))?.status).toBe('failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    );
    expect((await recognizeReceipt({ ...input, requestId: crypto.randomUUID() })).status).toBe(
      'complete',
    );
    expect((await attachmentDetails(input.id)).distributors).toHaveLength(0);
    expect(await db.attachmentRecognition.count({ where: { assetId: input.id } })).toBe(2);
  });
  it('retains known model usage when evidence is invalid', async () => {
    vi.stubEnv('MEDIA_STORAGE', 'local');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: 'stop', message: { content: 'bad JSON' } }],
              usage: { total_tokens: 42 },
            }),
            { status: 200 },
          ),
      ),
    );
    const input = await fixture();
    await expect(recognizeReceipt(input)).rejects.toThrow('IMPORT_MODEL_INVALID_RESULT');
    expect(
      (await db.attachmentRecognition.findUniqueOrThrow({ where: { id: input.requestId } })).usage,
    ).toEqual({ total_tokens: 42 });
  });
  it('keeps a late cancelled response out of results while retaining its known usage', async () => {
    vi.stubEnv('MEDIA_STORAGE', 'local');
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetch = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetch);
    const input = await fixture();
    const result = recognizeReceipt(input);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await cancelReceiptRecognition(input.id, input.requestId, input.accountId);
    finish(response());
    await expect(result).rejects.toThrow('ATTACHMENT_RECOGNITION_CANCELLED');
    const stored = await db.attachmentRecognition.findUniqueOrThrow({
      where: { id: input.requestId },
    });
    expect(stored.status).toBe('cancelled');
    expect(stored.result).toBeNull();
    expect(stored.usage).toEqual({ prompt_tokens: 50, completion_tokens: 40, total_tokens: 90 });
  });
  it('invalidates old evidence and prevents late installation after replacing the image', async () => {
    vi.stubEnv('MEDIA_STORAGE', 'local');
    let finish!: (value: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const input = await fixture();
    const result = recognizeReceipt(input);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const objectKey = `images/${crypto.randomUUID()}.png`;
    keys.push(objectKey);
    await db.uploadGrant.create({
      data: {
        objectKey,
        url: `/uploads/${objectKey}`,
        uploadedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const asset = await attachmentDetails(input.id);
    await commandAttachments({
      operation: 'update',
      asset: { id: asset.id, version: asset.version },
      replacement: { objectKey, fileName: 'replacement.png' },
    });
    finish(response());
    await expect(result).rejects.toThrow('ATTACHMENT_RECOGNITION_CANCELLED');
    expect(await getReceiptRecognition(input.id, input.owner)).toBeNull();
  });
  it('rejects an image outside the supplied owner scope', async () => {
    const input = await fixture();
    const other = await fixture();
    await expect(recognizeReceipt({ ...input, owner: other.owner })).rejects.toThrow('NOT_FOUND');
  });
});
