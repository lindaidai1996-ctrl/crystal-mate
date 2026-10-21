import type { MaterialPurchase } from './material-purchase';
import type { ProductSaleRule } from './product-pricing';
import type { CraftDesignFee } from './product-diy-cost';
import type { SilverCost } from './silver-cost';

export type Category = {
  id: string;
  name: string;
  prefix: string | null;
  _count?: { products: number };
};
export type Tag = { id: string; name: string; _count?: { products: number; materials: number } };
export type Distributor = {
  id: string;
  name: string;
  area: string;
  address: string;
  wechat: string;
  phone: string;
  notes: string;
  attachments: DistributorAttachment[];
  _count?: { attachments: number };
  createdAt: string;
  updatedAt: string;
};
export type DistributorAttachment = MaterialBatchAttachment;
export type DistributorValues = Pick<
  Distributor,
  'name' | 'area' | 'address' | 'wechat' | 'phone' | 'notes'
>;
export type DistributorArea = { id: string; name: string; distributorCount: number };
export type DistributorItemCounts = { total: number; products: number; materials: number };
export type DistributorListItem = Distributor & { itemCounts: DistributorItemCounts };
export type DistributorPage = {
  items: DistributorListItem[];
  areas: string[];
  areaItems: DistributorArea[];
};
export type DistributorDetailResponse = { item: Distributor; areas: string[] };
export type DistributorPurchaseSummary = {
  type: 'PRODUCT' | 'MATERIAL';
  itemId: string;
  name: string;
  code: string | null;
  unit: string | null;
  batchCount: number;
  latestReceivedAt: string;
  knownQuantity: number | null;
  hasUnknownQuantity: boolean;
  totalAmount: string | null;
  hasUnknownAmount: boolean;
  totalWeightGrams: string | null;
  hasUnknownWeight: boolean;
};
export type DistributorPurchaseEntry = {
  id: string;
  type: 'PRODUCT' | 'MATERIAL';
  batchId: string;
  batchName: string;
  receivedAt: string;
  quantity: number | null;
  unit: string;
  unitPrice: string | null;
  amount: string | null;
  weightGrams: string | null;
  gramPrice: string | null;
  priceSource: string | null;
};
export type DistributorPurchasePage = {
  items: DistributorPurchaseSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type DistributorPurchaseEntriesPage = {
  items: DistributorPurchaseEntry[];
  total: number;
  page: number;
  pageSize: number;
};
export type ProductImage = { id?: string; objectKey: string; url: string; position: number };
export type ProductMarketing = {
  videoShot: boolean;
  xiaohongshuVideoPublished: boolean;
  xiaohongshuListed: boolean;
  douyinVideoPublished: boolean;
  douyinListed: boolean;
};
export type CabochonMeasurement = {
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};
export type CabochonCost = {
  roughStoneCost: string | null;
  settingCost: string | null;
  otherCosts: { name: string; amount: string }[];
  totalCost: string;
  totalManual: boolean;
};
export type Product = {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  category: Category;
  tags: Tag[];
  priceCents: number;
  saleRule: ProductSaleRule;
  saleRuleValue: string | null;
  saleManual: boolean;
  currency: 'CNY';
  stock: number;
  origin: 'PURCHASED' | 'DIY' | null;
  published: boolean;
  marketing: ProductMarketing;
  measurement: CabochonMeasurement | null;
  cost: CabochonCost | null;
  purchaseEntries: ProductPurchaseEntry[];
  diyRuns: ProductDiyRun[];
  stockAdjustments: ProductStockAdjustment[];
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
};
export type ProductPurchaseEntry = {
  id: string;
  productId: string;
  batchId: string;
  batch: MaterialBatch;
  distributorId: string;
  distributor: Distributor;
  quantity: number;
  unitCost: string;
  notes: string;
  createdAt: string;
};
export type ProductDiyMaterial = {
  id: string;
  materialBatchEntryId: string;
  materialBatchEntry: MaterialBatchEntry & {
    material: { id: string; name: string; unit: MaterialUnit };
  };
  usageUnit: 'STRAND' | 'BEAD' | 'GRAM';
  quantity: string;
  unitCost: string;
  lineCost: string;
  quoteUnitPrice: string | null;
  quoteLineTotal: string | null;
  quoteSnapshot: DiyQuoteSnapshot | null;
};
export type ProductDiyCabochon = {
  id: string;
  productId: string;
  product: { id: string; code: string; name: string };
  quantity: number;
  unitCost: string;
  lineCost: string;
  quoteUnitPrice: string | null;
  quoteLineTotal: string | null;
  quoteSnapshot: DiyQuoteSnapshot | null;
};
export type DiyQuoteSnapshot = {
  name: string;
  code?: string;
  lengthMm: string | null;
  widthMm: string | null;
  heightMm: string | null;
};
export type ProductDiyRun = {
  id: string;
  quantity: number;
  perUnitCost: string;
  totalCost: string | null;
  perUnitQuote: string | null;
  totalQuote: string | null;
  craftDesignFee: CraftDesignFee;
  silverCost: SilverCost;
  extraCosts: { name: string; amount: string; quoteAmount?: string | null }[];
  notes: string;
  materialLines: ProductDiyMaterial[];
  cabochonLines: ProductDiyCabochon[];
  createdAt: string;
};
export type StockAdjustment = {
  id: string;
  beforeQty: number | null;
  afterQty: number;
  delta: number | null;
  reason: string;
  createdAt: string;
};
export type ProductStockAdjustment = {
  id: string;
  beforeQty: number | null;
  afterQty: number | null;
  delta: number;
  reason: string;
  createdAt: string;
};
export type ProductSourceInput =
  | {
      origin: 'PURCHASED';
      selection: MaterialBatchSelection;
      distributorId: string;
      quantity: number;
      unitCost: string;
      notes: string;
    }
  | {
      origin: 'DIY';
      // null marks a new form waiting for its database defaults; it cannot be saved.
      silverCost?: SilverCost | null;
      quantity: number;
      notes: string;
      materials: {
        materialBatchEntryId: string;
        usageUnit: 'STRAND' | 'BEAD' | 'GRAM';
        quantity: string;
        unitCost: string;
        quoteUnitPrice?: string | null;
      }[];
      cabochons: {
        productId: string;
        quantity: number;
        unitCost: string;
        quoteUnitPrice?: string | null;
      }[];
      extraCosts: { name: string; amount: string; quoteAmount?: string | null }[];
      craftDesignFee?: CraftDesignFee;
    };
export type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };

