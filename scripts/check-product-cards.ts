import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { db } from '../src/lib/db';
import { cardProduct, sourceForCard } from '../src/lib/product-cards/service';
import { renderProductCard } from '../src/lib/product-cards/render';
import { storageImage } from '../src/lib/cached-storage-image';
import {
  cardTemplates,
  emptyCardBrand,
  type CardFields,
  type CardQuote,
} from '../src/lib/product-cards/contracts';

// Read-only business access. All generated files go to the ignored QA directory.
async function main() {
  const productId =
    process.argv[2] ??
    (
      await db.product.findFirst({
        where: { origin: 'DIY', images: { some: {} }, diyRuns: { some: {} } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
    )?.id;
  if (!productId) throw new Error('No DIY product with an image is available for visual QA.');
  const product = await cardProduct(productId);
  const source = sourceForCard(product, product.diyRuns[0]?.id ?? null);
  if (!source || !source.images.length) throw new Error('Missing source.');
  const destination = resolve('.cache/product-card-qa');
  await mkdir(destination, { recursive: true });
  const ids = [1, 2, 3].map((index) => `00000000-0000-4000-8000-00000000000${index}`);
  const assets = new Map<string, Buffer>();
  for (let index = 0; index < 3; index++) {
    const original = source.images[index % source.images.length];
    assets.set(ids[index], (await storageImage(original.objectKey)).bytes);
  }
  const quote: CardQuote = source.quote ?? {
    currency: product.currency,
    rows: [
      {
        name: '测试物料（仅用于排版验证）',
        specification: '8 × 8 × 8 mm',
        quantity: '12 颗',
        unitPrice: '10.00',
        subtotal: '120.00',
      },
      {
        name: '手工设计费',
        specification: '整批费用按制作数量分摊',
        quantity: '1 件',
        unitPrice: '33.33',
        subtotal: '33.33',
      },
    ],
    total: '153.33',
    craftAllocated: true,
  };
  const contact: { input: Buffer; left: number; top: number }[] = [];
  const records: { file: string; width: number; height: number; bytes: number }[] = [];
  let row = 0;
  for (const count of [1, 2, 3])
    for (const includeDetails of [false, true]) {
      for (let column = 0; column < cardTemplates.length; column++) {
        const template = cardTemplates[column];
        const fields: CardFields = {
          title: '视觉验证',
          template,
          displayName: product.name,
          mainMaterials: source.materials,
          philosophy:
            '每一件用心完成的作品，都有自己的节奏。愿你在日常的细微之处，留住一份从容，慢慢走向心之所向。',
          images: ids.slice(0, count).map((assetId) => ({ assetId, framing: { mode: 'contain' } })),
          includeDetails,
          brand: { ...emptyCardBrand, name: '祝余 IWISH' },
        };
        const png = await renderProductCard(fields, quote, assets);
        const file = `${template}-${count}-${includeDetails ? 'details' : 'clean'}.png`;
        await writeFile(join(destination, file), png);
        const metadata = await sharp(png).metadata();
        if (metadata.width !== 1080 || !metadata.height || metadata.height < 630)
          throw new Error(`Invalid output dimensions: ${file}`);
        records.push({ file, width: metadata.width, height: metadata.height, bytes: png.length });
        contact.push({
          input: await sharp(png)
            .resize({ width: 324, height: 720, fit: 'contain', background: '#dde2d8' })
            .png()
            .toBuffer(),
          left: column * 340 + 8,
          top: row * 736 + 8,
        });
      }
      row++;
    }
  await sharp({ create: { width: 1020, height: row * 736, channels: 3, background: '#dde2d8' } })
    .composite(contact)
    .png()
    .toFile(join(destination, 'contact-sheet.png'));
  const longFields: CardFields = {
    title: '长内容验证',
    template: 'natural',
    displayName: '长商品名称与多行中文排版验证'.repeat(5).slice(0, 80),
    mainMaterials: Array.from({ length: 12 }, (_, i) => `物料${i + 1}与规格说明`),
    philosophy: '在日常细微之处留住从容，慢慢走向心之所向。'.repeat(7).slice(0, 180),
    images: [{ assetId: ids[0], framing: { mode: 'contain' } }],
    includeDetails: true,
    brand: { ...emptyCardBrand, name: '祝余 IWISH' },
  };
  const longQuote = {
    ...quote,
    rows: Array.from({ length: 30 }, (_, index) => ({
      ...quote.rows[index % quote.rows.length],
      name: `第${index + 1}项 · 较长的物料名称用于多行换行检查`,
    })),
  };
  await writeFile(
    join(destination, 'long-content.png'),
    await renderProductCard(longFields, longQuote, assets),
  );
  await writeFile(
    join(destination, 'report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        productId,
        combinations: records,
        longContent: 'long-content.png',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        destination,
        combinations: records.length,
        sourceQuoteAvailable: Boolean(source.quote),
        dimensions: records.map(({ file, height }) => ({ file, height })),
      },
      null,
      2,
    ),
  );
}
main()
  .finally(() => db.$disconnect())
  .catch(() => {
    console.error(
      'Product card visual QA failed. Check the local assets, fonts and development database.',
    );
    process.exitCode = 1;
  });
