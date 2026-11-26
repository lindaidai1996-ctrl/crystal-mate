import { z } from 'zod';
import {
  parseFormula,
  type FormulaError,
  type Rounding,
  type Variable,
  type Variables,
} from './formula';
export const schemeInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  formula: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((value) => {
      try {
        parseFormula(value);
        return true;
      } catch {
        return false;
      }
    }),
  rounding: z.enum(['CENT', 'YUAN_UP', 'TEN_UP']),
  common: z.boolean(),
  position: z.number().int().min(0).max(9999),
});
export type SchemeInput = z.infer<typeof schemeInputSchema>;
export type PriceScheme = SchemeInput & {
  id: string;
  version: number;
  _count?: { prices: number };
};
export type SchemePrice = {
  schemeId: string;
  scheme: PriceScheme;
  mode: 'AUTO' | 'MANUAL' | 'RETAIN';
  amountCents: number | null;
  previousAmountCents: number | null;
  error: FormulaError | null;
  schemeVersion: number;
  version: number;
};
export const schemePriceInputSchema = z
  .strictObject({
    schemeId: z.string().cuid(),
    schemeVersion: z.number().int().positive(),
    mode: z.enum(['AUTO', 'MANUAL', 'RETAIN']),
    amountCents: z.number().int().min(0).max(2147483647).nullable(),
  })
  .refine((value) => value.mode !== 'MANUAL' || value.amountCents !== null);
export const schemePricesWriteSchema = z.strictObject({
  expectedToken: z.string().optional(),
  items: z
    .array(schemePriceInputSchema)
    .max(200)
    .refine((items) => new Set(items.map((item) => item.schemeId)).size === items.length),
});
export type SchemePricesWrite = z.infer<typeof schemePricesWriteSchema>;
export type PriceContext = { values: Variables; applicable: Variable[] };
export type ImpactRow = {
  id: string;
  name: string;
  code: string;
  oldAmountCents: number | null;
  amountCents: number | null;
  error: FormulaError | null;
  mode: 'AUTO' | 'MANUAL' | 'RETAIN';
  added: boolean;
};
export type SchemeImpact = { token: string; rows: ImpactRow[]; total: number; affected: boolean };
export const schemeChangeSchema = z.strictObject({
  id: z.string().cuid().optional(),
  input: schemeInputSchema,
  expectedVersion: z.number().int().positive().optional(),
});
export const schemeCommitSchema = schemeChangeSchema.extend({
  token: z.string().min(1),
  excludedIds: z.array(z.string().cuid()).max(100000),
});
export type SchemeChange = z.infer<typeof schemeChangeSchema>;
export type SchemeCommit = z.infer<typeof schemeCommitSchema>;
export type SchemeRounding = Rounding;
