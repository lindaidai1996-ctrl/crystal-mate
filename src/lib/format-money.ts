/** Display decimal amounts without changing their precision or converting strings to numbers. */
export function formatAmount(value: string | number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

export function formatCurrency(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
