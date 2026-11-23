import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { procurementTransaction } from '@/lib/material-pricing/transaction';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { writeProcurementInTransaction } from '@/lib/material-pricing/purchase-service';
import {
  createSilverImportSchema,
  updateSilverImportSchema,
  silverDraftRowSchema,
  silverProcurement,
  startSilverImportSchema,
  silverExecutionSchema,
  silverImportProgress,
  type SilverExecution,
  type SilverImport,
} from './contracts';
import { silverRowIssues } from './normalize';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const rowList = z.array(silverDraftRowSchema);
async function reviewed(
  tx: Tx,
  job: {
    id: string;
    fileHash: string;
    fileName: string;
    sheetName: string;
    version: number;
    rows: unknown;
    updatedAt: Date;
    execution?: unknown;
  },
): Promise<SilverImport> {
  const rows = rowList.parse(job.rows);
  const materialIds = [
    ...new Set(rows.flatMap((row) => row.lines.map((line) => line.materialId)).filter(Boolean)),
  ];
  const [entries, materials, suppliers] = await Promise.all([
    tx.materialBatchEntry.findMany({
      where: { materialId: { in: materialIds } },
      select: {
        batchId: true,
        materialId: true,
        distributorId: true,
        purchaseTotalAmount: true,
        purchaseTotalWeightGrams: true,
        batch: { select: { receivedAt: true } },
      },
      take: 5001,
    }),
    tx.material.findMany({
      where: { id: { in: materialIds }, unit: 'GRAM', pricingGroupId: { not: null } },
      select: { id: true },
    }),
    tx.distributor.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.distributorId).filter(Boolean))] } },
      select: { id: true },
    }),
  ]);
  if (entries.length > 5000) throw new ApiError(400, 'PRICING_PURCHASE_LIMIT');
  const materialSet = new Set(materials.map((item) => item.id)),
    supplierSet = new Set(suppliers.map((item) => item.id));
  return {
    id: job.id,
    fileHash: job.fileHash,
    fileName: job.fileName,
    sheetName: job.sheetName,
    version: job.version,
    progress: silverImportProgress(job.execution),
    updatedAt: job.updatedAt.toISOString(),
    rows: rows.map((row) => {
      const issues = silverRowIssues(row);
      if (row.distributorId && !supplierSet.has(row.distributorId))
        issues.push({ code: 'SUPPLIER_REQUIRED' });
      for (const line of row.lines)
        if (line.materialId && !materialSet.has(line.materialId))
          issues.push({ code: 'MATERIAL_REQUIRED', kind: line.kind });
      const parsed = silverProcurement(row);
      const similarBatchIds = parsed.success
        ? [
            ...new Set(
              entries
                .filter(
                  (entry) =>
                    entry.batchId !== row.receipt?.batchId &&
                    entry.distributorId === row.distributorId &&
                    entry.batch.receivedAt.toISOString().slice(0, 10) === row.receivedAt &&
                    parsed.data.lines.some(
                      (line) =>
                        line.materialId === entry.materialId &&
                        entry.purchaseTotalAmount?.eq(line.amount) &&
                        entry.purchaseTotalWeightGrams?.eq(line.weight),
                    ),
                )
                .map((entry) => entry.batchId),
            ),
          ]
        : [];
      if (similarBatchIds.length && !row.allowDuplicate) issues.push({ code: 'SIMILAR_PURCHASE' });
      return { ...row, issues, similarBatchIds };
    }),
  };
}
export async function listSilverImports() {
  const jobs = await db.materialPricingImport.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  return jobs.map((job) => ({
    id: job.id,
    fileName: job.fileName,
    sheetName: job.sheetName,
    updatedAt: job.updatedAt.toISOString(),
    total: rowList.parse(job.rows).length,
    committed: rowList.parse(job.rows).filter((row) => row.receipt).length,
    progress: silverImportProgress(job.execution),
  }));
}
export async function getSilverImport(id: string) {
  z.uuid().parse(id);
  return db.$transaction(
    async (tx) => {
      const job = await tx.materialPricingImport.findUnique({ where: { id } });
      if (!job) throw new ApiError(404, 'NOT_FOUND');
      return reviewed(tx, job);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function createSilverImport(raw: unknown) {
  const input = createSilverImportSchema.parse(raw);
  return procurementTransaction(async (tx) => {
    const job = await tx.materialPricingImport.upsert({
      where: { fileHash_sheetName: { fileHash: input.fileHash, sheetName: input.sheetName } },
      update: {},
      create: { ...input, rows: json(input.rows.map((row) => ({ ...row, receipt: null }))) },
    });
    return reviewed(tx, job);
  });
}
export async function updateSilverImport(id: string, raw: unknown) {
  z.uuid().parse(id);
  const input = updateSilverImportSchema.parse(raw);
  return procurementTransaction(async (tx) => {
    const job = await tx.materialPricingImport.findUnique({ where: { id } });
    if (!job) throw new ApiError(404, 'NOT_FOUND');
    if (silverImportProgress(job.execution)?.status === 'RUNNING')
      throw new ApiError(409, 'EXCEL_IMPORT_RUNNING');
    const rows = rowList.parse(job.rows),
      index = rows.findIndex((row) => row.rowNumber === input.row.rowNumber);
    if (index < 0) throw new ApiError(404, 'NOT_FOUND');
    if (rows[index].receipt) throw new ApiError(409, 'EXCEL_ALREADY_COMMITTED');
    const original = rows[index];
    if (
      input.row.lines.length !== original.lines.length ||
      input.row.lines.some((line) => !original.lines.some((old) => old.kind === line.kind))
    )
      throw new ApiError(400, 'INVALID_INPUT');
    rows[index] = {
      ...input.row,
      original: original.original,
      date1904: original.date1904,
      sourceSupplier: original.sourceSupplier,
      lines: input.row.lines.map((line) => {
        const old = original.lines.find((item) => item.kind === line.kind)!;
        return {
          ...line,
          sourceWeight: old.sourceWeight,
          sourcePrice: old.sourcePrice,
          sourceAmount: old.sourceAmount,
        };
      }),
      receipt: null,
    };
    const changed = await tx.materialPricingImport.updateMany({
      where: { id, version: input.version },
      data: { rows: json(rows), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError(409, 'EXCEL_CONFLICT');
    return reviewed(tx, await tx.materialPricingImport.findUniqueOrThrow({ where: { id } }));
  });
}
export async function commitSilverRow(id: string, rowNumber: number, version: number) {
  z.uuid().parse(id);
  return procurementTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MaterialPricingImport" WHERE id = ${id}::uuid FOR UPDATE`;
    const job = await tx.materialPricingImport.findUnique({ where: { id } });
    if (!job) throw new ApiError(404, 'NOT_FOUND');
    if (silverImportProgress(job.execution)?.status === 'RUNNING')
      throw new ApiError(409, 'EXCEL_IMPORT_RUNNING');
    const draft = await reviewed(tx, job),
      row = draft.rows.find((item) => item.rowNumber === rowNumber);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (row.receipt) return draft;
    if (version !== job.version) throw new ApiError(409, 'EXCEL_CONFLICT');
    if (row.skipped || row.issues.length) throw new ApiError(400, 'EXCEL_ROW_INVALID');
    const parsed = silverProcurement(row);
    if (!parsed.success) throw new ApiError(400, 'EXCEL_ROW_INVALID');
    const receipt = await writeProcurementInTransaction(tx, {
      ...parsed.data,
      notes: `${job.fileName} / ${job.sheetName} / #${rowNumber}`,
    });
    const rows = rowList.parse(job.rows);
    rows.find((item) => item.rowNumber === rowNumber)!.receipt = {
      ...receipt,
      committedAt: new Date().toISOString(),
    };
    await tx.materialPricingImport.update({
      where: { id },
      data: { rows: json(rows), version: { increment: 1 } },
    });
    return reviewed(tx, await tx.materialPricingImport.findUniqueOrThrow({ where: { id } }));
  });
}

// Each worker step holds the same row lock as manual commits. The token fences late
// callbacks after a lease expires and another request resumes the durable task.
async function lockedImport(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "MaterialPricingImport" WHERE id = ${id}::uuid FOR UPDATE`;
  const job = await tx.materialPricingImport.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, 'NOT_FOUND');
  return job;
}
const lease = () => new Date(Date.now() + 60_000).toISOString();
const pendingRow = (execution: SilverExecution) =>
  execution.rowNumbers.find(
    (number) =>
      !execution.completed.includes(number) &&
      !execution.failures.some((failure) => failure.rowNumber === number),
  );
export async function startSilverImport(id: string, raw: unknown) {
  z.uuid().parse(id);
  const input = startSilverImportSchema.parse(raw);
  return procurementTransaction(async (tx) => {
    const job = await lockedImport(tx, id);
    // Retrying a start request while it is running must never launch a second worker.
    if (silverImportProgress(job.execution)?.status === 'RUNNING')
      return { job: await reviewed(tx, job), token: null };
    if (job.version !== input.version) throw new ApiError(409, 'EXCEL_CONFLICT');
    let execution: SilverExecution;
    if ('resume' in input) {
      if (silverImportProgress(job.execution)?.status !== 'INTERRUPTED')
        throw new ApiError(409, 'EXCEL_CONFLICT');
      execution = {
        ...silverExecutionSchema.parse(job.execution),
        token: randomUUID(),
        status: 'RUNNING',
        leaseUntil: lease(),
      };
    } else {
      const rows = rowList.parse(job.rows);
      if (
        input.rowNumbers.some(
          (number) => !rows.some((row) => row.rowNumber === number && !row.receipt && !row.skipped),
        )
      )
        throw new ApiError(400, 'EXCEL_ROW_INVALID');
      execution = {
        token: randomUUID(),
        status: 'RUNNING',
        rowNumbers: input.rowNumbers,
        completed: [],
        failures: [],
        leaseUntil: lease(),
      };
    }
    const updated = await tx.materialPricingImport.update({
      where: { id },
      data: { execution: json(execution), version: { increment: 1 } },
    });
    return { job: await reviewed(tx, updated), token: execution.token };
  });
}
async function silverImportStep(id: string, token: string, failureCode?: string): Promise<boolean> {
  return procurementTransaction(async (tx) => {
    const job = await lockedImport(tx, id);
    if (!job.execution) return false;
    const execution = silverExecutionSchema.parse(job.execution);
    if (execution.token !== token || silverImportProgress(execution)?.status !== 'RUNNING')
      return false;
    const number = pendingRow(execution);
    if (number === undefined) return false;
    const rows = rowList.parse(job.rows);
    const row = rows.find((item) => item.rowNumber === number);
    if (row?.receipt) execution.completed.push(number);
    else if (failureCode) execution.failures.push({ rowNumber: number, code: failureCode });
    else {
      const draft = await reviewed(tx, job);
      const current = draft.rows.find((item) => item.rowNumber === number);
      if (!current || current.skipped || current.issues.length)
        throw new ApiError(400, 'EXCEL_ROW_INVALID');
      const parsed = silverProcurement(current);
      if (!parsed.success) throw new ApiError(400, 'EXCEL_ROW_INVALID');
      const receipt = await writeProcurementInTransaction(tx, {
        ...parsed.data,
        notes: `${job.fileName} / ${job.sheetName} / #${number}`,
      });
      row!.receipt = { ...receipt, committedAt: new Date().toISOString() };
      execution.completed.push(number);
    }
    const remaining = pendingRow(execution) !== undefined;
    execution.status = remaining ? 'RUNNING' : 'COMPLETED';
    execution.leaseUntil = lease();
    await tx.materialPricingImport.update({
      where: { id },
      data: { rows: json(rows), execution: json(execution), version: { increment: 1 } },
    });
    return remaining;
  });
}
async function interruptSilverImport(id: string, token: string) {
  await procurementTransaction(async (tx) => {
    const job = await lockedImport(tx, id);
    if (!job.execution) return;
    const execution = silverExecutionSchema.parse(job.execution);
    if (execution.token !== token || execution.status !== 'RUNNING') return;
    execution.status = 'INTERRUPTED';
    await tx.materialPricingImport.update({
      where: { id },
      data: { execution: json(execution), version: { increment: 1 } },
    });
  });
}
export async function runSilverImport(id: string, token: string) {
  const deadline = Date.now() + 240_000;
  try {
    while (Date.now() < deadline) {
      let more: boolean;
      try {
        more = await silverImportStep(id, token);
      } catch (error) {
        // An entire source row has rolled back. Persist a safe code, then continue.
        if (!(error instanceof ApiError) || error.status >= 500) throw error;
        more = await silverImportStep(id, token, error.code);
      }
      if (!more) return;
    }
  } catch (error) {
    console.error(
      'Silver import worker interrupted',
      error instanceof ApiError ? error.code : 'SERVER_ERROR',
    );
  }
  await interruptSilverImport(id, token);
}
