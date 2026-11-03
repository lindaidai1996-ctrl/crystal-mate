import type { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { recognizeImage } from '@/lib/ai/imageRecognition';
import {
  importItemDataSchema,
  type ImportRecognitionPreview,
  type recognizeImportItemSchema,
} from './contracts';
import { readImportSource } from './sourceImage';

// Recognition is a preview: no candidates, material configuration or inventory are written.
export async function recognizeImageImportItem(
  id: string,
  input: z.infer<typeof recognizeImportItemSchema>,
): Promise<ImportRecognitionPreview> {
  async function readCurrent() {
    const job = await db.materialImageImport.findUnique({
      where: { id },
      include: { items: { where: { id: input.itemId } } },
    });
    if (!job) throw new ApiError(404, 'NOT_FOUND');
    if (
      job.archivedAt ||
      job.version !== input.version ||
      (job.status === 'PROCESSING' && job.leaseUntil && job.leaseUntil > new Date())
    )
      throw new ApiError(409, 'IMPORT_CONFLICT');
    const item = job.items[0];
    if (!item) throw new ApiError(404, 'NOT_FOUND');
    if (item.entryId) throw new ApiError(409, 'IMPORT_ALREADY_COMMITTED');
    return { job, data: importItemDataSchema.parse(item.data) };
  }
  const { job, data } = await readCurrent();
  const result = await recognizeImage(
    input.provider,
    await readImportSource(job.sourceKey),
    data.priceKind,
    { objectBox: input.objectBox, priceBox: input.priceBox },
  );
  await readCurrent();
  if (result.items.length !== 1) throw new ApiError(502, 'IMPORT_SINGLE_RESULT_REQUIRED');
  return {
    itemId: input.itemId,
    version: input.version,
    data: {
      ...result.items[0],
      warnings: [...result.items[0].warnings, ...result.warnings].slice(0, 10),
    },
  };
}