export type MaterialCategory = {
  id: string;
  name: string;
  aliases: string[];
  parentId: string | null;
  _count?: { children: number; materials: number };
};
export type MaterialUnit = 'STRAND' | 'BEAD' | 'GRAM';
export type MaterialPriceSource = 'COUNT' | 'WEIGHT' | 'CUSTOM' | null;
export type MaterialSaleRule =
  | 'COST'
  | 'PERCENT_10'
  | 'PERCENT_20'
  | 'PERCENT_30'
  | 'PERCENT_50'
  | 'FIXED_AMOUNT'
  | 'CUSTOM_PERCENT'
  | 'CUSTOM_AMOUNT';
export type MaterialAmount = string | null;
export type MaterialValues = {
  name: string;
  categoryId: string;
  unit: MaterialUnit;
  purchaseUnitPrice: MaterialAmount;
  weightGrams: MaterialAmount;
  purchaseGramPrice: MaterialAmount;
  purchaseGramManual: boolean;
  lengthMm: MaterialAmount;
  widthMm: MaterialAmount;
  heightMm: MaterialAmount;
  childCount: number | null;
  childWeightGrams: MaterialAmount;
  childUnitPrice: MaterialAmount;
  childPriceSource: MaterialPriceSource;
  saleRule: MaterialSaleRule;
  saleRuleValue: MaterialAmount;
  saleUnitPrice: MaterialAmount;
  saleGramPrice: MaterialAmount;
  saleChildUnitPrice: MaterialAmount;
  saleUnitManual: boolean;
  saleGramManual: boolean;
  saleChildManual: boolean;
  notes: string;
};
export type Material = MaterialValues & {
  knownStock: number;
  unknownStockBatchCount: number;
  id: string;
  category: MaterialCategory;
  tags: Tag[];
  images: ProductImage[];
  batchEntries: MaterialBatchEntry[];
  createdAt: string;
  updatedAt: string;
};
export type MaterialPage = { items: Material[]; total: number; page: number; pageSize: number };

export type MaterialBatch = {
  id: string;
  name: string;
  receivedAt: string;
  notes: string;
  attachments?: MaterialBatchAttachment[];
  createdAt: string;
  _count?: { entries: number; productEntries: number; attachments: number };
};
export type MaterialBatchAttachment = {
  id?: string;
  objectKey: string;
  url: string;
  fileName: string;
  notes: string;
  position: number;
};
export type MaterialBatchSelection =
  | { batchId: string; newBatch?: never }
  | {
      batchId?: never;
      newBatch: { name: string; receivedAt: string; notes: string };
    };
export type MaterialBatchEntry = Omit<MaterialValues, 'name' | 'categoryId' | 'unit' | 'notes'> & {
  id: string;
  materialId: string;
  batchId: string;
  batch: MaterialBatch;
  distributorId: string;
  distributor: Distributor;
  receivedQty: number | null;
  remainingQty: number | null;
  stockAdjustments: StockAdjustment[];
  purchase: MaterialPurchase;
  unitPriceSource: 'UNIT' | 'AVERAGE' | 'ESTIMATED' | 'MANUAL' | 'UNKNOWN';
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
};
export type MaterialBatchDetail = MaterialBatch & {
  entries: (MaterialBatchEntry & { material: { id: string; name: string; unit: MaterialUnit } })[];
  productEntries: (ProductPurchaseEntry & {
    product: Pick<Product, 'id' | 'code' | 'name' | 'priceCents' | 'images'>;
  })[];
};
