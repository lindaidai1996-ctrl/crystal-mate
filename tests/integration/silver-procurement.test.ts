import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
import { db } from '@/lib/db';
import { auditContext } from '@/lib/audit-context';
import {
  getProcurement,
  saveProcurement,
  listProcurement,
} from '@/lib/material-pricing/purchase-service';
import { getPricingPreview } from '@/lib/material-pricing/service';
import {
  createSilverImport,
  getSilverImport,
  updateSilverImport,
  commitSilverRow,
  startSilverImport,
  runSilverImport,
} from '@/lib/material-pricing-import/store';
import { adjustMaterialStock } from '@/lib/material-stock';
import { readAssistantPurchases } from '@/lib/ai-assistant/purchase-data';
import { readAssistantStock } from '@/lib/ai-assistant/stock-data';
import { assistantQuerySchema } from '@/lib/ai-assistant/contracts';
import type { SilverDraftRow } from '@/lib/material-pricing-import/contracts';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/none').pathname.endsWith('_test');
afterAll(() => db.$disconnect());
async function fixture() {
  const suffix = randomUUID();
  const category = await db.materialCategory.create({ data: { name: `silver-${suffix}` } });
  const supplier = await db.distributor.create({
    data: { name: `silver-${suffix}`, area: 'test' },
  });
  const group = await db.materialPricingGroup.create({
    data: { name: `silver-${suffix}`, marketLinked: false },
  });
  const materials = await Promise.all(
    [0, 1, 2].map((index) =>
      db.material.create({
        data: {
          name: `silver-${suffix}-${index}`,
          categoryId: category.id,
          unit: 'GRAM',
          pricingGroupId: group.id,
        },
      }),
    ),
  );
  const lines = materials.map((material) => ({
    materialId: material.id,
    weight: '100',
    quote: '20',
    amount: '1700',
    quotePurpose: 'BEFORE_DISCOUNT' as const,
  }));
  const purchase = {
    receivedAt: '2026-11-15',
    distributorId: supplier.id,
    initialStock: 'UNKNOWN' as const,
    notes: suffix,
    lines,
  };
  const row: SilverDraftRow = {
    rowNumber: 4,
    receivedAt: purchase.receivedAt,
    sourceSupplier: supplier.name,
    distributorId: supplier.id,
    original: { A: { value: '46341', type: '', formula: null, cached: '46341' } },
    lines: lines.map((line, index) => ({
      kind: (['S925', 'FINE925', 'CHIANGMAI'] as const)[index],
      materialId: line.materialId,
      weight: line.weight,
      quote: line.quote,
      amount: line.amount,
      sourceWeight: line.weight,
      sourcePrice: '17',
      sourceAmount: line.amount,
      amountConfirmed: false,
    })),
    skipped: false,
    allowDuplicate: false,
    receipt: null,
  };
  const draft = {
    id: randomUUID(),
    fileHash: randomUUID().replaceAll('-', '').repeat(2),
    fileName: 'silver.xlsx',
    sheetName: '总账',
    rows: [
      (({ receipt: _receipt, ...row }) => {
        void _receipt;
        return row;
      })(row),
    ],
  };
  return { category, supplier, group, materials, purchase, row, draft };
}
describe.skipIf(!enabled)('silver procurement database transactions', () => {
  it('keeps concurrent same-day purchases separate and renames only pricing purchases when date or supplier changes', async () => {
    const f = await fixture();
    const results = await Promise.all([saveProcurement(f.purchase), saveProcurement(f.purchase)]);
    const names = (
      await db.materialBatch.findMany({
        where: { id: { in: results.map((result) => result.batchId) } },
        orderBy: { name: 'asc' },
      })
    ).map((batch) => batch.name);
    const base = `${f.group.name}-2026-11-15-${f.supplier.name}`;
    expect(names).toEqual([base, `${base}（2）`]);
    const supplier = await db.distributor.create({
      data: { name: `new-${randomUUID()}`, area: 'test' },
    });
    const edit = await getProcurement(results[0].batchId);
    await saveProcurement(
      { ...edit, receivedAt: '2026-11-23', distributorId: supplier.id },
      results[0].batchId,
    );
    expect(
      (await db.materialBatch.findUniqueOrThrow({ where: { id: results[0].batchId } })).name,
    ).toBe(`${f.group.name}-2026-11-23-${supplier.name}`);
    await db.materialBatch.update({
      where: { id: results[0].batchId },
      data: { purpose: 'GENERAL', name: `ordinary-${randomUUID()}` },
    });
    const ordinary = await db.materialBatch.findUniqueOrThrow({
      where: { id: results[0].batchId },
    });
    const ordinaryEdit = await getProcurement(ordinary.id);
    await saveProcurement({ ...ordinaryEdit, receivedAt: '2026-11-22' }, ordinary.id);
    expect((await db.materialBatch.findUniqueOrThrow({ where: { id: ordinary.id } })).name).toBe(
      ordinary.name,
    );
  });
  it('stores before-discount quotes but uses actual payment for pricing and assistant facts; historical inventory remains unknown', async () => {
    const f = await fixture();
    const result = await saveProcurement(f.purchase);
    const entries = await db.materialBatchEntry.findMany({ where: { batchId: result.batchId } });
    expect(entries).toHaveLength(3);
    expect(
      entries.every(
        (entry) =>
          entry.purchaseQuotedGramPrice?.eq(20) &&
          entry.purchaseGramPrice?.eq(17) &&
          entry.remainingQty === null,
      ),
    ).toBe(true);
    expect((await getPricingPreview(f.group.id)).preview.totals).toMatchObject({
      weight: '300.00',
      amount: '5100.00',
      rawCost: '17.00',
    });
    const query = assistantQuerySchema.parse({
      version: 'v1',
      subject: 'purchases',
      semantic: [],
      ruleVersion: 'v1',
      pagination: { limit: 50 },
      itemTypes: ['MATERIAL'],
      hard: { items: [{ type: 'MATERIAL', id: f.materials[0].id }] },
    });
    const facts = await db.$transaction((tx) => readAssistantPurchases(tx, { query }));
    expect(facts.rows[0].amount).toBe('1700.00');
    const stock = await db.$transaction((tx) =>
      readAssistantStock(tx, { query, mode: 'catalog_current' }),
    );
    expect(stock.catalogStock[0]).toMatchObject({ knownStock: '0.00', unknownStockBatchCount: 1 });
    expect(
      (await listProcurement()).items
        .filter((row) => row.batchId === result.batchId)
        .every((row) => row.discount === '8.50' && row.remaining === null),
    ).toBe(true);
  });
  it('edits an entire purchase without losing unknown stock, then supports explicit stock counts and preserves used quantities', async () => {
    const f = await fixture(),
      result = await saveProcurement(f.purchase);
    let edit = await getProcurement(result.batchId);
    const changed = { ...edit, lines: edit.lines.map((line) => ({ ...line, weight: '120' })) };
    await saveProcurement(changed, result.batchId);
    expect(
      (await db.materialBatchEntry.findMany({ where: { batchId: result.batchId } })).every(
        (entry) => entry.remainingQty === null,
      ),
    ).toBe(true);
    await expect(saveProcurement(changed, result.batchId)).rejects.toMatchObject({
      code: 'PRICING_PURCHASE_CHANGED',
    });
    await adjustMaterialStock(f.materials[0].id, result.entryIds[0], {
      quantity: 5,
      expectedQuantity: null,
      reason: 'count',
    });
    edit = await getProcurement(result.batchId);
    await saveProcurement(
      { ...edit, lines: edit.lines.map((line) => ({ ...line, weight: '130' })) },
      result.batchId,
    );
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: result.entryIds[0] } })
      ).remainingQty?.toFixed(2),
    ).toBe('15.00');
  });
  it('defaults new procurement to full inventory and rolls back all lines when one material is invalid', async () => {
    const f = await fixture();
    const current = await saveProcurement({ ...f.purchase, initialStock: 'FULL' });
    expect(
      (await db.materialBatchEntry.findMany({ where: { batchId: current.batchId } })).every(
        (entry) => entry.remainingQty?.eq(100),
      ),
    ).toBe(true);
    const before = await db.materialBatch.count({ where: { notes: f.purchase.notes } });
    await db.material.update({ where: { id: f.materials[2].id }, data: { pricingGroupId: null } });
    await expect(saveProcurement(f.purchase)).rejects.toMatchObject({
      code: 'PRICING_MATERIAL_REQUIRED',
    });
    expect(await db.materialBatch.count({ where: { notes: f.purchase.notes } })).toBe(before);
    expect(await db.materialBatchEntry.count({ where: { materialId: f.materials[0].id } })).toBe(1);
  });
  it('reuses same-file drafts and atomically commits receipts, audit attribution and three procurement lines', async () => {
    const f = await fixture();
    const job = await createSilverImport(f.draft);
    expect(job.rows[0].issues).toEqual([]);
    expect(
      (await createSilverImport({ ...f.draft, id: randomUUID(), fileName: 'renamed.xlsx' })).id,
    ).toBe(job.id);
    const operationId = randomUUID();
    const committed = await auditContext.run(
      {
        operationId,
        source: 'POST /api/material-pricing-imports/test/commit',
        actor: { id: 'silver-test', username: 'silver-test', nickname: '' },
      },
      () => commitSilverRow(job.id, 4, job.version),
    );
    const receipt = committed.rows[0].receipt!;
    expect(receipt.entryIds).toHaveLength(3);
    expect((await commitSilverRow(job.id, 4, job.version)).rows[0].receipt).toEqual(receipt);
    expect(await db.materialBatchEntry.count({ where: { batchId: receipt.batchId } })).toBe(3);
    expect(
      await db.auditLog.findMany({ where: { operationId, entityType: 'MaterialBatchEntry' } }),
    ).toHaveLength(3);
    expect(
      await db.auditLog.findMany({ where: { operationId, entityType: 'MaterialPricingImport' } }),
    ).toHaveLength(1);
    await expect(
      updateSilverImport(job.id, { version: committed.version, row: f.draft.rows[0] }),
    ).rejects.toMatchObject({ code: 'EXCEL_ALREADY_COMMITTED' });
  });
  it('detects similar purchases across different files and permits explicitly reviewed separate purchases', async () => {
    const f = await fixture();
    await saveProcurement(f.purchase);
    let job = await createSilverImport(f.draft);
    expect(job.rows[0].issues).toContainEqual({ code: 'SIMILAR_PURCHASE' });
    await expect(commitSilverRow(job.id, 4, job.version)).rejects.toMatchObject({
      code: 'EXCEL_ROW_INVALID',
    });
    job = await updateSilverImport(job.id, {
      version: job.version,
      row: { ...f.draft.rows[0], allowDuplicate: true },
    });
    expect((await commitSilverRow(job.id, 4, job.version)).rows[0].receipt).not.toBeNull();
  });
  it('preserves immutable source values while allowing reviewed amount corrections; skipped rows never commit', async () => {
    const f = await fixture();
    f.draft.rows[0].lines[0].sourceAmount = '999';
    let job = await createSilverImport(f.draft);
    expect(job.rows[0].issues).toContainEqual({ code: 'AMOUNT_CONFLICT', kind: 'S925' });
    const replacement = {
      ...f.draft.rows[0],
      original: {},
      lines: f.draft.rows[0].lines.map((line) => ({
        ...line,
        sourceAmount: '1700',
        amountConfirmed: true,
      })),
      skipped: true,
    };
    job = await updateSilverImport(job.id, { version: job.version, row: replacement });
    expect(job.rows[0].original).toEqual(f.row.original);
    expect(job.rows[0].lines[0].sourceAmount).toBe('999');
    await expect(commitSilverRow(job.id, 4, job.version)).rejects.toMatchObject({
      code: 'EXCEL_ROW_INVALID',
    });
    job = await updateSilverImport(job.id, {
      version: job.version,
      row: { ...replacement, skipped: false },
    });
    expect((await commitSilverRow(job.id, 4, job.version)).rows[0].receipt).not.toBeNull();
  });
  it('serializes concurrent submissions, keeps source rows separate and retries the remaining row without duplicates', async () => {
    const f = await fixture();
    const job = await createSilverImport({
      ...f.draft,
      rows: [f.draft.rows[0], { ...f.draft.rows[0], rowNumber: 5, allowDuplicate: true }],
    });
    const results = await Promise.allSettled([
      commitSilverRow(job.id, 4, 0),
      commitSilverRow(job.id, 5, 0),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    let current = await getSilverImport(job.id);
    const pending = current.rows.find((row) => !row.receipt)!;
    const { issues: _issues, similarBatchIds: _similar, receipt: _receipt, ...row } = pending;
    void _issues;
    void _similar;
    void _receipt;
    current = await updateSilverImport(job.id, {
      version: current.version,
      row: { ...row, allowDuplicate: true },
    });
    current = await commitSilverRow(job.id, pending.rowNumber, current.version);
    expect(current.rows.every((row) => row.receipt?.entryIds.length === 3)).toBe(true);
    expect(new Set(current.rows.map((row) => row.receipt!.batchId)).size).toBe(2);
  });
  it('runs independently after starting, records partial failures and atomically persists receipts with progress', async () => {
    const f = await fixture();
    const job = await createSilverImport({
      ...f.draft,
      rows: [
        f.draft.rows[0],
        { ...f.draft.rows[0], rowNumber: 5, distributorId: '' },
        { ...f.draft.rows[0], rowNumber: 6, allowDuplicate: true },
      ],
    });
    const results = await Promise.all([
      startSilverImport(job.id, { version: job.version, rowNumbers: [4, 5, 6] }),
      startSilverImport(job.id, { version: job.version, rowNumbers: [4, 5, 6] }),
    ]);
    expect(results.filter((result) => result.token)).toHaveLength(1);
    const started = results.find((result) => result.token)!;
    expect(started.job.progress).toMatchObject({ status: 'RUNNING', completed: [], failures: [] });
    expect(started.job).not.toHaveProperty('execution');
    expect(await db.materialBatchEntry.count({ where: { materialId: f.materials[0].id } })).toBe(0);
    await expect(
      updateSilverImport(job.id, { version: started.job.version, row: f.draft.rows[0] }),
    ).rejects.toMatchObject({ code: 'EXCEL_IMPORT_RUNNING' });
    await expect(commitSilverRow(job.id, 4, started.job.version)).rejects.toMatchObject({
      code: 'EXCEL_IMPORT_RUNNING',
    });
    const operationId = randomUUID();
    await auditContext.run(
      {
        operationId,
        source: 'background-test',
        actor: { id: 'silver-test', username: 'silver-test', nickname: '' },
      },
      () => runSilverImport(job.id, started.token!),
    );
    const current = await getSilverImport(job.id);
    expect(current.progress).toMatchObject({
      status: 'COMPLETED',
      completed: [4, 6],
      failures: [{ rowNumber: 5, code: 'EXCEL_ROW_INVALID' }],
    });
    expect(current.rows.map((row) => !!row.receipt)).toEqual([true, false, true]);
    expect(await db.materialBatchEntry.count({ where: { materialId: f.materials[0].id } })).toBe(2);
    expect(
      await db.auditLog.count({ where: { operationId, entityType: 'MaterialBatchEntry' } }),
    ).toBe(6);
    const taskLogs = await db.auditLog.findMany({
      where: { operationId, entityType: 'MaterialPricingImport' },
    });
    expect(taskLogs.length).toBeGreaterThan(0);
    expect(
      taskLogs.every((log) => (log.after as Record<string, unknown>).execution === '[内容已隐藏]'),
    ).toBe(true);
    // A late duplicate callback cannot create purchases after completion.
    await runSilverImport(job.id, started.token!);
    expect(await db.materialBatchEntry.count({ where: { materialId: f.materials[0].id } })).toBe(2);
  });
  it('restores durable checkpoints after expiry and fences the old worker when resuming', async () => {
    const f = await fixture();
    let job = await createSilverImport({
      ...f.draft,
      rows: [f.draft.rows[0], { ...f.draft.rows[0], rowNumber: 5, allowDuplicate: true }],
    });
    job = await commitSilverRow(job.id, 4, job.version);
    const receipt = job.rows[0].receipt;
    const started = await startSilverImport(job.id, { version: job.version, rowNumbers: [5] });
    const stored = await db.materialPricingImport.findUniqueOrThrow({ where: { id: job.id } });
    const execution = stored.execution as Record<string, unknown>;
    await db.materialPricingImport.update({
      where: { id: job.id },
      data: {
        execution: {
          ...execution,
          rowNumbers: [4, 5],
          completed: [4],
          leaseUntil: new Date(Date.now() - 1000).toISOString(),
        },
      },
    });
    job = await getSilverImport(job.id);
    expect(job.progress).toMatchObject({ status: 'INTERRUPTED', completed: [4] });
    const resumed = await startSilverImport(job.id, { version: job.version, resume: true });
    expect(resumed.token).not.toBe(started.token);
    await runSilverImport(job.id, started.token!);
    expect((await getSilverImport(job.id)).rows[1].receipt).toBeNull();
    await runSilverImport(job.id, resumed.token!);
    job = await getSilverImport(job.id);
    expect(job.progress).toMatchObject({ status: 'COMPLETED', completed: [4, 5] });
    expect(job.rows[0].receipt).toEqual(receipt);
    expect(await db.materialBatchEntry.count({ where: { materialId: f.materials[0].id } })).toBe(2);
  });
});
