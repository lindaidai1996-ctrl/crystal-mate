'use client';

import { createContext, useContext, type ReactNode, type RefObject } from 'react';

type AssistantNavigation = {
  menu: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
};

export const AssistantNavigationContext = createContext<AssistantNavigation | null>(null);

export function useAssistantNavigation() {
  const navigation = useContext(AssistantNavigationContext);
  if (!navigation) throw new Error('Assistant navigation requires the admin shell');
  return navigation;
}
