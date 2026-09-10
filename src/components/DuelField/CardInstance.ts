import type { CardData } from './Card';

// A specific physical card as it exists in an active duel — carries a
// unique instanceId that persists across every move (hand -> field ->
// grave -> deck -> ...) for the rest of the duel. This is what lets
// framer-motion's layoutId recognize "this is the same card, just
// relocated" and animate the transition, rather than seeing an element
// disappear in one place and an unrelated one appear elsewhere.
//
// New instanceIds are only ever generated once, when a deck is first
// loaded (or reset) via createCardInstance — every subsequent move
// carries the SAME id forward. Never generate a new one mid-duel for a
// card that already has one.
export interface CardInstance {
  instanceId: string;
  card: CardData;
}

// A card instance placed in a field zone, with zone-specific state on
// top. Structurally a CardInstance plus extras — anywhere a CardInstance
// is expected, a PlacedCard works too (e.g. pushing a card removed from
// a field zone back into a plain CardInstance[] pile like Grave).
export interface PlacedCard extends CardInstance {
  faceDown: boolean;
  // Only meaningful for Monster Zone cards — defaults to 'attack' when
  // omitted. Spell/Trap/Field Zone cards never set this.
  position?: 'attack' | 'defense';
  // Cards stacked beneath this one (e.g. via Fuse) — only ever
  // meaningful for Monster Zone cards; Spell/Trap/Field Zone cards never
  // set this. Ordered bottom-to-top, same convention as Grave/Banished
  // (last entry is the one directly beneath the active top card, whose
  // own instanceId/card/faceDown/position — above, at this PlacedCard's
  // own top level — represent the whole stack for every purpose except
  // this). Buried cards don't track their own faceDown/position: they're
  // never independently shown or interacted with while buried, only
  // revealed via View, and only ever leave the field as a side effect of
  // the whole stack breaking apart (straight to Grave, regardless of
  // what happens to the top card — see handleFieldAction).
  stackedBelow?: CardInstance[];
}

export function createCardInstance(card: CardData): CardInstance {
  return { instanceId: crypto.randomUUID(), card };
}