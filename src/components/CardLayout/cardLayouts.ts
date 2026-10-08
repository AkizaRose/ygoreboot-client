import classicPreviewUrl from '../../assets/ui/cardlayoutselect/Classic.png';
import modernPreviewUrl from '../../assets/ui/cardlayoutselect/Modern.png';

// The two card layouts a user can pick between on the Account page.
// "modern" is the original layout (CardView/Card.tsx); "classic" is the
// older frame-art layout (CardViewClassic/CardClassic.tsx).
export type CardLayoutId = 'modern' | 'classic';

export const DEFAULT_CARD_LAYOUT: CardLayoutId = 'modern';

export interface CardLayoutOption {
  id: CardLayoutId;
  label: string;
  previewUrl: string;
}

export const CARD_LAYOUT_OPTIONS: CardLayoutOption[] = [
  { id: 'modern', label: 'Modern', previewUrl: modernPreviewUrl },
  { id: 'classic', label: 'Classic', previewUrl: classicPreviewUrl },
];

// Used on whatever comes back from Firestore/localStorage, where the
// stored value could be missing (nobody has chosen yet) or something this
// build doesn't know about (e.g. a layout removed since it was saved).
export function isCardLayoutId(value: unknown): value is CardLayoutId {
  return value === 'modern' || value === 'classic';
}
