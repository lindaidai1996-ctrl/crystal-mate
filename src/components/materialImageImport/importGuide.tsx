'use client';

import { Image } from 'antd';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingImage } from '@/components/loadingImage';
import importStyles from './materialImageImport.module.css';

export function ImportGuide() {
  const t = useTranslations('imageImport');
  const [preview, setPreview] = useState(false);

  return (
    <section className={importStyles.guide} aria-labelledby="import-guide-title">
      <div className={importStyles.sectionHeading}>
        <h2 id="import-guide-title">{t('guideTitle')}</h2>
        <p>{t('guideDescription')}</p>
      </div>
      <figure className={importStyles.example}>
        <Image.PreviewGroup
          items={[{ src: '/images/example-1.jpg', alt: t('exampleAlt') }]}
          preview={{ visible: preview, onVisibleChange: setPreview }}
        >
          <button
            type="button"
            className={importStyles.examplePreview}
            aria-label={t('viewExample')}
            onClick={() => setPreview(true)}
          >
            <LoadingImage
              src="/images/example-1.jpg"
              alt={t('exampleAlt')}
              width={1836}
              height={1378}
              className={importStyles.exampleImage}
            />
            <span>{t('viewExample')}</span>
          </button>
        </Image.PreviewGroup>
        <figcaption>{t('exampleCaption')}</figcaption>
      </figure>
      <ol className={importStyles.guideSteps}>
        {['Upload', 'Recognize', 'Review'].map((step, index) => (
          <li key={step}>
            <span className={importStyles.guideNumber} aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{t(`guide${step}Title`)}</h3>
              <p>{t(`guide${step}Help`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={importStyles.guideFootnote}>{t('guideFormats')}</p>
    </section>
  );
}
