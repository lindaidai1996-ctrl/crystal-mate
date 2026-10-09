export type Category = { id: string; name: string; _count?: { products: number } };
export type ProductImage = { id?: string; objectKey: string; url: string; position: number };
export type Product = {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  category: Category;
  priceCents: number;
  currency: 'CNY';
  stock: 0 | 1;
  published: boolean;
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
};
export type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };
