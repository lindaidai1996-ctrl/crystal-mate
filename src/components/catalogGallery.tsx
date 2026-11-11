'use client';

import { Empty, Pagination, Spin } from 'antd';
import type { PaginationProps } from 'antd';
import { useTranslations } from 'next-intl';
import { Children, type ReactNode } from 'react';
import { ImageHoverPreview } from './materialManagement/imageHoverPreview';
import catalogStyles from './productCatalog.module.css';

export function CatalogGallery({
  loading,
  pagination,
  emptyDescription,
  children,
}: {
  loading: boolean;
  pagination: PaginationProps;
  emptyDescription: string;
  children: ReactNode;
}) {
  return (
    <Spin spinning={loading}>
      {Children.count(children) > 0 ? (
        <div className={catalogStyles.gallery}>{children}</div>
      ) : (
        <div className={catalogStyles.empty}>
          <Empty description={emptyDescription} />
        </div>
      )}
      <div className={catalogStyles.pagination}>
        {pagination.total === 0 ? (
          <span>
            {typeof pagination.showTotal === 'function' ? pagination.showTotal(0, [0, 0]) : null}
          </span>
        ) : (
          <Pagination {...pagination} />
        )}
      </div>
    </Spin>
  );
}

export function CatalogGalleryImage({
  images,
  name,
  soldOut = false,
}: {
  images: { objectKey: string; url: string; fileName?: string }[];
  name: string;
  soldOut?: boolean;
}) {
  const t = useTranslations('products');
  return (
    <div className={catalogStyles.cardImage}>
      <ImageHoverPreview
        images={images}
        name={name}
        coverObjectKey={images[0]?.objectKey ?? null}
        hoverPreview={false}
        thumbnailSize={640}
      />
      {soldOut && <span className={catalogStyles.soldOut}>{t('soldOut')}</span>}
      {images.length === 0 && <span className={catalogStyles.noImage}>{t('noImage')}</span>}
      {images.length > 1 && (
        <span className={catalogStyles.imageCount}>
          {t('imageCount', { count: images.length })}
        </span>
      )}
    </div>
  );
}
