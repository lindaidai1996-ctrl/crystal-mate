import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement, type CSSProperties, type ReactNode } from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { ApiError } from '@/lib/api';
import type { ImageFraming } from '@/lib/image-framing';
import { CARD_TEMPLATE_VERSION, type CardFields, type CardQuote } from './contracts';

const palettes = {
  natural: {
    paper: '#f6f5ed',
    ink: '#304c3f',
    muted: '#728375',
    line: '#cfd6c8',
    photo: '#e9ede3',
  },
  editorial: {
    paper: '#f5f0e9',
    ink: '#292d29',
    muted: '#777a6f',
    line: '#c9c6b9',
    photo: '#e8e4db',
  },
  poetic: { paper: '#f2eee4', ink: '#35433b', muted: '#7d8271', line: '#c9ccbd', photo: '#e4e6db' },
};
function block(style: CSSProperties, ...children: ReactNode[]) {
  return createElement(
    'div',
    {
      style: { display: 'flex', boxSizing: 'border-box', minWidth: 0, maxWidth: '100%', ...style },
    },
    ...children,
  );
}
function text(value: string, style: CSSProperties = {}) {
  return block({ whiteSpace: 'pre-wrap', wordBreak: 'break-all', flexShrink: 1, ...style }, value);
}
function rule(color: string) {
  return block({ width: '100%', height: 1, backgroundColor: color, flexShrink: 0 });
}
function dataUri(bytes: Buffer) {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

let fonts: Promise<{ name: string; data: Buffer; weight: 400; style: 'normal' }[]> | undefined;
function loadFonts() {
  return (fonts ??= Promise.all(
    ['Sans', 'Serif'].map(async (name) => ({
      name: `Card${name}`,
      weight: 400 as const,
      style: 'normal' as const,
      data: await readFile(
        join(process.cwd(), 'assets/product-card-fonts', `Noto${name}SC-Regular.otf`),
      ),
    })),
  ).catch((error) => {
    fonts = undefined;
    throw error;
  }));
}

async function normalizedImage(bytes: Buffer, framing?: ImageFraming) {
  try {
    let image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    const normalized = await image.png().toBuffer();
    image = sharp(normalized);
    if (framing?.mode === 'cover' && framing.crop) {
      const { width, height } = await image.metadata();
      if (!width || !height) throw new Error('Invalid dimensions');
      const crop = framing.crop;
      const left = Math.min(width - 1, Math.round((width * crop.x) / 100));
      const top = Math.min(height - 1, Math.round((height * crop.y) / 100));
      image = image.extract({
        left,
        top,
        width: Math.max(1, Math.min(width - left, Math.round((width * crop.width) / 100))),
        height: Math.max(1, Math.min(height - top, Math.round((height * crop.height) / 100))),
      });
    }
    return await image
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
  }
}

function photo(
  src: string,
  width: number,
  height: number,
  background: string,
  fit: 'contain' | 'cover',
) {
  return block(
    { width, height, backgroundColor: background, overflow: 'hidden', flexShrink: 0 },
    createElement('img', { src, width, height, style: { objectFit: fit } }),
  );
}
function gallery(card: CardFields, images: string[]) {
  const p = palettes[card.template];
  const width = card.template === 'editorial' ? 984 : card.template === 'poetic' ? 864 : 936;
  const height = card.template === 'poetic' ? 570 : 630;
  const item = (index: number, w: number, h: number) =>
    photo(
      images[index],
      w,
      h,
      p.photo,
      card.images[index].framing.mode === 'cover' ? 'cover' : 'contain',
    );
  if (images.length === 1) return item(0, width, height);
  if (images.length === 2) {
    const left = card.template === 'editorial' ? 610 : Math.floor((width - 16) * 0.59);
    return block(
      { width, gap: 16, alignItems: card.template === 'poetic' ? 'center' : 'flex-end' },
      item(0, left, height),
      item(1, width - left - 16, card.template === 'editorial' ? height - 100 : height),
    );
  }
  const left = Math.floor((width - 16) * 0.64);
  return block(
    { width, gap: 16 },
    item(0, left, height),
    block(
      { flexDirection: 'column', gap: 16 },
      item(1, width - left - 16, (height - 16) / 2),
      item(2, width - left - 16, (height - 16) / 2),
    ),
  );
}

function brandFooter(card: CardFields, images: Map<string, string>, legacyLayout: boolean) {
  const { brand } = card;
  const p = palettes[card.template];
  const hasLogo = brand.showLogo && brand.logoAssetId;
  const hasContact = brand.showContact && (brand.wechat || brand.qrAssetId);
  if (!hasLogo && !(brand.showName && brand.name) && !hasContact) return null;
  return block(
    {
      width: '100%',
      marginTop: legacyLayout ? 'auto' : 0,
      paddingTop: 32,
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
    },
    block(
      { alignItems: 'center', gap: 20, flex: 1, minWidth: 0 },
      hasLogo
        ? createElement('img', {
            src: images.get(brand.logoAssetId!),
            width: 72,
            height: 72,
            style: { objectFit: 'contain' },
          })
        : null,
      block(
        { flexDirection: 'column', gap: 10, flex: 1 },
        brand.showName && brand.name
          ? text(brand.name, { fontSize: 26, fontFamily: 'CardSerif', lineHeight: 1.5 })
          : null,
        hasContact && brand.wechat
          ? text(`微信  ${brand.wechat}`, { fontSize: 22, color: p.muted, lineHeight: 1.5 })
          : null,
      ),
    ),
    brand.showContact && brand.qrAssetId
      ? createElement('img', {
          src: images.get(brand.qrAssetId),
          width: 144,
          height: 144,
          style: { objectFit: 'contain', backgroundColor: '#ffffff' },
        })
      : null,
  );
}

function titleSize(name: string, base: number) {
  return name.length > 40 ? 42 : name.length > 20 ? 54 : base;
}
function cardBody(
  card: CardFields,
  images: string[],
  brandImages: Map<string, string>,
  legacyLayout: boolean,
) {
  const p = palettes[card.template];
  const minHeight = legacyLayout ? 1440 : undefined;
  const title = text(card.displayName, {
    fontFamily: 'CardSerif',
    fontSize: titleSize(card.displayName, card.template === 'editorial' ? 82 : 68),
    lineHeight: 1.35,
    letterSpacing: card.template === 'poetic' ? 5 : 1,
  });
  const materials = card.mainMaterials.length
    ? text(card.mainMaterials.join(' · '), {
        fontSize: 25,
        color: p.muted,
        lineHeight: 1.7,
        marginTop: 16,
      })
    : null;
  const philosophy = card.philosophy
    ? text(card.philosophy, {
        fontFamily: 'CardSerif',
        fontSize: card.philosophy.length > 100 ? 27 : 31,
        lineHeight: 1.9,
        marginTop: 28,
        color: p.ink,
      })
    : null;
  if (card.template === 'editorial')
    return block(
      { width: 1080, minHeight, padding: '48px', flexDirection: 'column', gap: 26 },
      block(
        { justifyContent: 'space-between', alignItems: 'center', fontSize: 20, letterSpacing: 4 },
        text('THE HANDMADE EDIT'),
        text('作品 / 成于用心'),
      ),
      rule(p.ink),
      title,
      gallery(card, images),
      block(
        { gap: 32, marginTop: 4 },
        text('MATERIAL\n& MEANING', {
          width: 180,
          flexShrink: 0,
          fontSize: 20,
          lineHeight: 1.6,
          color: p.muted,
          letterSpacing: 2,
        }),
        block({ flexDirection: 'column', flex: 1 }, materials, philosophy),
      ),
      brandFooter(card, brandImages, legacyLayout),
    );
  if (card.template === 'poetic')
    return block(
      {
        width: 1080,
        minHeight,
        padding: '64px 108px',
        flexDirection: 'column',
        alignItems: 'center',
      },
      block(
        { gap: 20, alignItems: 'center', marginBottom: 34 },
        block({ width: 42, height: 1, backgroundColor: p.muted }),
        text('一物 · 一念', {
          fontFamily: 'CardSerif',
          fontSize: 23,
          letterSpacing: 8,
          color: p.muted,
        }),
        block({ width: 42, height: 1, backgroundColor: p.muted }),
      ),
      title,
      block({ marginTop: 36 }, gallery(card, images)),
      block({ width: '100%', flexDirection: 'column', marginTop: 24 }, materials, philosophy),
      block({ width: 56, height: 2, backgroundColor: p.ink, marginTop: 36, marginBottom: 22 }),
      brandFooter(card, brandImages, legacyLayout),
    );
  return block(
    { width: 1080, minHeight, padding: '56px 72px', flexDirection: 'column' },
    block(
      { justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
      text('HANDCRAFTED / 用心之作', { fontSize: 20, letterSpacing: 2, color: p.muted }),
      block({ width: 64, height: 1, backgroundColor: p.muted }),
    ),
    gallery(card, images),
    block(
      { flexDirection: 'column', marginTop: 38, marginBottom: 32 },
      title,
      materials,
      philosophy,
    ),
    rule(p.line),
    brandFooter(card, brandImages, legacyLayout),
  );
}

export function cardMoney(amount: string, currency: string) {
  return `${currency === 'CNY' ? '¥' : `${currency} `}${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
function detailSection(card: CardFields, quote: CardQuote) {
  const p = palettes[card.template];
  return block(
    {
      width: 1080,
      padding: '56px 72px 64px',
      flexDirection: 'column',
      borderTop: `1px solid ${p.line}`,
    },
    block(
      { justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 },
      text('作品明细', { fontFamily: 'CardSerif', fontSize: 42 }),
      text('单件对客报价', { fontSize: 24, color: p.muted }),
    ),
    block(
      {
        padding: '18px 0',
        fontSize: 23,
        color: p.muted,
        borderTop: `1px solid ${p.ink}`,
        borderBottom: `1px solid ${p.line}`,
      },
      text('物料 / 费用', { width: 366 }),
      text('用量', { width: 150 }),
      text('单价', { width: 210, justifyContent: 'flex-end' }),
      text('小计', { width: 210, justifyContent: 'flex-end' }),
    ),
    ...quote.rows.map((row) =>
      block(
        {
          padding: '22px 0',
          alignItems: 'center',
          borderBottom: `1px solid ${p.line}`,
          fontSize: 26,
          lineHeight: 1.65,
        },
        block(
          { width: 366, paddingRight: 22, flexDirection: 'column' },
          text(row.name),
          row.specification ? text(row.specification, { fontSize: 21, color: p.muted }) : null,
        ),
        text(row.quantity, { width: 150, paddingRight: 12, fontSize: 23 }),
        text(row.unitPrice === null ? '—' : cardMoney(row.unitPrice, quote.currency), {
          width: 210,
          justifyContent: 'flex-end',
          paddingLeft: 14,
          fontSize: 23,
        }),
        text(cardMoney(row.subtotal, quote.currency), {
          width: 210,
          justifyContent: 'flex-end',
          paddingLeft: 14,
          fontSize: 25,
        }),
      ),
    ),
    block(
      { justifyContent: 'space-between', alignItems: 'center', paddingTop: 32 },
      text('单件合计', { fontSize: 30 }),
      text(cardMoney(quote.total, quote.currency), { fontSize: 46 }),
    ),
    quote.craftAllocated
      ? text('手工设计费按本次制作数量分摊，金额四舍五入至分。', {
          fontSize: 21,
          lineHeight: 1.7,
          color: p.muted,
          marginTop: 22,
        })
      : null,
  );
}

export async function renderProductCard(
  card: CardFields,
  quote: CardQuote | null,
  assets: Map<string, Buffer>,
  templateVersion = CARD_TEMPLATE_VERSION,
) {
  if (templateVersion !== 1 && templateVersion !== CARD_TEMPLATE_VERSION)
    throw new ApiError(422, 'CARD_TEMPLATE_UNSUPPORTED');
  if (card.includeDetails && !quote) throw new ApiError(400, 'CARD_QUOTE_INCOMPLETE');
  const sources: string[] = [];
  for (const image of card.images) {
    const bytes = image.assetId ? assets.get(image.assetId) : undefined;
    if (!bytes) throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
    sources.push(dataUri(await normalizedImage(bytes, image.framing)));
  }
  const brandImages = new Map<string, string>();
  for (const id of [
    card.brand.showLogo && card.brand.logoAssetId,
    card.brand.showContact && card.brand.qrAssetId,
  ]) {
    if (!id) continue;
    const bytes = assets.get(id);
    if (!bytes) throw new ApiError(422, 'CARD_IMAGE_UNAVAILABLE');
    brandImages.set(id, dataUri(await normalizedImage(bytes)));
  }
  const p = palettes[card.template];
  const tree = block(
    {
      width: 1080,
      flexDirection: 'column',
      backgroundColor: p.paper,
      color: p.ink,
      fontFamily: 'CardSans',
    },
    cardBody(card, sources, brandImages, templateVersion === 1),
    card.includeDetails && quote ? detailSection(card, quote) : null,
  );
  const svg = await satori(tree, { width: 1080, fonts: await loadFonts() });
  const height = Number(svg.match(/<svg[^>]*height="([\d.]+)"/)?.[1]);
  if (!Number.isFinite(height) || height > 14000) throw new ApiError(422, 'CARD_CAPACITY_EXCEEDED');
  const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
  if (png.length > 24 * 1024 * 1024) throw new ApiError(422, 'CARD_CAPACITY_EXCEEDED');
  return Buffer.from(png);
}
