const timeZone = 'Asia/Shanghai';

export function formatAssistantTime(value: string, locale: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'long',
    ...(dateOnly ? {} : { timeStyle: 'medium', hourCycle: 'h23' }),
  }).format(date);
  return dateOnly
    ? formatted
    : `${formatted}${locale.startsWith('zh') ? '（北京时间）' : ' (UTC+8)'}`;
}

// Format dates embedded in generated prose as well as structured date cells.
export function formatAssistantTimeText(text: string, locale: string): string {
  return text.replace(
    /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?\b/g,
    (value) => formatAssistantTime(value, locale),
  );
}

export function formatAssistantDuration(milliseconds: number, locale: string): string {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round((seconds % 60) * 10) / 10;
  const unit = (value: number, name: 'minute' | 'second') =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'long',
      maximumFractionDigits: 1,
    }).format(value);
  if (!minutes) return unit(remaining || (milliseconds > 0 ? 0.1 : 0), 'second');
  return [unit(minutes, 'minute'), ...(remaining ? [unit(remaining, 'second')] : [])].join(' ');
}
