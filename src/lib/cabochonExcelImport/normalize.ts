import { amountToCents, calculateCostTotal, centsToAmount } from '@/lib/cabochon-cost';
import { parseMeasurement } from '@/lib/parse-measurement';
import { settingStyleSchema } from '@/lib/validation';
import { expandColorTypeTags } from '@/lib/name-tag-matching';
import { excelFields, type ColumnMapping, type ExcelField, type ExcelRowInput } from './contracts';

const aliases: Record<ExcelField, string[]> = {
  nickname: ['蛋面艺名', '艺名'],
  type: ['蛋面类型', '类型'],
  style: ['魔盒款式'],
  image: ['图片', '蛋面图片', '照片'],
  roughStoneCost: ['水晶原价', '裸石成本', '裸石成本元'],
  settingCost: ['配托估价', '镶嵌成本', '镶嵌成本元'],
  price: ['售价', '售价元'],
  correctedPrice: ['修正后', '修正', '修正后修正', '修正后售价', '修正售价'],
  measurement: ['尺寸裸蛋带镶嵌', '尺寸裸蛋带镶嵌mm', '尺寸', '尺寸mm'],
  notes: ['水晶状态备注', '商品备注', '备注'],
  videoShot: ['是否已拍摄', '已拍摄商品视频'],
  published: ['是否已发布'],
  sold: ['是否卖出', '是否已卖出', '是否售出'],
};
const normalizeHeader = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\s（）()\[\]【】/\\：:]/g, '')
    .toLowerCase();

export function detectColumns(cells: Record<string, string>): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of excelFields) {
    const matches = Object.entries(cells).filter(([, value]) =>
      aliases[field].includes(normalizeHeader(value)),
    );
    if (matches.length === 1) mapping[field] = matches[0][0];
  }
  return mapping;
}

export function parseExcelBoolean(value: string): boolean | null {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (!normalized) return false;
  if (
    [
      '是',
      '已',
      '√',
      '✓',
      '✔',
      '1',
      'true',
      'yes',
      'y',
      '已拍摄',
      '已发布',
      '已卖出',
      '已售出',
    ].includes(normalized)
  )
    return true;
  if (
    [
      '否',
      '未',
      '×',
      '✕',
      '✗',
      '0',
      'false',
      'no',
      'n',
      '未拍摄',
      '未发布',
      '未卖出',
      '未售出',
    ].includes(normalized)
  )
    return false;
  return null;
}

export function parseExcelAmount(value: string): string | null {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/^[¥￥]\s*/, '')
    .replace(/\s*元$/, '');
  // Separators must be valid thousands groups; malformed amounts stay visible for correction.
  const plain = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(normalized)
    ? normalized.replace(/,/g, '')
    : normalized;
  const cents = amountToCents(plain);
  return cents === null ? null : centsToAmount(cents);
}

export function normalizeExcelCostNotes(values: ExcelRowInput['values']) {
  const originalCost = values.roughStoneCost.trim();
  if (!originalCost || parseExcelAmount(originalCost) !== null) return values;
  return {
    ...values,
    roughStoneCost: '0.00',
    notes: [values.notes.trim(), `水晶原价：${originalCost}`].filter(Boolean).join('\n'),
  };
}

export type MatchItem = { id: string; name: string };
export const excelTagSource = (row: ExcelRowInput) =>
  row.values.type.trim() || row.productName?.trim() || '';
