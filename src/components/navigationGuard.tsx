'use client';

import { createContext, useCallback, useContext, useMemo, useRef } from 'react';

type Action = () => void;
type Guard = (action: Action) => void | Promise<void>;
const NavigationGuardContext = createContext({
  navigate: (action: Action) => action(),
  setGuard: (_guard: Guard | null) => {
    void _guard;
  },
});

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const guard = useRef<Guard | null>(null);
  const navigate = useCallback((action: Action) => {
    if (guard.current) void guard.current(action);
    else action();
  }, []);
  const setGuard = useCallback((next: Guard | null) => {
    guard.current = next;
  }, []);
  const value = useMemo(() => ({ navigate, setGuard }), [navigate, setGuard]);
  return (
    <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>
  );
}

export const useNavigationGuard = () => useContext(NavigationGuardContext);
