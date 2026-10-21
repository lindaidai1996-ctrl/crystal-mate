import type { CSSProperties } from 'react';

type TagAppearance = { color: string; style?: CSSProperties };

const fallbackColors = [
  'magenta',
  'red',
  'volcano',
  'orange',
  'gold',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
] as const;

const colorRules = [
  {
    keywords: ['玫红', '桃红', '洋红', '品红', '粉色', '粉', 'magenta', 'fuchsia', 'pink'],
    color: 'magenta',
  },
  { keywords: ['火山', '朱红', '橘红', '珊瑚', 'coral', 'vermilion', 'volcano'], color: 'volcano' },
  { keywords: ['红色', '红', 'red', 'scarlet', 'crimson'], color: 'red' },
  { keywords: ['橙色', '橙', '橘', '桔', 'orange', 'tangerine'], color: 'orange' },
  { keywords: ['金色', '金', '黄色', '黄', 'gold', 'golden', 'amber', 'yellow'], color: 'gold' },
  { keywords: ['青柠', '酸橙', 'lime', 'chartreuse'], color: 'lime' },
  { keywords: ['绿色', '绿', 'green', 'emerald', 'jade', 'olive'], color: 'green' },
  { keywords: ['青色', '青', 'cyan', 'turquoise', 'teal', 'aqua'], color: 'cyan' },
  { keywords: ['靛蓝', '靛', 'indigo', 'geekblue'], color: 'geekblue' },
  { keywords: ['蓝色', '蓝', 'blue', 'azure', 'navy', 'sapphire'], color: 'blue' },
  { keywords: ['紫色', '紫', 'purple', 'violet', 'lavender'], color: 'purple' },
  { keywords: ['棕色', '棕', '褐', '咖啡', 'brown', 'beige'], color: '#8b5e3c' },
  { keywords: ['黑色', '黑', 'black'], color: '#262626' },
  { keywords: ['白色', '白', 'white'], color: '#f5f5f5' },
  { keywords: ['银色', '银', 'silver'], color: '#d9d9d9' },
  { keywords: ['灰色', '灰', 'gray', 'grey'], color: '#595959' },
] as const;

// Representative UI colors for jade varieties and common trade names, not gem grading.
// Base color families: https://baike.baidu.com/item/昆仑玉/373627
const jadeRules = [
  { keywords: ['墨碧', '黑碧玉'], background: '#354b41', foreground: '#ffffff' },
  { keywords: ['菠菜绿', '菠菜碧玉'], background: '#37664b', foreground: '#ffffff' },
  { keywords: ['苹果绿', '苹果碧玉'], background: '#b7d692', foreground: '#344b25' },
  { keywords: ['碧玉'], background: '#367454', foreground: '#ffffff' },
  { keywords: ['粉青'], background: '#d0e3da', foreground: '#36584c' },
  { keywords: ['粉绿'], background: '#c4dcbc', foreground: '#3c5835' },
  { keywords: ['鸭蛋青'], background: '#dce7d3', foreground: '#475b3d' },
  { keywords: ['沙枣青'], background: '#819285', foreground: '#14281c' },
  { keywords: ['青玉'], background: '#607d70', foreground: '#ffffff' },
  { keywords: ['青白玉', '青白'], background: '#e7ede0', foreground: '#4a5c40' },
  { keywords: ['翠青', '白玉带翠', '白玉挂翠'], background: '#b9dec0', foreground: '#315e3c' },
  { keywords: ['晴水'], background: '#d8e9df', foreground: '#3d6052' },
  { keywords: ['且末蓝'], background: '#9ab9b8', foreground: '#244647' },
  { keywords: ['藕粉'], background: '#ead4d5', foreground: '#794d56' },
  { keywords: ['烟紫', '紫青玉'], background: '#b7a7c1', foreground: '#493455' },
  { keywords: ['烟青'], background: '#9da7b2', foreground: '#293747' },
  { keywords: ['羊脂玉', '羊脂白', '羊脂'], background: '#f5f0df', foreground: '#685d3e' },
  { keywords: ['青海白', '冰白'], background: '#f0f3ef', foreground: '#506152' },
  { keywords: ['白玉'], background: '#f5f5ed', foreground: '#5e604b' },
  { keywords: ['黄玉', '黄口料', '黄口'], background: '#ebd493', foreground: '#6b5220' },
  { keywords: ['糖白玉', '糖白', '糖包白'], background: '#ead5bd', foreground: '#765132' },
  { keywords: ['糖玉', '糖料', '且末糖'], background: '#bd8659', foreground: '#332013' },
  { keywords: ['墨玉'], background: '#343b3a', foreground: '#ffffff' },
  { keywords: ['青花玉', '青花'], background: '#d9dddf', foreground: '#444d52' },
] as const;

const jadeDefault = { background: '#dcead7', foreground: '#45613d' };

type KeywordRule = { readonly keywords: readonly string[] };

function matchRule<Rule extends KeywordRule>(name: string, rules: readonly Rule[]) {
  // Keep the original precedence: longest phrase, then its first occurrence in the text.
  const matches = rules.flatMap((rule) =>
    rule.keywords.flatMap((keyword) => {
      const index = /^[a-z]+$/.test(keyword)
        ? name.search(new RegExp(`\\b${keyword}\\b`, 'u'))
        : name.indexOf(keyword);
      return index < 0 ? [] : [{ rule, index, length: keyword.length }];
    }),
  );
  matches.sort((a, b) => b.length - a.length || a.index - b.index);
  return matches[0]?.rule;
}

function jadeAppearance({ background, foreground }: typeof jadeDefault): TagAppearance {
  return { color: background, style: { color: foreground, borderColor: background } };
}

export function getTagAppearance(text: string): TagAppearance {
  const name = text.trim().toLowerCase();
  // Specific jade names must win over generic characters such as 青, 白 and 粉.
  const jade = matchRule(name, jadeRules);
  if (jade) return jadeAppearance(jade);

  const matchedColor = matchRule(name, colorRules)?.color;
  if (!matchedColor && (name.includes('和田玉') || name.includes('和阗玉'))) {
    return jadeAppearance(jadeDefault);
  }
  const color = matchedColor ?? getFallbackColor(name);
  if (color === '#f5f5f5' || color === '#d9d9d9') {
    return { color, style: { color: '#595959', borderColor: '#d9d9d9' } };
  }
  return { color: color.startsWith('#') ? color : `${color}-inverse` };
}

function getFallbackColor(name: string) {
  const hash = [...name].reduce(
    (total, character) => (Math.imul(total, 31) + character.charCodeAt(0)) >>> 0,
    0,
  );
  return fallbackColors[hash % fallbackColors.length];
}
