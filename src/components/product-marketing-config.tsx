'use client';

import { ArrowLeftOutlined, CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { App, Button, Input, Result, Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/client-api';
import type { CabochonMeasurement, Product } from '@/lib/client-types';
import { generateProductDetails } from '@/lib/generate-product-details';

const dimensionFields = ['lengthMm', 'widthMm', 'heightMm'] as const;

export function ProductMarketingConfig({ id }: { id: string }) {
  const t = useTranslations('marketingConfig');
  const catalog = useTranslations('catalog');
  const { message } = App.useApp();
  const [product, setProduct] = useState<Product | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const listPath = '/admin/catalog/cabochons';

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Product>(`/api/products/${id}`, { signal: controller.signal })
      .then((item) => {
        if (!controller.signal.aborted) {
          setProduct(item);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      message.success(t('copied'));
    } catch {
      message.error(t('copyFailed'));
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (loadError)
    return (
      <Result
        status="error"
        title={catalog('loadFailed')}
        extra={
          <Button
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            {t('retry')}
          </Button>
        }
      />
    );
  if (!product) return null;
  if (product.category.name !== '蛋面')
    return (
      <Result
        status="warning"
        title={catalog('categoryMismatch', { category: '蛋面' })}
        extra={
          <Link href={listPath}>
            <Button>{catalog('backToList')}</Button>
          </Link>
        }
      />
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <Link href={listPath} className="back-link">
            <ArrowLeftOutlined /> {catalog('backToList')}
          </Link>
          <h1>{t('title')}</h1>
        </div>
      </div>
      <section className="editor-section marketing-config-section">
        <div className="marketing-config-details">
          <div>
            <span className="marketing-config-label">{t('productName')}</span>
            <strong className="marketing-config-name">{product.name}</strong>
          </div>
          {dimensionFields.map((field) => (
            <div key={field}>
              <span className="marketing-config-label">{t(field)}</span>
              <span>{formatDimension(product.measurement, field, t('missingDimension'))}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="editor-section marketing-config-section">
        <h2>{t('details')}</h2>
        <div className="marketing-config-compose">
          <Input.TextArea
            aria-label={t('details')}
            rows={11}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="marketing-config-actions">
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              onClick={() => setContent(generateProductDetails(product.measurement))}
            >
              {t('generate')}
            </Button>
            <Button icon={<CopyOutlined />} disabled={!content} onClick={() => void copyContent()}>
              {t('copy')}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function formatDimension(
  measurement: CabochonMeasurement | null,
  field: keyof CabochonMeasurement,
  missing: string,
) {
  const value = measurement?.[field];
  return value == null ? missing : `${value} mm`;
}
