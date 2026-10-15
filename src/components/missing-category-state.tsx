import { FolderAddOutlined, PlusOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function MissingCategoryState({
  categoryName,
  pageTitle,
}: {
  categoryName?: string;
  pageTitle: string;
}) {
  const t = useTranslations('catalog');

  return (
    <>
      <div className="page-heading">
        <h1>{pageTitle}</h1>
      </div>
      <section className="catalog-empty-state">
        <span className="catalog-empty-icon" aria-hidden="true">
          <FolderAddOutlined />
        </span>
        <h2>
          {categoryName
            ? t('missingCategory', { category: categoryName })
            : t('missingOtherCategory')}
        </h2>
        <Link href="/admin/categories">
          <Button type="primary" icon={<PlusOutlined />}>
            {t('manageCategories')}
          </Button>
        </Link>
      </section>
    </>
  );
}
