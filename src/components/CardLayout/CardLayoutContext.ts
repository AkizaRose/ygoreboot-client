import { createContext, useContext } from 'react';
import { DEFAULT_CARD_LAYOUT, type CardLayoutId } from './cardLayouts';

export interface CardLayoutContextValue {
  layout: CardLayoutId;
  setCardLayout: (newLayout: CardLayoutId) => Promise<void>;
}

// The default (used by anything rendered outside a <CardLayoutProvider>)
// is the Modern layout with a no-op setter, so a component can always
// call useCardLayout() safely.
export const CardLayoutContext = createContext<CardLayoutContextValue>({
  layout: DEFAULT_CARD_LAYOUT,
  setCardLayout: async () => {},
});

export function useCardLayout(): CardLayoutContextValue {
  return useContext(CardLayoutContext);
}
