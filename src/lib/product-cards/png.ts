import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from '@/lib/api';
import type { CardFields, CardQuote } from './contracts';
import { CARD_TEMPLATE_VERSION } from './contracts';
import { readCardAsset } from './assets';
import { renderProductCard } from './render';

let queue: Promise<void> = Promise.resolve();
let pending = 0;
const inFlight = new Map<string, Promise<Buffer>>();
const cacheRoot = () => join(process.cwd(), '.cache/product-cards');
async function trimCache() {
  const files = (await readdir(cacheRoot()))
    .filter((file) => /^\d+-[a-f0-9]{64}\.png$/.test(file))
    .sort();
  for (const file of files.slice(0, Math.max(0, files.length - 60)))
    await unlink(join(cacheRoot(), file)).catch(() => {});
}
export async function cardPng(
  fields: CardFields,
  quote: CardQuote | null,
  templateVersion = CARD_TEMPLATE_VERSION,
) {
  const content: CardFields = {
    title: fields.title,
    template: fields.template,
    displayName: fields.displayName,
    mainMaterials: fields.mainMaterials,
    philosophy: fields.philosophy,
    images: fields.images,
    includeDetails: fields.includeDetails,
    brand: fields.brand,
  };
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        fields: content,
        quote: content.includeDetails ? quote : null,
        templateVersion,
      }),
    )
    .digest('hex');
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (pending >= 4) throw new ApiError(429, 'CARD_RENDER_BUSY');
  pending++;
  const task = queue
    .then(async () => {
      await mkdir(cacheRoot(), { recursive: true });
      const files = await readdir(cacheRoot());
      const cached = files.find((file) => file.endsWith(`-${key}.png`));
      if (cached) return readFile(join(cacheRoot(), cached));
      const ids = [
        ...new Set([
          ...fields.images.map((image) => image.assetId!),
          ...(fields.brand.showLogo && fields.brand.logoAssetId ? [fields.brand.logoAssetId] : []),
          ...(fields.brand.showContact && fields.brand.qrAssetId ? [fields.brand.qrAssetId] : []),
        ]),
      ];
      const assets = new Map<string, Buffer>();
      for (const id of ids) assets.set(id, await readCardAsset(id));
      const png = await renderProductCard(fields, quote, assets, templateVersion);
      const path = join(cacheRoot(), `${Date.now()}-${key}.png`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, png);
      await rename(temporary, path);
      await trimCache();
      return png;
    })
    .finally(() => {
      pending--;
      inFlight.delete(key);
    });
  queue = task.then(
    () => {},
    () => {},
  );
  inFlight.set(key, task);
  return task;
}
