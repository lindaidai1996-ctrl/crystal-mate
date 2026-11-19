import 'dotenv/config';
import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { callReceiptVision, RECEIPT_PROMPT_VERSION } from '../src/lib/attachment-recognition';
import { imageRecognitionModels } from '../src/lib/ai/imageRecognition';

async function main() {
  if (!process.argv.includes('--real')) {
    console.log(
      'Offline by default. Use --real --dev to send a synthetic receipt to a configured vision model.',
    );
    return;
  }
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (!process.argv.includes('--dev') || target.pathname !== '/crystal_mate_dev')
    throw new Error(
      'Real checks require --dev and the development configuration. No database records are written.',
    );
  const arg = process.argv.find((a) => a.startsWith('--provider='))?.slice('--provider='.length);
  const provider =
    arg ??
    imageRecognitionModels().find((a) => a.configured && a.id === 'compatible')?.id ??
    imageRecognitionModels().find((a) => a.configured)?.id;
  if (!provider) throw new Error('No configured vision model.');
  // Deliberately fictional fixture, with distinct seller and buyer and two dates.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="950"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="sans-serif" font-size="36"><text x="70" y="90" font-size="52">SUPPLIER INVOICE - SYNTHETIC TEST</text><text x="70" y="190">SELLER: Crystal Test Supplier</text><text x="70" y="250">Seller phone: 13800138000</text><text x="70" y="310">Seller address: 10 Test Road</text><text x="70" y="430">BUYER: Test Buyer</text><text x="70" y="490">Buyer phone: 13900139000</text><text x="70" y="600">Invoice date: 2026-11-19</text><text x="70" y="670">Delivery date: 2026-11-18</text><text x="70" y="800">Total: 500.00 - do not extract financial details</text></g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const dir = join(
    process.cwd(),
    'backups',
    'shared-attachments',
    `real-check-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'synthetic-receipt.png'), bytes);
  const key = `images/${crypto.randomUUID()}.png`;
  const path = join(process.cwd(), 'public/uploads', key);
  await mkdir(join(process.cwd(), 'public/uploads/images'), { recursive: true });
  await writeFile(path, bytes);
  const before = process.env.MEDIA_STORAGE;
  process.env.MEDIA_STORAGE = 'local';
  const started = Date.now();
  try {
    const response = await callReceiptVision(provider, key);
    const checks = {
      seller: response.result.seller.name === 'Crystal Test Supplier',
      buyer: response.result.buyer.name === 'Test Buyer',
      sellerPhone: response.result.seller.phone === '13800138000',
      buyerPhone: response.result.buyer.phone === '13900139000',
      bothDates: ['2026-11-19', '2026-11-18'].every((value) =>
        response.result.dates.some((date) => date.value === value),
      ),
    };
    const report = {
      provider,
      promptVersion: RECEIPT_PROMPT_VERSION,
      elapsedMs: Date.now() - started,
      ...response,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          report: dir,
          model: response.model,
          usage: response.usage,
          checks,
          passed: report.passed,
        },
        null,
        2,
      ),
    );
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    await writeFile(
      join(dir, 'failure.json'),
      JSON.stringify({
        provider,
        promptVersion: RECEIPT_PROMPT_VERSION,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'failed',
      }),
    );
    throw error;
  } finally {
    if (before === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = before;
    await unlink(path);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Recognition check failed');
  process.exitCode = 1;
});
