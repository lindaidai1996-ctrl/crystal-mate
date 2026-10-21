'use client';

import { App, type FormInstance } from 'antd';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';

type CodeReservation = { code: string; reservationToken: string };
type SavedProduct = { code: string; categoryId: string };

export function useProductCode(form: FormInstance, product: SavedProduct | null) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [generatingCode, setGeneratingCode] = useState(false);
  const requestId = useRef(0);
  const reservations = useRef(new Map<string, CodeReservation>());
  const activeReservation = useRef<CodeReservation | null>(null);

  const resetCode = useCallback(() => {
    requestId.current += 1;
    reservations.current.clear();
    activeReservation.current = null;
    setGeneratingCode(false);
  }, []);

  const generateCode = useCallback(
    async (categoryId: string | undefined) => {
      const currentRequest = ++requestId.current;
      activeReservation.current = null;
      setGeneratingCode(false);
      if (product && categoryId === product.categoryId) {
        form.setFieldsValue({ code: product.code });
        return;
      }
      if (!categoryId) {
        form.setFieldsValue({ code: '' });
        return;
      }
      const cached = reservations.current.get(categoryId);
      if (cached) {
        activeReservation.current = cached;
        form.setFieldsValue({ code: cached.code });
        return;
      }

      form.setFieldsValue({ code: '' });
      setGeneratingCode(true);
      try {
        const result = await apiFetch<CodeReservation>('/api/products/code', {
          method: 'POST',
          body: JSON.stringify({ categoryId }),
        });
        if (currentRequest !== requestId.current) return;
        reservations.current.set(categoryId, result);
        activeReservation.current = result;
        form.setFieldsValue({ code: result.code });
      } catch (error) {
        if (currentRequest === requestId.current) {
          message.error(
            error instanceof ClientApiError
              ? common(`errors.${error.code}` as never)
              : t('codeGenerationFailed'),
          );
        }
      } finally {
        if (currentRequest === requestId.current) setGeneratingCode(false);
      }
    },
    [common, form, message, product, t],
  );

  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  function getCodeReservationToken(code: string) {
    return activeReservation.current?.code === code
      ? activeReservation.current.reservationToken
      : undefined;
  }

  return { generatingCode, generateCode, resetCode, getCodeReservationToken };
}
