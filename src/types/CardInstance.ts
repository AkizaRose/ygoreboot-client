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
  // Who this specific card actually BELONGS to, if that ever differs
  // from whoever currently controls it — unset means the owner IS the
  // controller (the ordinary case for every card that's never changed
  // control). Set once, the first time a card changes control (see
  // MultiplayerDuelFieldPage's own handleMoveToOpponentTarget), and
  // preserved unchanged through any further moves after that — control
  // can keep changing hands, but ownership itself never does. Lives here
  // on the base type, not just PlacedCard, because a buried Fusion
  // material (stackedBelow below) is a plain CardInstance in its own
  // right and needs to carry its OWN ownership independently of
  // whatever the top card's is — a stack can easily mix materials
  // originally owned by either player. What lets any card that leaves
  // the field (Grave, Banished, hand, either deck) return to its own
  // true owner rather than whoever happened to control it at the time
  // (see handleFieldAction and pendingCardReturn).
  owner?: 'player1' | 'player2';
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
  // Manually adjusted ATK/DEF (see StatAdjustDialog) — null/undefined
  // means "use the card's own base stat," same convention as
  // lastHandDepartureIndex elsewhere (absence, not a sentinel value,
  // means nothing's been set yet). Only ever meaningful for Monster
  // Zone cards, same as position above.
  atkOverride?: number | null;
  defOverride?: number | null;
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