'use client';

import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, InputNumber, Select, Skeleton, Switch } from 'antd';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { Category, Product, ProductImage } from '@/lib/client-types';
import { ImagePicker } from './image-picker';

type Values = {
  code: string;
  name: string;
  description: string;
  categoryId: string;
  priceYuan: number;
  stock: 0 | 1;
  published: boolean;
};

export function ProductEditor({ id }: { id: string }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const router = useRouter();
  const { message } = App.useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [initialValues, setInitialValues] = useState<Partial<Values>>({});
  const [loading, setLoading] = useState(id !== 'new');
  const [saving, setSaving] = useState(false);
  const isNew = id === 'new';

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [list, product] = await Promise.all([
          apiFetch<Category[]>('/api/categories'),
          isNew ? Promise.resolve(null) : apiFetch<Product>(`/api/products/${id}`),
        ]);
        if (!active) return;
        setCategories(list);
        if (product) {
          setInitialValues({
            code: product.code,
            name: product.name,
            description: product.description,
            categoryId: product.categoryId,
            priceYuan: product.priceCents / 100,
            stock: product.stock,
            published: product.published,
          });
          setImages(product.images);
        }
      } catch (error) {
        if (active)
          message.error(
            common(
              `errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never,
            ),
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id, isNew, message, common]);

  async function save(values: Values) {
    setSaving(true);
    try {
      await apiFetch(isNew ? '/api/products' : `/api/products/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify({
          code: values.code.trim(),
          name: values.name.trim(),
          description: (values.description ?? '').trim(),
          categoryId: values.categoryId,
          priceCents: Math.round(values.priceYuan * 100),
          currency: 'CNY',
          stock: values.stock,
          published: values.published,
          imageKeys: images.map((image) => image.objectKey),
        }),
      });
      message.success(common('saved'));
      router.push('/admin/products');
      router.refresh();
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link href="/admin/products" className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>{isNew ? t('newTitle') : t('editTitle')}</h1>
        </div>
      </div>
      <Form
        layout="vertical"
        initialValues={{
          description: '',
          priceYuan: 0,
          stock: 1,
          published: false,
          ...initialValues,
        }}
        requiredMark={false}
        onFinish={save}
      >
        <div className="editor-grid">
          <div>
            <section className="editor-section">
              <h2>{t('details')}</h2>
              <Form.Item
                name="name"
                label={t('name')}
                rules={[{ required: true, whitespace: true, message: t('required') }, { max: 120 }]}
              >
                <Input maxLength={120} />
              </Form.Item>
              <div className="editor-row">
                <Form.Item
                  name="code"
                  label={t('code')}
                  extra={t('codeHelp')}
                  rules={[
                    { required: true, message: t('required') },
                    { pattern: /^[A-Za-z0-9_-]+$/ },
                    { max: 64 },
                  ]}
                >
                  <Input maxLength={64} />
                </Form.Item>
                <Form.Item
                  name="categoryId"
                  label={t('category')}
                  rules={[{ required: true, message: t('required') }]}
                >
                  <Select
                    placeholder={t('selectCategory')}
                    options={categories.map((item) => ({ value: item.id, label: item.name }))}
                  />
                </Form.Item>
              </div>
              {!categories.length && <Link href="/admin/categories">{t('noCategories')}</Link>}
              <Form.Item name="description" label={t('description')} rules={[{ max: 10000 }]}>
                <Input.TextArea rows={6} maxLength={10000} showCount />
              </Form.Item>
            </section>
            <section className="editor-section">
              <h2>{t('images')}</h2>
              <ImagePicker images={images} onChange={setImages} />
            </section>
          </div>
          <div>
            <section className="editor-section">
              <h2>{t('price')}</h2>
              <Form.Item
                name="priceYuan"
                label={t('price')}
                rules={[{ required: true, message: t('required') }]}
              >
                <InputNumber min={0} max={21474836.47} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="stock" label={t('stock')} extra={t('stockHelp')}>
                <Select
                  options={[
                    { value: 1, label: '1' },
                    { value: 0, label: '0' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="published" label={t('publication')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </section>
            <div className="editor-actions">
              <Link href="/admin/products">
                <Button>{common('cancel')}</Button>
              </Link>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={saving}
                disabled={!categories.length}
              >
                {common('save')}
              </Button>
            </div>
          </div>
        </div>
      </Form>
    </>
  );
}
