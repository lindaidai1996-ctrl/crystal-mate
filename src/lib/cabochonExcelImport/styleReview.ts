import type { ExcelRowInput } from './contracts';

export type StyleOption = { id: string; magicBoxStyle: string };
export const sourceStyle = (row: ExcelRowInput) => row.sourceStyle ?? row.values.style;

// Only review choices are copied. Names, images, original cells and committed rows stay intact.
export function applyStyleReview<T extends ExcelRowInput & { receipt?: unknown }>(
  rows: T[],
  edited: ExcelRowInput,
  applySame: boolean,
): T[] {
  const original = rows.find((row) => row.rowNumber === edited.rowNumber);
  if (!original || original.receipt) return rows;
  const source = sourceStyle(original);
  return rows.map((row) => {
    if (row.receipt) return row;
    if (row.rowNumber === edited.rowNumber)
      return { ...row, ...edited, original: row.original, sourceStyle: source };
    if (!applySame || !source.trim() || sourceStyle(row).trim() !== source.trim()) return row;
    return {
      ...row,
      sourceStyle: sourceStyle(row),
      styleChoice: edited.styleChoice,
      styleId: edited.styleId,
      values: { ...row.values, style: edited.values.style },
    };
  });
}

const searchText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export function suggestStyles(value: string, options: StyleOption[]): StyleOption[] {
  const query = searchText(value);
  if (!query || query.length > 60) return [];
  return options
    .filter((option) => option.magicBoxStyle.trim() !== value.trim())
    .map((option) => ({ option, score: similarity(query, searchText(option.magicBoxStyle)) }))
    .filter(({ score }) => score >= 0.6)
    .sort(
      (a, b) => b.score - a.score || a.option.magicBoxStyle.localeCompare(b.option.magicBoxStyle),
    )
    .slice(0, 3)
    .map(({ option }) => option);
}
