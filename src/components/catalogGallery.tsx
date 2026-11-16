'use client';

import type { FramedImage } from '@/lib/image-framing';
import { Empty, Pagination, Spin } from 'antd';
import type { PaginationProps } from 'antd';
import { useTranslations } from 'next-intl';
import { Children, type ReactNode } from 'react';
import { ImageSkeleton } from './loadingImage';
import { ListLoadingIndicator } from './listLoadingIndicator';
import { ImageHoverPreview } from './materialManagement/imageHoverPreview';
import catalogStyles from './productCatalog.module.css';
import motionStyles from './listMotion.module.css';
import { useMobile } from './responsive/useMobile';

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
  const common = useTranslations('common');
  const mobile = useMobile();
  const hasItems = Children.toArray(children).length > 0;

  return (
    <div className={motionStyles.surface} data-loading={loading} aria-busy={loading}>
      <Spin spinning={loading && hasItems} delay={150} indicator={<ListLoadingIndicator />}>
        {loading && !hasItems ? (
          <div className={catalogStyles.gallery} role="status" aria-label={common('loading')}>
            {Array.from({ length: Math.min(pagination.pageSize ?? 8, 12) }, (_, index) => (
              <div
                key={index}
                className={`${catalogStyles.card} ${catalogStyles.skeletonCard}`}
                aria-hidden="true"
              >
                <div className={catalogStyles.cardImage}>
                  <ImageSkeleton />
                </div>
                <div className={catalogStyles.skeletonBody}>
                  <div className={catalogStyles.skeletonTitle}>
                    <ImageSkeleton />
                  </div>
                  <div className={catalogStyles.skeletonMeta}>
                    <ImageSkeleton />
                  </div>
                  <div className={catalogStyles.skeletonMeta}>
                    <ImageSkeleton />
                  </div>
                  <div className={catalogStyles.skeletonPrice}>
                    <ImageSkeleton />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : hasItems ? (
          <div
            className={`${catalogStyles.gallery} ${motionStyles.stagger}`}
            data-loading={loading}
          >
            {children}
          </div>
        ) : (
          <div className={catalogStyles.empty}>
            <Empty description={emptyDescription} />
          </div>
        )}
      </Spin>
      <div className={catalogStyles.pagination}>
        {pagination.total === 0 ? (
          <span>
            {typeof pagination.showTotal === 'function' ? pagination.showTotal(0, [0, 0]) : null}
          </span>
        ) : (
          <Pagination
            {...pagination}
            {...(mobile ? { simple: true, showSizeChanger: false, showQuickJumper: false } : {})}
            disabled={loading || pagination.disabled}
          />
        )}
      </div>
    </div>
  );
}

export function CatalogGalleryImage({
  images,
  name,
  soldOut = false,
}: {
  images: ({ objectKey: string; url: string; fileName?: string } & FramedImage)[];
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
