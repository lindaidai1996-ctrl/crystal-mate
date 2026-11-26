'use client';

import { useSearchParams } from 'next/navigation';

export function useMaterialPricingGroup(initialGroupId?: string) {
  const searchParams = useSearchParams();
  const groupId = searchParams.get('group') ?? initialGroupId;
  const selectGroup = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('group', id);
    // A group is a client-side filter; keep the mounted page and its group list.
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  return { groupId, selectGroup };
}
