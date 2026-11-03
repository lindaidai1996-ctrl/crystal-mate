'use client';
import { PlusOutlined, ScanOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Cascader,
  ConfigProvider,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tooltip,
} from 'antd';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type { MaterialAmount, MaterialCategory, MaterialValues, Tag } from '@/lib/client-types';
import { recognizeMaterialCategory } from '@/lib/material-calculations';
import { categoryPath, categoryTree } from './categoryTree';
import { MaterialAmountInput } from './purchaseFields';
import { AliasInput } from '@/components/catalog/aliasInput';

export function MaterialBasicFields({
  values: draft,
  categories,
  tags,
  tagIds,
  onTagsChange: setTagIds,
  onTagCreated,
  onCategoryCreated,
  onNameRecognized,
  onChange: change,
  onValuesChange,
  onAliasesChange,
  allowAliasEditing = false,
  isAddingEntry = false,
  isMasterEdit = false,
  unitLocked = false,
  submitted = false,
}: {
  values: MaterialValues;
  categories: MaterialCategory[];
  tags: Tag[];
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  onTagCreated: (tag: Tag) => void;
  onCategoryCreated: (category: MaterialCategory) => void;
  onNameRecognized?: (categoryId: string | undefined, tagIds: string[]) => void;
  onChange: (field: keyof MaterialValues, value: string | number | null) => void;
  onValuesChange: (values: MaterialValues) => void;
  onAliasesChange: (aliases: string[]) => void;
  allowAliasEditing?: boolean;
  isAddingEntry?: boolean;
  isMasterEdit?: boolean;
  unitLocked?: boolean;
  submitted?: boolean;
}) {
  const t = useTranslations('materialEditor');
  const tagText = useTranslations('tags');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const { componentDisabled } = ConfigProvider.useConfig();
  const nameBeforeFocus = useRef('');
  const [tagForm] = Form.useForm<{ name: string }>();
  const [categoryForm] = Form.useForm<{ name: string; parentPath?: string[] }>();
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const amount = (field: 'lengthMm' | 'widthMm' | 'heightMm', suffix: string, positive = false) => (
    <MaterialAmountInput
      value={draft[field] as MaterialAmount}
      suffix={suffix}
      label={t(field)}
      positive={positive}
      onChange={(value) => change(field, value)}
    />
  );
  function recognizeName(name: string) {
    if (isAddingEntry || name === nameBeforeFocus.current) return;
    const category = recognizeMaterialCategory(name, categories);
    const input = name.normalize('NFKC').trim().toLowerCase();
    const matchedTagIds = tags
      .filter((tag) => {
        const term = tag.name.normalize('NFKC').trim().toLowerCase();
        return term.length > 0 && input.includes(term);
      })
      .map((tag) => tag.id);
    if (onNameRecognized) {
      if (category || matchedTagIds.length)
        onNameRecognized(category?.id, [...new Set([...tagIds, ...matchedTagIds])]);
      return;
    }
    if (category) change('categoryId', category.id);
    if (matchedTagIds.length) {
      setTagIds([...new Set([...tagIds, ...matchedTagIds])]);
    }
  }

  function recognize() {
    const category = recognizeMaterialCategory(draft.name, categories);
    if (!category) {
      message.warning(t('recognitionFailed'));
      return;
    }
    change('categoryId', category.id);
    message.success(t('recognized', { category: category.name }));
  }

  async function createTag({ name }: { name: string }) {
    setCreatingTag(true);
    try {
      const tag = await apiFetch<Tag>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      onTagCreated(tag);
      setTagIds([...tagIds, tag.id]);
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

  async function createCategory({ name, parentPath }: { name: string; parentPath?: string[] }) {
    setCreatingCategory(true);
    try {
      const category = await apiFetch<MaterialCategory>('/api/material-categories', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          parentId: parentPath?.at(-1) ?? null,
          aliases: [],
        }),
      });
      onCategoryCreated(category);
      change('categoryId', category.id);
      message.success(common('saved'));
      categoryForm.resetFields();
      setCategoryModalOpen(false);
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setCreatingCategory(false);
    }
  }

  return (
    <>
      <section className="editor-block">
        <h2>{t('basics')}</h2>
        <div className="material-field-grid">
          <Form.Item
            label={t('name')}
            required
            validateStatus={submitted && !draft.name.trim() ? 'error' : undefined}
            help={submitted && !draft.name.trim() ? t('required') : undefined}
          >
            <Input
              value={draft.name}
              aria-label={t('name')}
              disabled={componentDisabled || isAddingEntry}
              maxLength={120}
              onFocus={(event) => {
                nameBeforeFocus.current = event.target.value;
              }}
              onChange={(event) => change('name', event.target.value)}
              onBlur={(event) => recognizeName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label={common('aliases')} extra={common('aliasesHelp')}>
            <AliasInput
              value={draft.aliases ?? []}
              onChange={onAliasesChange}
              disabled={componentDisabled || (isAddingEntry && !allowAliasEditing)}
            />
          </Form.Item>
          <Form.Item
            label={t('category')}
            required
            validateStatus={submitted && !draft.categoryId ? 'error' : undefined}
            help={submitted && !draft.categoryId ? t('required') : undefined}
          >
            <div className="material-category-control">
              <Cascader
                options={categoryTree(categories)}
                disabled={componentDisabled || isAddingEntry}
                value={draft.categoryId ? categoryPath(draft.categoryId, categories) : []}
                onChange={(path) => change('categoryId', (path?.at(-1) as string) ?? '')}
                placeholder={t('selectCategory')}
                aria-label={t('category')}
                showSearch
                changeOnSelect
                allowClear
              />
              {!isAddingEntry && (
                <>
                  <Tooltip title={t('newCategory')}>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => {
                        categoryForm.resetFields();
                        setCategoryModalOpen(true);
                      }}
                      aria-label={t('newCategory')}
                    />
                  </Tooltip>
                  <Tooltip title={t('recognize')}>
                    <Button icon={<ScanOutlined />} onClick={recognize} aria-label={t('recognize')}>
                      {t('recognize')}
                    </Button>
                  </Tooltip>
                </>
              )}
            </div>
          </Form.Item>
          {!categories.length && (
            <Link href="/admin/materials/categories">{t('noCategories')}</Link>
          )}
          <div className="editor-field-tags material-full-width">
            <Form.Item label={t('tags')}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                value={tagIds}
                onChange={setTagIds}
                disabled={componentDisabled || isAddingEntry}
                aria-label={t('tags')}
                placeholder={t('selectTags')}
                options={tags.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            {!isAddingEntry && (
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
            )}
          </div>
          <Form.Item
            label={t('unit')}
            className="material-full-width"
            extra={unitLocked ? t('unitLocked') : undefined}
          >
            <Radio.Group
              value={draft.unit}
              aria-label={t('unit')}
              disabled={componentDisabled || isAddingEntry || unitLocked}
              onChange={(event) => change('unit', event.target.value)}
              options={[
                { label: t('STRAND'), value: 'STRAND' },
                { label: t('BEAD'), value: 'BEAD' },
                { label: t('GRAM'), value: 'GRAM' },
              ]}
            />
          </Form.Item>
        </div>
        {!isMasterEdit && (
          <>
            <h3 className="material-subheading">{t('dimensions')}</h3>
            <div className="material-field-grid material-three-columns">
              <Form.Item
                label={
                  <Space size={8}>
                    {t('lengthMm')}
                    <Button
                      type="link"
                      size="small"
                      htmlType="button"
                      disabled={
                        componentDisabled ||
                        !Number.isFinite(Number(draft.lengthMm)) ||
                        Number(draft.lengthMm) <= 0
                      }
                      onClick={() =>
                        onValuesChange({
                          ...draft,
                          widthMm: draft.lengthMm,
                          heightMm: draft.lengthMm,
                        })
                      }
                    >
                      {common('applyToWidthHeight')}
                    </Button>
                  </Space>
                }
              >
                {amount('lengthMm', 'mm', true)}
              </Form.Item>
              <Form.Item label={t('widthMm')}>{amount('widthMm', 'mm', true)}</Form.Item>
              <Form.Item label={t('heightMm')}>{amount('heightMm', 'mm', true)}</Form.Item>
            </div>
          </>
        )}
      </section>
      <Modal
        title={t('newCategoryTitle')}
        open={categoryModalOpen}
        onCancel={() => {
          if (!creatingCategory) {
            categoryForm.resetFields();
            setCategoryModalOpen(false);
          }
        }}
        onOk={() => categoryForm.submit()}
        okText={common('save')}
        cancelText={common('cancel')}
        confirmLoading={creatingCategory}
        forceRender
      >
        <Form form={categoryForm} layout="vertical" onFinish={createCategory}>
          <Form.Item
            name="name"
            label={t('categoryName')}
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} autoFocus />
          </Form.Item>
          <Form.Item name="parentPath" label={t('categoryParent')}>
            <Cascader
              options={categoryTree(categories)}
              showSearch
              changeOnSelect
              allowClear
              placeholder={t('categoryRoot')}
            />
          </Form.Item>
        </Form>
      </Modal>
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
