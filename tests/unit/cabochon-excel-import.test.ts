import { describe, expect, it } from 'vitest';
import { emptyExcelValues, excelRowInputSchema } from '@/lib/cabochonExcelImport/contracts';
import {
  detectColumns,
  normalizeExcelCostNotes,
  normalizeExcelRow,
  parseExcelAmount,
  parseExcelBoolean,
} from '@/lib/cabochonExcelImport/normalize';
import {
  applyStyleReview,
  sourceStyle,
  suggestStyles,
} from '@/lib/cabochonExcelImport/styleReview';

const tag = { id: 'clx12345678901234567890123', name: '白幽灵' };
const style = { id: 'clx22345678901234567890123', magicBoxStyle: '银素边' };
function row(values = {}) {
  return excelRowInputSchema.parse({
    rowNumber: 2,
    values: { ...emptyExcelValues(), ...values },
    original: [],
    imageKeys: [],
    imageErrors: [],
  });
}

describe('cabochon spreadsheet conversion', () => {
  it.each(['赠品', '待核对', '100元 / 组', '1,2', '-10', '1.234'])(
    'imports nonnumeric original cost %s as zero and preserves it alongside existing notes',
    (roughStoneCost) => {
      const draft = row({ roughStoneCost, settingCost: '25', notes: '状态良好' });
      const normalized = normalizeExcelRow(draft, [], []);
      expect(normalized).toMatchObject({
        errors: [],
        notes: `状态良好\n水晶原价：${roughStoneCost}`,
        cost: { roughStoneCost: '0.00', settingCost: '25.00', totalCost: '25.00' },
      });
      const savedValues = normalizeExcelCostNotes(draft.values);
      expect(savedValues).toMatchObject({ roughStoneCost: '0.00', notes: normalized.notes });
      expect(normalizeExcelCostNotes(savedValues)).toEqual(savedValues);
      expect(normalizeExcelRow({ ...draft, values: savedValues }, [], [])).toEqual(normalized);
      expect(draft.values.roughStoneCost).toBe(roughStoneCost);
      expect(draft.values.notes).toBe('状态良好');
    },
  );
  it('keeps numeric and blank original costs unchanged and handles missing notes', () => {
    for (const roughStoneCost of ['', ' ', '0', '120', '￥1,250.50元']) {
      const values = row({ roughStoneCost, notes: '完好' }).values;
      expect(normalizeExcelCostNotes(values)).toBe(values);
    }
    expect(normalizeExcelRow(row({ roughStoneCost: '赠品' }), [], [])).toMatchObject({
      errors: [],
      notes: '水晶原价：赠品',
      cost: { roughStoneCost: '0.00', totalCost: '0.00' },
    });
  });
  it('checks the combined note length and still rejects invalid setting costs', () => {
    expect(
      normalizeExcelRow(row({ roughStoneCost: '赠品', notes: '字'.repeat(9998) }), [], []).errors,
    ).toContain('NOTES_TOO_LONG');
    expect(
      normalizeExcelRow(row({ roughStoneCost: '赠品', settingCost: '待定' }), [], []).errors,
    ).toContain('SETTING_COST_INVALID');
  });
  it('preserves manual names when source fields change and restores automatic naming explicitly', () => {
    const draft = { ...row({ nickname: '雪隐', type: '白幽灵' }), productName: ' 自定义商品名 ' };
    expect(normalizeExcelRow(draft, [tag], []).name).toBe('自定义商品名');
    draft.values.nickname = '新艺名';
    expect(normalizeExcelRow(draft, [tag], []).name).toBe('自定义商品名');
    expect(normalizeExcelRow({ ...draft, productName: null }, [tag], []).name).toBe(
      '新艺名-白幽灵',
    );
    expect(normalizeExcelRow({ ...draft, productName: ' ' }, [tag], []).errors).toContain(
      'NAME_REQUIRED',
    );
  });
  it('uses explicit style choices and never falls back from a missing selected ID to creating a style', () => {
    const draft = row({ style: 'Excel 原文' });
    expect(
      normalizeExcelRow({ ...draft, styleChoice: 'SELECT', styleId: style.id }, [], [style]),
    ).toMatchObject({
      magicBoxStyle: style.magicBoxStyle,
      settingStyleId: style.id,
      warnings: [],
      errors: [],
    });
    expect(
      normalizeExcelRow({ ...draft, styleChoice: 'SELECT', styleId: style.id }, [], []).errors,
    ).toContain('STYLE_UNAVAILABLE');
    expect(normalizeExcelRow({ ...draft, styleChoice: 'NONE' }, [], [style])).toMatchObject({
      magicBoxStyle: '',
      settingStyleId: null,
      warnings: [],
    });
    expect(normalizeExcelRow({ ...row(), styleChoice: 'NEW' }, [], []).errors).toContain(
      'STYLE_REQUIRED',
    );
    expect(
      normalizeExcelRow({ ...row({ style: '银素边' }), styleChoice: 'NEW' }, [], [style])
        .settingStyleId,
    ).toBe(style.id);
  });
  it('suggests whitespace, width, case and similar wording without changing the row or matching automatically', () => {
    const options = [
      { id: '1', magicBoxStyle: 'S925 银素边魔盒' },
      { id: '2', magicBoxStyle: 'S925 银四爪魔盒' },
      { id: '3', magicBoxStyle: 'S925 银花边魔盒' },
      { id: '4', magicBoxStyle: 'S925 银素边吊坠' },
      { id: '5', magicBoxStyle: '金丝编织' },
    ];
    const draft = row({ style: 'ｓ９２５银 素边魔盒' });
    expect(suggestStyles(draft.values.style, options)[0]).toEqual(options[0]);
    expect(suggestStyles(draft.values.style, options)).toHaveLength(3);
    expect(suggestStyles('金丝编织', options)).toEqual([]);
    expect(suggestStyles('', options)).toEqual([]);
    expect(suggestStyles('长'.repeat(61), options)).toEqual([]);
    expect(normalizeExcelRow(draft, [], options).settingStyleId).toBeNull();
    expect(draft.values.style).toBe('ｓ９２５银 素边魔盒');
  });
  it('applies a style decision only to matching uncommitted source strings and preserves other fields', () => {
    const first = { ...row({ style: '旧写法' }), sourceStyle: '旧写法' };
    const second = {
      ...row({ style: '曾修正', nickname: '另一商品', price: '500' }),
      rowNumber: 3,
      sourceStyle: '旧写法',
      productName: '手动名称',
    };
    const committed = {
      ...row({ style: '旧写法' }),
      rowNumber: 4,
      receipt: { productId: 'saved' },
    };
    const other = { ...row({ style: '其他' }), rowNumber: 5 };
    const rows = [first, second, committed, other];
    const edited = {
      ...first,
      sourceStyle: '不可覆盖原文',
      values: { ...first.values, style: '新名称' },
      styleChoice: 'NEW' as const,
    };
    const result = applyStyleReview(rows, edited, true);
    expect(result[0].sourceStyle).toBe('旧写法');
    expect(result[1]).toMatchObject({
      productName: '手动名称',
      sourceStyle: '旧写法',
      styleChoice: 'NEW',
      values: { style: '新名称', nickname: '另一商品', price: '500' },
    });
    expect(result[2]).toBe(committed);
    expect(result[3]).toBe(other);
    expect(sourceStyle(result[1])).toBe('旧写法');
    expect(applyStyleReview(rows, edited, false)[1]).toBe(second);
    const blankRows = [row(), { ...row(), rowNumber: 3 }];
    expect(applyStyleReview(blankRows, { ...blankRows[0], styleChoice: 'NONE' }, true)[1]).toBe(
      blankRows[1],
    );
  });
  it.each(['cabochons/images', 'cabochon-imports/images'])(
    'accepts current and legacy cabochon images under %s',
    (prefix) => {
      const imageKeys = [`${prefix}/123e4567-e89b-42d3-a456-426614174000.png`];
      expect(excelRowInputSchema.parse({ ...row(), imageKeys }).imageKeys).toEqual(imageKeys);
    },
  );
  it('maps requested headings while leaving spreadsheet codes unused', () => {
    expect(
      detectColumns({
        A: '编号',
        B: '蛋面艺名',
        C: ' 蛋面类型 ',
        D: '修正后/修正',
        E: '尺寸（裸蛋带镶嵌）',
      }),
    ).toEqual({ nickname: 'B', type: 'C', correctedPrice: 'D', measurement: 'E' });
    expect(detectColumns({ A: '售价', B: '售价' }).price).toBeUndefined();
  });
  it('allows blank fields with unknown type, zero price and one unit in stock', () => {
    expect(normalizeExcelRow(row(), [], [])).toMatchObject({
      errors: [],
      warnings: [],
      name: '未知',
      price: '0.00',
      stock: 1,
      measurement: null,
      cost: null,
      settingStyleId: null,
      tagIds: [],
      marketing: { videoShot: false, xiaohongshuVideoPublished: false, xiaohongshuListed: false },
    });
  });
  it('uses nickname and type, exact trimmed tags, setting style, costs and last-line dimensions', () => {
    const result = normalizeExcelRow(
      row({
        nickname: ' 雪隐 ',
        type: ' 白幽灵 ',
        style: ' 银素边 ',
        roughStoneCost: '120',
        settingCost: '30.50',
        price: '400',
        correctedPrice: '350',
        measurement: '12x23x23\r\n13*24*23\n',
        notes: '完好',
        videoShot: '是',
        published: '√',
        sold: '已卖出',
      }),
      [tag],
      [style],
    );
    expect(result).toMatchObject({
      errors: [],
      name: '雪隐-白幽灵',
      price: '350.00',
      cost: { roughStoneCost: '120.00', settingCost: '30.50', totalCost: '150.50' },
      measurement: { lengthMm: 13, widthMm: 24, heightMm: 23 },
      stock: 0,
      tagIds: [tag.id],
      magicBoxStyle: '银素边',
      settingStyleId: style.id,
      marketing: {
        videoShot: true,
        xiaohongshuVideoPublished: true,
        xiaohongshuListed: true,
        douyinVideoPublished: false,
        douyinListed: false,
      },
    });
  });
  it('keeps a corrected price of zero, falls back only when blank, and rejects malformed corrections', () => {
    expect(normalizeExcelRow(row({ price: '80', correctedPrice: '0' }), [], []).price).toBe('0.00');
    expect(normalizeExcelRow(row({ price: '80', correctedPrice: ' ' }), [], []).price).toBe(
      '80.00',
    );
    expect(
      normalizeExcelRow(row({ price: '80', correctedPrice: '待定' }), [], []).errors,
    ).toContain('PRICE_INVALID');
    expect(normalizeExcelRow(row({ price: '21474836.48' }), [], []).errors).toContain(
      'PRICE_INVALID',
    );
  });
  it('leaves unrecognized dimensions blank and prepares unmatched styles for creation', () => {
    const result = normalizeExcelRow(row({ style: ' 不存在 ', measurement: '较大' }), [], []);
    expect(result).toMatchObject({
      errors: [],
      warnings: ['MEASUREMENT_UNRECOGNIZED', 'STYLE_UNMATCHED'],
      measurement: null,
      magicBoxStyle: '不存在',
      settingStyleId: null,
    });
  });
  it('keeps blank styles empty and validates new names against the setting style limit', () => {
    expect(normalizeExcelRow(row({ style: '  ' }), [], [])).toMatchObject({
      errors: [],
      warnings: [],
      magicBoxStyle: '',
      settingStyleId: null,
    });
    expect(normalizeExcelRow(row({ style: '长'.repeat(60) }), [], []).errors).toEqual([]);
    expect(normalizeExcelRow(row({ style: '长'.repeat(61) }), [], []).errors).toContain(
      'STYLE_INVALID',
    );
  });
  it('requires explicit resolution for unmatched tags and never guesses a partial tag', () => {
    const draft = row({ type: '白幽灵精品' });
    expect(normalizeExcelRow(draft, [tag], []).errors).toContain('TAG_UNMATCHED');
    expect(
      normalizeExcelRow({ ...draft, tagChoice: 'SELECT', tagId: tag.id }, [tag], []).tagIds,
    ).toEqual([tag.id]);
    expect(normalizeExcelRow({ ...draft, tagChoice: 'NONE' }, [tag], []).errors).toEqual([]);
  });
  it('keeps full type wording in the name and persists reviewed multiple tags with base-type expansion', () => {
    const base = { id: 'clx32345678901234567890123', name: '云母' };
    const pink = { id: 'clx42345678901234567890123', name: '粉云母' };
    const coexisting = { id: 'clx52345678901234567890123', name: '共生水晶' };
    const green = { id: 'clx62345678901234567890123', name: '绿幽灵' };
    const catalog = [base, pink, coexisting, green];
    const draft = {
      ...row({ nickname: '浮光', type: '粉云母共生绿幽灵' }),
      tagMatch: {
        source: '粉云母共生绿幽灵',
        tagIds: [pink.id, coexisting.id, green.id],
        missingTags: [],
      },
    };
    const restored = excelRowInputSchema.parse(JSON.parse(JSON.stringify(draft)));
    const result = normalizeExcelRow(restored, catalog, []);
    expect(result).toMatchObject({
      name: '浮光-粉云母共生绿幽灵',
      errors: [],
      missingTags: ['幽灵'],
    });
    expect(result.tagIds).toEqual([pink.id, coexisting.id, green.id, base.id]);
    expect(
      normalizeExcelRow(
        { ...restored, tagChoice: 'SELECT', tagIds: [base.id, pink.id] },
        catalog,
        [],
      ).tagIds,
    ).toEqual([base.id, pink.id]);
    expect(normalizeExcelRow({ ...restored, tagChoice: 'NONE' }, catalog, []).tagIds).toEqual([]);
  });
  it('rejects stale recognition and removed tag IDs and permits explicit manual recovery', () => {
    const draft = {
      ...row({ type: '绿幽灵' }),
      tagMatch: { source: '白幽灵', tagIds: [tag.id], missingTags: [] },
    };
    expect(normalizeExcelRow(draft, [tag], []).errors).toContain('TAG_UNMATCHED');
    expect(
      normalizeExcelRow({ ...draft, tagMatch: { ...draft.tagMatch, source: '绿幽灵' } }, [], [])
        .errors,
    ).toContain('TAG_UNMATCHED');
    expect(
      normalizeExcelRow({ ...draft, tagChoice: 'SELECT', tagIds: [tag.id] }, [tag], []).errors,
    ).toEqual([]);
  });
  it('blocks image failures and uncertain boolean values until explicitly reviewed', () => {
    const draft = { ...row({ published: '也许', sold: '售出待确认' }), imageErrors: ['missing'] };
    expect(normalizeExcelRow(draft, [], []).errors).toEqual([
      'PUBLISHED_INVALID',
      'SOLD_INVALID',
      'IMAGE_FAILED',
    ]);
    expect(
      normalizeExcelRow({ ...row(), imageErrors: ['missing'], ignoreImageErrors: true }, [], [])
        .errors,
    ).toEqual([]);
  });
  it.each([
    ['是', true],
    ['否', false],
    ['√', true],
    ['×', false],
    ['1', true],
    ['0', false],
    ['', false],
    ['TRUE', true],
    ['maybe', null],
  ])('reads boolean %s', (input, expected) => {
    expect(parseExcelBoolean(String(input))).toBe(expected);
  });
  it.each([
    ['￥1,250.50元', '1250.50'],
    ['0', '0.00'],
    ['1,2', null],
    ['-10', null],
    ['1.234', null],
  ])('parses currency %s', (input, expected) => {
    expect(parseExcelAmount(input!)).toBe(expected);
  });
});
