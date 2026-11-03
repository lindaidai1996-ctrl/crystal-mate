import {
  emptyExcelValues,
  excelFields,
  type ColumnMapping,
  type ExcelRowInput,
} from '@/lib/cabochonExcelImport/contracts';
import type { WorkbookImage, WorkbookSheet } from '@/lib/cabochonExcelImport/workbook';
import { normalizeExcelCostNotes } from '@/lib/cabochonExcelImport/normalize';

export type LocalImage = { id: string; file: File; preview: string };
export type LocalExcelRow = ExcelRowInput & { localImages: LocalImage[] };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function prepareImage(image: WorkbookImage): Promise<LocalImage> {
  const bytes = image.bytes;
  const type =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'image/jpeg'
      : bytes[0] === 0x89 && bytes[1] === 0x50
        ? 'image/png'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
            String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
          ? 'image/webp'
          : '';
  let file: File;
  if (type) file = new File([new Uint8Array(bytes)], image.fileName, { type });
  else {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    try {
      if (bitmap.width * bitmap.height > 40_000_000) throw new Error('IMAGE_TOO_LARGE');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('IMAGE_INVALID');
      context.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('IMAGE_INVALID'))),
          'image/png',
        ),
      );
      file = new File([blob], `${image.fileName}.png`, { type: 'image/png' });
    } finally {
      bitmap.close();
    }
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE');
  return { id: image.id, file, preview: URL.createObjectURL(file) };
}

export async function prepareWorkbookRows(
  sheet: WorkbookSheet,
  headerRow: number,
  mapping: ColumnMapping,
  trackPreview: (url: string) => void,
): Promise<LocalExcelRow[]> {
  const header = sheet.rows.find((row) => row.rowNumber === headerRow);
  const cache = new Map<string, LocalImage | null>();
  const result: LocalExcelRow[] = [];
  for (const row of sheet.rows.filter((row) => row.rowNumber > headerRow)) {
    const values = emptyExcelValues();
    for (const field of excelFields) values[field] = row.cells[mapping[field] ?? ''] ?? '';
    if (
      !Object.values(values).some((value) => value.trim()) &&
      !row.images.length &&
      !row.imageErrors.length
    )
      continue;
    const localImages: LocalImage[] = [];
    const imageErrors = [...row.imageErrors];
    for (const image of row.images) {
      if (!cache.has(image.id)) {
        try {
          const prepared = await prepareImage(image);
          trackPreview(prepared.preview);
          cache.set(image.id, prepared);
        } catch {
          cache.set(image.id, null);
        }
      }
      const prepared = cache.get(image.id);
      if (prepared) localImages.push(prepared);
      else imageErrors.push('IMAGE_INVALID');
    }
    if (values.image.trim() && !row.images.length && !imageErrors.length)
      imageErrors.push('CELL_IMAGE_MISSING');
    if (localImages.length > 12) imageErrors.push('TOO_MANY_IMAGES');
    result.push({
      rowNumber: row.rowNumber,
      values: normalizeExcelCostNotes(values),
      sourceStyle: values.style,
      original: Object.entries(row.cells).map(([column, value]) => ({
        column: `${column} ${header?.cells[column] ?? ''}`.trim().slice(0, 255),
        value,
      })),
      localImages: localImages.slice(0, 12),
      imageKeys: [],
      imageErrors: imageErrors.slice(0, 20),
      ignoreImageErrors: false,
      tagChoice: 'AUTO',
      tagId: null,
    });
  }
  return result;
}
