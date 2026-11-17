// These are deliberate minimization patterns, not a general-purpose DLP claim.
export function minimizeAssistantText(text: string) {
  return text
    .replace(/\b(?:sk-[\w-]{8,}|Bearer\s+\S+)\b/gi, '[credential]')
    .replace(/https?:\/\/[^\s"<>]+/gi, '[url]')
    .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]');
}

export function minimizeAssistantValue<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, field) =>
      typeof field === 'string' ? minimizeAssistantText(field) : field,
    ),
  ) as T;
}
