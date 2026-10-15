'use client';

import { ArrowLeftOutlined, PlusOutlined, SaveOutlined, ScanOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Select,
  Skeleton,
  Space,
  Spin,
  Switch,
  Tooltip,
} from 'antd';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  CabochonMeasurement,
  Category,
  Product,
  ProductImage,
  ProductMarketing,
  Tag,
} from '@/lib/client-types';
import { catalogPath, type CatalogScope } from '@/lib/catalog-scopes';
import { parseMeasurement } from '@/lib/parse-measurement';
import { cabochonCostSchema } from '@/lib/validation';
import { amountToCents, centsToAmount, type CabochonCostValues } from '@/lib/cabochon-cost';
import {
  calculateProductPrice,
  maximumProductPriceCents,
  productPricingCost,
  productDiyQuote,
  diyQuotePricing,
  type ProductPricingValues,
} from '@/lib/product-pricing';
import { ProductPricingFields } from './product-pricing-fields';
import { CabochonCostFields } from './cabochonCost/cabochonCostFields';
import { ImagePicker } from './image-picker';
import { MissingCategoryState } from './missing-category-state';
import { initialSource, ProductSourceSection } from './product-source-section';
import type { ProductSourceInput } from '@/lib/client-types';
import { productSourceSchema } from '@/lib/validation';

type Values = {
  code: string;
  name: string;
  description: string;
  categoryId: string;
  tagIds: string[];
  pricing: ProductPricingValues;
  stock: number;
  published: boolean;
  marketing: ProductMarketing;
  measurement: CabochonMeasurement;
  cost: CabochonCostValues | null;
};

