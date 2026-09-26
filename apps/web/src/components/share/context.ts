import { createContext, useContext } from 'react';
import type { AppState, Space } from '../../lib/space';
import { useStore } from '../../lib/store';

export const SpaceCtx = createContext<Space | null>(null);

export function useSpace(): Space {
  const s = useContext(SpaceCtx);
  if (!s) throw new Error('no space');
  return s;
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useStore(useSpace().store, select);
}