export function normalizeExcelRow(
  row: ExcelRowInput,
  tags: MatchItem[],
  styles: { id: string; magicBoxStyle: string }[],
) {
  const values = normalizeExcelCostNotes(row.values);
  const errors: string[] = [];
  const warnings: string[] = [];
  const type = values.type.trim();
  const generatedName = [values.nickname.trim(), type || '未知'].filter(Boolean).join('-');
  const name = row.productName == null ? generatedName : row.productName.trim();
  if (!name) errors.push('NAME_REQUIRED');
  if (name.length > 120) errors.push('NAME_TOO_LONG');
  if (values.notes.trim().length > 10000) errors.push('NOTES_TOO_LONG');
  const chosenPrice = values.correctedPrice.trim() || values.price.trim();
  const price = chosenPrice ? parseExcelAmount(chosenPrice) : '0.00';
  if (price === null || Number(amountToCents(price)!) > 2147483647) errors.push('PRICE_INVALID');
  const roughStoneCost = values.roughStoneCost.trim()
    ? parseExcelAmount(values.roughStoneCost)
    : null;
  const settingCost = values.settingCost.trim() ? parseExcelAmount(values.settingCost) : null;
  if (values.roughStoneCost.trim() && roughStoneCost === null) errors.push('STONE_COST_INVALID');
  if (values.settingCost.trim() && settingCost === null) errors.push('SETTING_COST_INVALID');
  const details = {
    roughStoneCost,
    settingCost,
    otherCosts: [],
    totalCost: null,
    totalManual: false,
  };
  const totalCost = calculateCostTotal(details);
  if ((roughStoneCost !== null || settingCost !== null) && totalCost === null)
    errors.push('TOTAL_COST_INVALID');
  const cost = totalCost === null ? null : { ...details, totalCost };
  const measurementText =
    values.measurement
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  const measurement = measurementText ? parseMeasurement(measurementText) : null;
  if (measurementText && !measurement) warnings.push('MEASUREMENT_UNRECOGNIZED');
  const videoShot = parseExcelBoolean(values.videoShot);
  const published = parseExcelBoolean(values.published);
  const sold = parseExcelBoolean(values.sold);
  if (videoShot === null) errors.push('VIDEO_INVALID');
  if (published === null) errors.push('PUBLISHED_INVALID');
  if (sold === null) errors.push('SOLD_INVALID');
  let tagIds: string[] = [];
  let missingTags: string[] = [];
  if (row.tagChoice === 'SELECT') {
    const selected = [...new Set(row.tagIds ?? (row.tagId ? [row.tagId] : []))];
    if (!selected.length || selected.some((id) => !tags.some((tag) => tag.id === id)))
      errors.push('TAG_UNMATCHED');
    else tagIds = selected;
  } else if (row.tagChoice === 'AUTO' && (type || row.tagMatch)) {
    const exact = tags.find((tag) => tag.name.trim() === type);
    const match =
      row.tagMatch?.source === excelTagSource(row)
        ? row.tagMatch
        : !row.tagMatch && exact
          ? { tagIds: [exact.id], missingTags: [] }
          : null;
    if (!match) errors.push('TAG_UNMATCHED');
    else {
      const expanded = expandColorTypeTags(match, tags);
      missingTags = expanded.missingTags;
      if (
        (!expanded.tagIds.length && !!type) ||
        expanded.tagIds.some((id) => !tags.some((tag) => tag.id === id))
      )
        errors.push('TAG_UNMATCHED');
      else tagIds = expanded.tagIds;
    }
    if (missingTags.length) warnings.push('TAG_MISSING');
  }
  const style =
    row.styleChoice === 'NONE'
      ? undefined
      : row.styleChoice === 'SELECT'
        ? styles.find((style) => style.id === row.styleId)
        : styles.find((style) => style.magicBoxStyle.trim() === values.style.trim());
  const magicBoxStyle =
    row.styleChoice === 'NONE' ? '' : (style?.magicBoxStyle ?? values.style.trim());
  if (row.styleChoice === 'SELECT' && !style) errors.push('STYLE_UNAVAILABLE');
  if (row.styleChoice === 'NEW' && !magicBoxStyle) errors.push('STYLE_REQUIRED');
  if (magicBoxStyle && !settingStyleSchema.safeParse({ magicBoxStyle }).success)
    errors.push('STYLE_INVALID');
  else if (magicBoxStyle && !style) warnings.push('STYLE_UNMATCHED');
  if (row.imageErrors.length && !row.ignoreImageErrors) errors.push('IMAGE_FAILED');
  return {
    errors,
    warnings,
    name,
    generatedName,
    notes: values.notes.trim(),
    price: price ?? '0.00',
    cost,
    measurement,
    measurementText,
    tagIds,
    missingTags,
    magicBoxStyle,
    settingStyleId: style?.id ?? null,
    stock: sold ? 0 : 1,
    marketing: {
      videoShot: videoShot ?? false,
      xiaohongshuVideoPublished: published ?? false,
      xiaohongshuListed: published ?? false,
      douyinVideoPublished: false,
      douyinListed: false,
    },
  };
}
