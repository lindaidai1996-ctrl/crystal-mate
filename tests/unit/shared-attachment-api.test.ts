import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  command: vi.fn(),
  details: vi.fn(),
  conflicts: vi.fn(),
  search: vi.fn(),
  recognize: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  requireAdmin: mocks.auth,
  requireAccount: mocks.auth,
  apiError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'INVALID_INPUT' },
      { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 400 },
    ),
}));
vi.mock('@/lib/audit-route', () => ({ withAuditRoute: (fn: unknown) => fn }));
vi.mock('@/lib/shared-attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shared-attachments')>();
  return {
    ...actual,
    commandAttachments: mocks.command,
    attachmentDetails: mocks.details,
    attachmentConflicts: mocks.conflicts,
  };
});
vi.mock('@/lib/attachment-targets', () => ({ searchAttachmentTargets: mocks.search }));
vi.mock('@/lib/attachment-recognition', () => ({
  recognizeReceipt: mocks.recognize,
  getReceiptRecognition: mocks.read,
  cancelReceiptRecognition: mocks.cancel,
}));
vi.mock('@/lib/ai/imageRecognition', () => ({ imageRecognitionModels: () => [] }));
import { GET, POST } from '@/app/api/attachments/route';
import { GET as detailGET } from '@/app/api/attachments/[id]/route';
import {
  GET as recognitionGET,
  POST as recognitionPOST,
  DELETE as recognitionDELETE,
} from '@/app/api/attachments/[id]/recognition/route';
const owner = { type: 'batch', id: 'cmwmwprj200023wj66xg8royz' };
const context = { params: Promise.resolve({ id: 'shared-asset' }) };
const request = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/attachments', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ id: 'authenticated-account' });
  mocks.command.mockResolvedValue({ ok: true });
});
describe('shared attachment authenticated API', () => {
  it('requires authentication before reads and writes on every new endpoint', async () => {
    mocks.auth.mockRejectedValue(new Error('UNAUTHORIZED'));
    const responses = await Promise.all([
      GET(request('GET')),
      POST(request('POST', {})),
      detailGET(request('GET'), context),
      recognitionGET(request('GET'), context),
      recognitionPOST(request('POST', {}), context),
      recognitionDELETE(request('DELETE', {}), context),
    ]);
    expect(responses.every((a) => a.status === 401)).toBe(true);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });
  it('rejects arbitrary ownership, file and version fields before calling the service', async () => {
    const response = await POST(
      request('POST', {
        operation: 'update',
        asset: { id: 'a' },
        url: 'https://untrusted.example/file',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('passes only validated references and targets to the mutation service', async () => {
    const body = {
      operation: 'link',
      assets: [{ id: 'shared-asset', version: 1 }],
      targets: [owner],
    };
    expect((await POST(request('POST', body))).status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith(body);
  });
  it('binds recognition ownership to the authenticated account', async () => {
    mocks.recognize.mockResolvedValue({ status: 'complete' });
    const body = { owner, provider: 'compatible', requestId: crypto.randomUUID(), force: false };
    expect((await recognitionPOST(request('POST', body), context)).status).toBe(200);
    expect(mocks.recognize).toHaveBeenCalledWith(
      expect.objectContaining({ ...body, id: 'shared-asset', accountId: 'authenticated-account' }),
    );
  });
});
