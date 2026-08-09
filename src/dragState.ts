import type { CardData } from './types/Card';

export type DeckName = 'main' | 'extra' | 'side';
export type DragSource = 'browser' | DeckName;

export interface DragPayload {
  card: CardData;
  source: DragSource;
  // Present only when source is a deck (not 'browser') — the slot index
  // the card is being dragged FROM, so it can be removed from there on a
  // successful drop elsewhere.
  index?: number;
}

// Not React state: drag payload changes on every dragstart/dragend, and
// nothing needs to re-render just because a drag started — only the
// actual drop handler needs to read this, once, at drop time.
let currentPayload: DragPayload | null = null;

export function setDragPayload(payload: DragPayload): void {
  currentPayload = payload;
}

export function getDragPayload(): DragPayload | null {
  return currentPayload;
}

export function clearDragPayload(): void {
  currentPayload = null;
}
