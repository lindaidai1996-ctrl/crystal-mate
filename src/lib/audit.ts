import { z } from 'zod';
import { createdTimeFilterFields, validCreatedTimeRange } from './date-range';

export const auditEntityTypes = [
  'Admin',
  'Category',
  'Tag',
  'DistributorArea',
  'Distributor',
  'MaterialCategory',
  'Material',
  'MaterialBatch',
  'Product',
  'SettingStyle',
  'SilverPricing',
  'MaterialPricingGroup',
  'MaterialPricingImport',
  'MaterialPricingPublication',
  'ProductDiyPricingLine',
  'DiyCommonFeeSettings',
  'ProductCard',
  'ProductCardAsset',
  'ProductCardBrandSettings',
  'EditorDraft',
  'ProductCode',
  'CabochonExcelImport',
  'MaterialImageImport',
  'DiyImageImport',
  'DistributorAttachment',
  'ProductPurchaseEntry',
  'ProductDiyRun',
  'ProductDiyMaterial',
  'ProductDiyCabochon',
  'ProductStockAdjustment',
  'ProductMarketing',
  'CabochonMeasurement',
  'CabochonCost',
  'CabochonExtraInfo',
  'ProductTag',
  'ProductImage',
  'MaterialBatchEntry',
  'MaterialStockAdjustment',
  'MaterialBatchAttachment',
  'MaterialBatchImage',
  'MaterialImage',
  'MaterialTag',
  'MaterialImageImportItem',
] as const;
export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    actorId: z.string().min(1).max(100).optional(),
    entityType: z.enum(auditEntityTypes).optional(),
    entityId: z.string().min(1).max(200).optional(),
    operationId: z.string().min(1).max(100).optional(),
    action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
    ...createdTimeFilterFields,
  })
  .refine(validCreatedTimeRange);

export type ActorSnapshot = { id: string; username: string; nickname: string };
export type RecordProvenance = {
  entityType: string;
  entityId: string;
  entityLabel: string;
  createdBy: ActorSnapshot | null;
  updatedBy: ActorSnapshot | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type AuditEntry = {
  id: string;
  operationId: string;
  source: string;
  actorId: string | null;
  actorUsername: string | null;
  actorNickname: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  entityType: string;
  entityId: string;
  entityLabel: string;
  rootType: string;
  rootId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  createdAt: string;
};
export type AuditPage = {
  items: AuditEntry[];
  total: number;
  actors: ActorSnapshot[];
  references: Record<string, string>;
};
