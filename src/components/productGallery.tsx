'use client';

import { Tag } from 'antd';
import type { PaginationProps } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import type { Product } from '@/lib/client-types';
import { CatalogGallery, CatalogGalleryImage } from './catalogGallery';
import { ProductInlineEdit, type ProductQuickEditChange } from './productInlineEdit';
import { TextTag } from './text-tag';
import catalogStyles from './productCatalog.module.css';

export function ProductGallery({
  items,
  listPath,
  loading,
  pagination,
  renderActions,
  renderDetails,
  onQuickEdit,
}: {
  items: Product[];
  listPath: string;
  loading: boolean;
  pagination: PaginationProps;
  renderActions: (item: Product) => ReactNode;
  renderDetails?: (item: Product) => ReactNode;
  onQuickEdit: (item: Product, change: ProductQuickEditChange) => Promise<void>;
}) {
  const t = useTranslations('products');
  const sources = useTranslations('productSources');
  const locale = useLocale();
  const currency = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
    style: 'currency',
    currency: 'CNY',
  });

  return (
    <CatalogGallery loading={loading} pagination={pagination} emptyDescription={t('empty')}>
      {items.map((item) => (
        <article key={item.id} className={catalogStyles.card}>
          <CatalogGalleryImage images={item.images} name={item.name} soldOut={item.stock === 0} />
          <div className={catalogStyles.cardBody}>
            <div className={catalogStyles.cardHeading}>
              <Link href={`${listPath}/${item.id}`} title={item.name}>
                {item.name}
              </Link>
            </div>
            <div className={catalogStyles.cardSubheading}>
              <span className={catalogStyles.code}>{item.code}</span>
              <Tag bordered={false} className={catalogStyles.publication}>
                {item.published ? t('published') : t('unpublished')}
              </Tag>
            </div>
            <div className={catalogStyles.cardMeta}>
              <span>{item.category.name}</span>
              {item.origin && <span>{sources(item.origin)}</span>}
            </div>
            <div className={`product-tags ${catalogStyles.cardTags}`}>
              {item.tags.map((tag) => (
                <TextTag key={tag.id} text={tag.name} />
              ))}
            </div>
            {renderDetails && (
              <div className={catalogStyles.cardDetails}>{renderDetails(item)}</div>
            )}
            <div className={catalogStyles.cardBottom}>
              <ProductInlineEdit
                product={item}
                field="price"
                onSave={(change) => onQuickEdit(item, change)}
              >
                <span className={catalogStyles.money}>
                  {currency.format(item.priceCents / 100)}
                </span>
              </ProductInlineEdit>
            </div>
            <div className={catalogStyles.cardFooter}>
              <span className={catalogStyles.stock}>
                {t('stockQuantity')}
                <ProductInlineEdit
                  product={item}
                  field="stock"
                  onSave={(change) => onQuickEdit(item, change)}
                >
                  {item.stock}
                </ProductInlineEdit>
              </span>
              <div className={catalogStyles.cardActions}>{renderActions(item)}</div>
            </div>
          </div>
        </article>
      ))}
    </CatalogGallery>
  );
}