export function ProductEditor({ id, scope }: { id: string; scope?: CatalogScope }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const catalog = useTranslations('catalog');
  const tagText = useTranslations('tags');
  const sourceText = useTranslations('productSources');
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [tagForm] = Form.useForm<{ name: string }>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [initialValues, setInitialValues] = useState<Partial<Values>>({});
  const [product, setProduct] = useState<Product | null>(null);
  const [sourceDraft, setSourceDraft] = useState<ProductSourceInput>(initialSource);
  const [productCategoryId, setProductCategoryId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [recognitionInput, setRecognitionInput] = useState('');
  const codeRequestId = useRef(0);
  const isNew = id === 'new';
  const scopedCategory =
    scope?.key === 'cabochons'
      ? categories.find((item) => item.name === scope.categoryName)
      : undefined;
  const availableCategories =
    scope?.key === 'finished-strands'
      ? categories.filter((item) => item.name !== '蛋面')
      : categories;
  const selectedCategoryId =
    Form.useWatch('categoryId', form) ?? scopedCategory?.id ?? initialValues.categoryId;
  const isCabochon = categories.some(
    (item) => item.id === selectedCategoryId && item.name === '蛋面',
  );
  const listPath = scope ? catalogPath(scope.key) : '/admin/products';
  const watchedCost = Form.useWatch('cost', { form, preserve: true });
  const pricingCost = productPricingCost(
    isCabochon,
    watchedCost === undefined ? initialValues.cost : watchedCost,
    product ?? sourceDraft,
  );
  const isDiyPricing = !isCabochon && (product?.origin ?? sourceDraft.origin) === 'DIY';
  const watchedPricing: ProductPricingValues | undefined = Form.useWatch('pricing', {
    form,
    preserve: true,
  });
  const salePrice = (watchedPricing ?? initialValues.pricing)?.price;
  const salePriceCents = salePrice == null ? null : amountToCents(salePrice);
  const pricingCostCents = pricingCost.amount === null ? null : amountToCents(pricingCost.amount);
  const profitCents =
    salePriceCents === null ||
    salePriceCents > maximumProductPriceCents ||
    pricingCostCents === null
      ? null
      : salePriceCents - pricingCostCents;
  const isLoss = profitCents !== null && profitCents < BigInt(0);

  const generateCode = useCallback(
    async (categoryId: string | undefined) => {
      const requestId = ++codeRequestId.current;
      if (!categoryId) {
        form.setFieldsValue({ code: '' });
        setGeneratingCode(false);
        return;
      }

      form.setFieldsValue({ code: '' });
      setGeneratingCode(true);
      try {
        const result = await apiFetch<{ code: string }>('/api/products/code', {
          method: 'POST',
          body: JSON.stringify({ categoryId }),
        });
        if (requestId === codeRequestId.current) form.setFieldsValue({ code: result.code });
      } catch (error) {
        if (requestId === codeRequestId.current) {
          message.error(
            error instanceof ClientApiError
              ? common(`errors.${error.code}` as never)
              : t('codeGenerationFailed'),
          );
        }
      } finally {
        if (requestId === codeRequestId.current) setGeneratingCode(false);
      }
    },
    [common, form, message, t],
  );

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const [list, tagList, product] = await Promise.all([
          apiFetch<Category[]>('/api/categories'),
          apiFetch<Tag[]>('/api/tags'),
          isNew ? Promise.resolve(null) : apiFetch<Product>(`/api/products/${id}`),
        ]);
        if (!active) return;
        setCategories(list);
        setTags(tagList);
        if (product) {
          setProduct(product);
          setProductCategoryId(product.categoryId);
          setInitialValues({
            code: product.code,
            name: product.name,
            description: product.description,
            categoryId: product.categoryId,
            tagIds: product.tags.map((tag) => tag.id),
            pricing: {
              saleRule: product.saleRule ?? 'PERCENT_50',
              saleRuleValue: product.saleRuleValue ?? null,
              saleManual: product.saleManual ?? true,
              price: (product.priceCents / 100).toFixed(2),
            },
            stock: product.stock,
            published: product.published,
            marketing: product.marketing ?? {
              videoShot: false,
              xiaohongshuVideoPublished: false,
              xiaohongshuListed: false,
              douyinVideoPublished: false,
              douyinListed: false,
            },
            measurement: product.measurement ?? {
              lengthMm: null,
              widthMm: null,
              heightMm: null,
            },
            cost: product.cost,
          });
          setImages(product.images);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id, isNew, loadRevision]);

  useEffect(() => {
    if (!isNew || scope?.key !== 'cabochons' || !scopedCategory?.id) return;
    const timer = window.setTimeout(() => void generateCode(scopedCategory.id), 0);
    return () => window.clearTimeout(timer);
  }, [generateCode, isNew, scope, scopedCategory?.id]);

  useEffect(
    () => () => {
      codeRequestId.current += 1;
    },
    [],
  );

  async function save(values: Values) {
    if (isNew && !productSourceSchema.safeParse(sourceDraft).success) {
      message.error(sourceText('invalid'));
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<Product>(isNew ? '/api/products' : `/api/products/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify({
          code: values.code.trim(),
          name: values.name.trim(),
          description: (values.description ?? '').trim(),
          categoryId: scopedCategory?.id ?? values.categoryId,
          tagIds: values.tagIds ?? [],
          priceCents: Number(amountToCents(values.pricing.price!)!),
          saleRule: values.pricing.saleRule,
          saleRuleValue: values.pricing.saleRuleValue,
          saleManual: values.pricing.saleManual,
          currency: 'CNY',
          stock: values.stock,
          ...(isNew ? { source: sourceDraft } : {}),
          published: values.published,
          marketing: values.marketing,
          measurement: isCabochon ? values.measurement : null,
          cost: isCabochon ? values.cost : null,
          imageKeys: images.map((image) => image.objectKey),
        }),
      });
      if (isNew) {
        setCreatedProduct(saved);
        window.scrollTo(0, 0);
        return;
      }
      message.success(common('saved'));
      router.push(listPath);
      router.refresh();
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
      if (scope && error instanceof ClientApiError && error.code === 'CATEGORY_NOT_FOUND') {
        try {
          setCategories(await apiFetch<Category[]>('/api/categories'));
        } catch {
          setLoadError(true);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function addAnother(reuseCategory: boolean) {
    const categoryId = reuseCategory
      ? createdProduct?.categoryId
      : scope?.key === 'cabochons'
        ? scopedCategory?.id
        : undefined;
    const marketing = {
      videoShot: true,
      xiaohongshuVideoPublished: true,
      xiaohongshuListed: true,
      douyinVideoPublished: false,
      douyinListed: false,
    };
    setCreatedProduct(null);
    setProduct(null);
    setProductCategoryId(undefined);
    setInitialValues({});
    setImages([]);
    setSourceDraft(initialSource());
    setRecognitionInput('');
    form.resetFields();
    form.setFieldsValue({
      code: '',
      name: '',
      description: '',
      categoryId,
      tagIds: [],
      stock: 0,
      published: false,
      marketing,
      measurement: { lengthMm: null, widthMm: null, heightMm: null },
      cost: null,
      pricing: { saleRule: 'PERCENT_50', saleRuleValue: null, saleManual: false, price: null },
    });
    if (categoryId) void generateCode(categoryId);
    else codeRequestId.current += 1;
    window.scrollTo(0, 0);
  }

  async function createTag({ name }: { name: string }) {
    setCreatingTag(true);
    try {
      const tag = await apiFetch<Tag>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setTags((items) => [...items, tag].sort((a, b) => a.name.localeCompare(b.name)));
      const selected = form.getFieldValue('tagIds') ?? [];
      form.setFieldsValue({ tagIds: [...selected, tag.id] });
      message.success(common('saved'));
      tagForm.resetFields();
      setTagModalOpen(false);
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setCreatingTag(false);
    }
  }

  function recognizeMeasurement() {
    const parsed = parseMeasurement(recognitionInput);
    if (!parsed) {
      message.error(t('recognitionInvalid'));
      return;
    }
    form.setFieldsValue({ measurement: parsed });
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (loadError)
    return (
      <Result
        status="error"
        title={catalog('loadFailed')}
        extra={
          <Button onClick={() => setLoadRevision((value) => value + 1)}>{common('retry')}</Button>
        }
      />
    );
  if (scope && (scope.key === 'cabochons' ? !scopedCategory : !availableCategories.length))
    return (
      <MissingCategoryState
        categoryName={scope.key === 'cabochons' ? scope.categoryName : undefined}
        pageTitle={common(scope.titleKey)}
      />
    );
  if (
    scope &&
    !isNew &&
    (scope.key === 'cabochons'
      ? productCategoryId !== scopedCategory?.id
      : !availableCategories.some((item) => item.id === productCategoryId))
  )
    return (
      <Result
        status="warning"
        title={
          scope.key === 'cabochons'
            ? catalog('categoryMismatch', { category: scope.categoryName })
            : catalog('otherCategoryMismatch')
        }
        extra={
          <Link href={listPath}>
            <Button>{catalog('backToList')}</Button>
          </Link>
        }
      />
    );

  if (createdProduct)
    return (
      <Result
        status="success"
        title={common('saved')}
        extra={
          <Space wrap>
            <Button onClick={() => router.push(listPath)}>
              {scope ? catalog('backToList') : t('back')}
            </Button>
            <Button onClick={() => addAnother(false)}>{t('addAnother')}</Button>
            <Button type="primary" onClick={() => addAnother(true)}>
              {t('addAnotherWithCategory')}
            </Button>
          </Space>
        }
      />
    );

  return (
    <>
      <div className="page-heading editor-heading">
        <div>
          <Link href={listPath} className="back-link">
            <ArrowLeftOutlined /> {scope ? catalog('backToList') : t('back')}
          </Link>
          <h1>{isNew ? t('newTitle') : t('editTitle')}</h1>
        </div>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          description: '',
          categoryId: scopedCategory?.id,
          tagIds: [],
          stock: 0,
          published: false,
          marketing: {
            videoShot: true,
            xiaohongshuVideoPublished: true,
            xiaohongshuListed: true,
            douyinVideoPublished: false,
            douyinListed: false,
          },
          measurement: { lengthMm: null, widthMm: null, heightMm: null },
          cost: null,
          pricing: { saleRule: 'PERCENT_50', saleRuleValue: null, saleManual: false, price: null },
          ...initialValues,
        }}
        onFinish={save}
      >
        <div className="editor-surface">
          <section className="editor-block">
            <h2>{t('details')}</h2>
            <div className="editor-fields">
              <Form.Item
                className="editor-field-name"
                name="name"
                label={t('name')}
                rules={[{ required: true, whitespace: true, message: t('required') }, { max: 120 }]}
              >
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item
                className="editor-field-category"
                name="categoryId"
                label={t('category')}
                rules={[{ required: true, message: t('required') }]}
              >
                <Select
                  disabled={scope?.key === 'cabochons'}
                  placeholder={t('selectCategory')}
                  onChange={(categoryId: string) => {
                    if (isNew) void generateCode(categoryId);
                  }}
                  options={(scope?.key === 'cabochons'
                    ? [scopedCategory!]
                    : availableCategories
                  ).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                className="editor-field-code"
                name="code"
                label={t('code')}
                extra={t('codeHelp')}
                rules={[
                  { required: true, message: t('required') },
                  { pattern: /^[A-Za-z0-9_-]+$/ },
                  { max: 64 },
                ]}
              >
                <Input
                  maxLength={64}
                  readOnly={generatingCode}
                  aria-busy={generatingCode}
                  suffix={
                    <span style={{ display: 'inline-flex', width: 14, height: 14 }}>
                      {generatingCode && (
                        <Spin size="small" delay={200} aria-label={t('codeGenerating')} />
                      )}
                    </span>
                  }
                />
              </Form.Item>
              <Form.Item
                className="editor-field-stock"
                name="stock"
                label={t('stock')}
                hidden={isNew}
                rules={[
                  { required: true, message: t('required') },
                  { type: 'number', min: 0, max: 2147483647, message: t('stockInvalid') },
                  {
                    validator: (_, value) =>
                      value == null || Number.isInteger(value)
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('stockInvalid'))),
                  },
                ]}
              >
                <InputNumber
                  disabled
                  min={0}
                  max={2147483647}
                  precision={0}
                  step={1}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <div className="editor-field-tags">
                <Form.Item name="tagIds" label={t('tags')}>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    placeholder={t('selectTags')}
                    options={tags.map((item) => ({ value: item.id, label: item.name }))}
                  />
                </Form.Item>
                <Tooltip title={tagText('new')}>
                  <Button
                    icon={<PlusOutlined />}
                    aria-label={tagText('new')}
                    onClick={() => {
                      tagForm.resetFields();
                      setTagModalOpen(true);
                    }}
                  />
                </Tooltip>
              </div>
              <Form.Item
                className="editor-field-publication editor-switch-field"
                name="published"
                label={t('publication')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                className="editor-field-description"
                name="description"
                label={t('description')}
                rules={[{ max: 10000 }]}
              >
                <Input.TextArea rows={3} maxLength={10000} showCount />
              </Form.Item>
            </div>
            {!scope && !categories.length && (
              <Link href="/admin/categories">{t('noCategories')}</Link>
            )}
          </section>
          <section className="editor-block">
            <h2>{t('images')}</h2>
            <ImagePicker images={images} onChange={setImages} />
          </section>
          {isCabochon && (
            <section className="editor-block">
              <h2>{t('measurements')}</h2>
              <div className="measurement-fields">
                {(['lengthMm', 'widthMm', 'heightMm'] as const).map((field) => (
                  <Form.Item
                    key={field}
                    name={['measurement', field]}
                    label={t(field)}
                    rules={[{ type: 'number', min: 0.01, max: 99999999.99 }]}
                  >
                    <InputNumber
                      min={0.01}
                      max={99999999.99}
                      precision={2}
                      step={0.01}
                      suffix="mm"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                ))}
              </div>
              <Form.Item className="editor-recognizer-field" label={t('smartRecognition')}>
                <div className="measurement-recognizer">
                  <Input
                    value={recognitionInput}
                    onChange={(event) => setRecognitionInput(event.target.value)}
                    onPressEnter={(event) => {
                      event.preventDefault();
                      recognizeMeasurement();
                    }}
                    placeholder={t('recognitionPlaceholder')}
                  />
                  <Button icon={<ScanOutlined />} onClick={recognizeMeasurement}>
                    {t('recognize')}
                  </Button>
                </div>
              </Form.Item>
            </section>
          )}
          {isCabochon && (
            <section className="editor-block">
              <h2>{t('costs')}</h2>
              <Form.Item
                name="cost"
                className="cabochon-cost-form-item"
                rules={[
                  {
                    validator: (_, value) =>
                      value === null || cabochonCostSchema.safeParse(value).success
                        ? Promise.resolve()
                        : Promise.reject(new Error(t('costInvalid'))),
                  },
                ]}
              >
                <CabochonCostFields />
              </Form.Item>
            </section>
          )}
          <ProductSourceSection
            product={product}
            value={sourceDraft}
            onChange={(next) => {
              if (next.origin !== sourceDraft.origin) {
                form.setFieldsValue({
                  pricing:
                    next.origin === 'DIY' && !isCabochon
                      ? diyQuotePricing(
                          productPricingCost(false, null, next).amount,
                          productDiyQuote(next) ?? null,
                        )
                      : {
                          saleRule: 'PERCENT_50',
                          saleRuleValue: null,
                          saleManual: false,
                          price: null,
                        },
                });
              }
              setSourceDraft(next);
            }}
            categories={categories}
            onProductChanged={(updated) => {
              setProduct(updated);
              form.setFieldsValue({ stock: updated.stock });
            }}
          />
          <section className="editor-block">
            <h2>{t('saleDetails')}</h2>
            {!isDiyPricing && (
              <div className="product-pricing-cost">
                <strong>
                  {t('pricingCost')}:{' '}
                  {pricingCost.amount === null ? t('noCost') : `¥${pricingCost.amount}`}
                </strong>
                <span>{t(`pricingSource_${pricingCost.kind}`)}</span>
                {pricingCost.record && (
                  <span>
                    {t('pricingRecord', {
                      date: pricingCost.record.createdAt.slice(0, 10),
                      id: pricingCost.record.id,
                      batch: pricingCost.batchName ?? '—',
                    })}
                  </span>
                )}
              </div>
            )}
            <Form.Item
              name="pricing"
              dependencies={['cost', 'categoryId']}
              rules={[
                {
                  validator: (_, value: ProductPricingValues | undefined) => {
                    const price = value?.price == null ? null : amountToCents(value.price);
                    const automatic =
                      value &&
                      calculateProductPrice(
                        pricingCost.amount,
                        value.saleRule,
                        value.saleRuleValue,
                      );
                    return price !== null &&
                      price <= maximumProductPriceCents &&
                      (value?.saleManual || (automatic !== null && automatic !== undefined))
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('pricingInvalid')));
                  },
                },
              ]}
            >
              <ProductPricingFields
                cost={pricingCost.amount}
                quote={isCabochon ? undefined : productDiyQuote(product ?? sourceDraft)}
              />
            </Form.Item>
            {!isNew && <p className="product-pricing-help">{t('pricingSaveHelp')}</p>}
            <p
              className={`product-pricing-profit${profitCents === null ? ' is-pending' : isLoss ? ' is-loss' : ''}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {profitCents === null
                ? t('profitPending')
                : t.rich(isLoss ? 'estimatedLoss' : 'estimatedProfit', {
                    amount: centsToAmount(isLoss ? -profitCents : profitCents),
                    money: (chunks) => <strong>{chunks}</strong>,
                  })}
            </p>
          </section>
          <section className="editor-block">
            <h2>{t('marketing')}</h2>
            <div className="editor-marketing-grid">
              {(
                [
                  'videoShot',
                  'xiaohongshuVideoPublished',
                  'xiaohongshuListed',
                  'douyinVideoPublished',
                  'douyinListed',
                ] as const
              ).map((field) => (
                <Form.Item
                  key={field}
                  className="editor-switch-field"
                  name={['marketing', field]}
                  label={t(field)}
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              ))}
            </div>
          </section>
          <div className="editor-actions">
            <Link href={listPath}>
              <Button>{common('cancel')}</Button>
            </Link>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={saving}
              disabled={
                generatingCode ||
                !availableCategories.length ||
                (scope?.key === 'cabochons' && !scopedCategory)
              }
            >
              {common('save')}
            </Button>
          </div>
        </div>
      </Form>
      <Modal
        title={tagText('newTitle')}
        open={tagModalOpen}
        onCancel={() => {
          if (!creatingTag) {
            tagForm.resetFields();
            setTagModalOpen(false);
          }
        }}
        onOk={() => tagForm.submit()}
        okText={common('save')}
        cancelText={common('cancel')}
        confirmLoading={creatingTag}
        forceRender
      >
        <Form form={tagForm} layout="vertical" onFinish={createTag}>
          <Form.Item
            name="name"
            label={tagText('name')}
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
