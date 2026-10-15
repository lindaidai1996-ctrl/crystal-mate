export type ParsedMeasurement = {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
};

export function parseMeasurement(input: string): ParsedMeasurement | null {
  const parts = input.trim().split(/\s*[*xX×]\s*/);
  if (parts.length < 1 || parts.length > 3) return null;

  const numbers = parts.map((part) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(part)) return null;
    const value = Number(part);
    return value > 0 && value <= 99999999.99 ? value : null;
  });
  if (numbers.some((value) => value === null)) return null;

  const [first, second, third] = numbers as number[];
  if (numbers.length === 1) return { lengthMm: first, widthMm: first, heightMm: first };
  if (numbers.length === 2) return { lengthMm: first, widthMm: first, heightMm: second };
  return { lengthMm: first, widthMm: second, heightMm: third };
}
