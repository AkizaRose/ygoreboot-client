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
}

export function createCardInstance(card: CardData): CardInstance {
  return { instanceId: crypto.randomUUID(), card };
}
