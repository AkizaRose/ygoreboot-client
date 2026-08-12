import FieldZone, { type FieldZoneAction } from './FieldZone';
import type { CardData } from '../../types/Card';
import type { PlacedCard } from '../../types/CardInstance';
import cardBackImg from '../../assets/card/CardBack.png';
import './DuelField.css';

// Re-exported so existing `import { type PlacedCard } from
// './DuelField'` call sites keep working without changing their import.
export type { PlacedCard };

// Same five actions for most placed cards on the field, regardless of
// card class or which zone it's in.
const STANDARD_FIELD_CARD_ACTIONS: FieldZoneAction[] = [
  { key: 'toHand', label: 'To Hand' },
  { key: 'toGrave', label: 'To Grave' },
  { key: 'banish', label: 'Banish' },
  { key: 'stackTop', label: 'Stack (to top)' },
  { key: 'stackBottom', label: 'Stack (to bottom)' },
];

// Fusion/Ritual/Evolution Monsters only ever belong in the Main Deck,
// Extra Deck, or the field — never the hand, and "stacking" them into the
// Main Deck doesn't make sense either. Sending one away from the field
// goes back to the Extra Deck instead.
const EXTRA_DECK_MONSTER_FIELD_ACTIONS: FieldZoneAction[] = [
  { key: 'toExtra', label: 'To Extra' },
  { key: 'toGrave', label: 'To Grave' },
  { key: 'banish', label: 'Banish' },
];

function isExtraDeckMonster(card: CardData): boolean {
  return (
    card.cardClass === 'Monster' &&
    ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '')
  );
}

// Face-down cards (Set Spells/Traps, and — once Set Monster exists —
// face-down monsters too) get an extra "Activate" option at the front,
// flipping the card face-up in place rather than moving it anywhere.
function getPlacedCardActions(card: CardData | undefined, faceDown: boolean): FieldZoneAction[] {
  const base =
    card && isExtraDeckMonster(card)
      ? EXTRA_DECK_MONSTER_FIELD_ACTIONS
      : STANDARD_FIELD_CARD_ACTIONS;
  return faceDown ? [{ key: 'activate', label: 'Activate' }, ...base] : base;
}

// Main Deck and Extra Deck share "View", but only Main Deck gets Shuffle
// — Extra Deck's order is meaningful (matches the Deck Builder) and
// isn't meant to be randomized. Grave/Banished also stay view-only.
const VIEW_ACTION: FieldZoneAction = { key: 'view', label: 'View' };
const VIEW_ONLY_ACTIONS: FieldZoneAction[] = [VIEW_ACTION];
const MAIN_DECK_ACTIONS: FieldZoneAction[] = [
  VIEW_ACTION,
  { key: 'shuffle', label: 'Shuffle' },
  { key: 'reset', label: 'Reset' },
];

// Main Deck and Extra Deck sit at different distances from a centered
// player viewpoint (Main Deck to the right, Extra Deck to the left of
// the field's own center), so their stacks may need to look different
// to simulate that — kept as separate, independently-tunable values
// rather than one shared constant. X/Y are independent too, so a stack
// can lean more steeply in one direction than the other. Starting
// values are identical; adjust any of them once you see how the stacks
// actually render.
const MAIN_DECK_STACK_OFFSET_STEP_X = 0.25;
const MAIN_DECK_STACK_OFFSET_STEP_Y = 0.25;
const MAIN_DECK_STACK_MAX_LAYERS = 40;
const EXTRA_DECK_STACK_OFFSET_STEP_X = -0.25;
const EXTRA_DECK_STACK_OFFSET_STEP_Y = 0.25;
const EXTRA_DECK_STACK_MAX_LAYERS = 10;
const GRAVE_STACK_OFFSET_STEP_X = 0.25;
const GRAVE_STACK_OFFSET_STEP_Y = 0.25;
const GRAVE_STACK_MAX_LAYERS = 50;
const BANISHED_STACK_OFFSET_STEP_X = 0.25;
const BANISHED_STACK_OFFSET_STEP_Y = 0.25;
const BANISHED_STACK_MAX_LAYERS = 50;

// 'kind' identifies which entries should render real data (a placed
// monster, a deck pile) once it's available, rather than a plain text
// label. Order/labels unchanged from before.
type FieldZoneKind = 'field' | 'monster' | 'grave' | 'banished';

interface FieldZoneConfig {
  label: string;
  kind: FieldZoneKind;
}

const FIELD_ZONES: FieldZoneConfig[] = [
  { label: 'Field Zone', kind: 'field' },
  { label: 'Monster Zone', kind: 'monster' },
  { label: 'Monster Zone', kind: 'monster' },
  { label: 'Monster Zone', kind: 'monster' },
  { label: 'Grave', kind: 'grave' },
  { label: 'Banished Zone', kind: 'banished' },
];

type DeckZoneKind = 'extra' | 'spellTrap' | 'main';

interface DeckZoneConfig {
  label: string;
  kind: DeckZoneKind;
}

const DECK_ZONES: DeckZoneConfig[] = [
  { label: 'Extra Deck', kind: 'extra' },
  { label: 'Spell/Trap Zone', kind: 'spellTrap' },
  { label: 'Spell/Trap Zone', kind: 'spellTrap' },
  { label: 'Spell/Trap Zone', kind: 'spellTrap' },
  { label: 'Main Deck', kind: 'main' },
];

interface PlayerFieldProps {
  // Opponent (top of screen): both the row order (deck row furthest from
  // the center line) AND the left-right zone order within each row are
  // reversed — simulating what the board would look like if physically
  // rotated 180° to view from the opponent's own seat, not just stacked
  // above the player's field in the same orientation.
  flipped?: boolean;
  // Loaded deck piles — only meaningful for the player's own side for
  // now (no opponent deck data exists yet). When provided (non-empty),
  // the Main Deck / Extra Deck zones render as face-down piles instead
  // of plain labels.
  mainDeck?: CardData[];
  extraDeck?: CardData[];
  // The specific card currently on top of the Main Deck — used only to
  // give the draw animation something to track (see FieldZone's
  // topCardInstanceId). Not needed for Extra Deck, which isn't drawn
  // from.
  mainDeckTopCardId?: string;
  // The 3 Monster Zone / Spell-Trap Zone slots, left-to-right in the
  // player's own (unreversed) view — index 0 is the leftmost. Only ever
  // passed for the player's side for now.
  monsterZones?: (PlacedCard | null)[];
  spellTrapZones?: (PlacedCard | null)[];
  // Grave/Banished piles — shown face-up (top card + count), unlike the
  // face-down Main/Extra Deck piles, since these aren't secret zones.
  grave?: CardData[];
  banished?: CardData[];
  // Single slot (unlike the 3-wide Monster/Spell-Trap zones) — activating
  // a new Field Spell replaces whatever's already here.
  fieldZone?: PlacedCard | null;
  // Only ever wired up on the player's (non-flipped) side.
  onDrawCard?: () => void;
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  // Zone type + slot index identify exactly which card the action
  // applies to — FieldZone itself doesn't know its own position, only
  // PlayerField does (via the slot-index tracking below), so that
  // context gets baked into a per-zone closure at render time here.
  onFieldAction?: (zoneType: 'monster' | 'spellTrap' | 'field', index: number, actionKey: string) => void;
  onMainDeckAction?: (actionKey: string) => void;
  onViewExtraDeck?: () => void;
  onViewGrave?: () => void;
  onViewBanished?: () => void;
}

function PlayerField({
  flipped = false,
  mainDeck = [],
  extraDeck = [],
  mainDeckTopCardId,
  monsterZones = [],
  spellTrapZones = [],
  grave = [],
  banished = [],
  fieldZone = null,
  onDrawCard,
  onCardHover,
  onCardHoverEnd,
  onFieldAction,
  onMainDeckAction,
  onViewExtraDeck,
  onViewGrave,
  onViewBanished,
}: PlayerFieldProps) {
  const fieldZones = flipped ? [...FIELD_ZONES].reverse() : FIELD_ZONES;
  const deckZones = flipped ? [...DECK_ZONES].reverse() : DECK_ZONES;

  // Tracks which zone slot (0, 1, 2 — always in the player's own natural
  // left-to-right order) each 'monster'/'spellTrap'-kind entry
  // corresponds to, as we iterate in whatever order (reversed for the
  // opponent) it's actually rendered in.
  let monsterSlotIndex = -1;
  let spellTrapSlotIndex = -1;

  const fieldRow = (
    <div className="DuelField-row">
      {/* Player only: shifts this whole row one column right relative to
          the opponent's (unshifted) row above/below it — equivalent to,
          and achieving the same result as, shifting the opponent's row
          left instead. This isolates each side's Banished Zone in its
          own column at the outer edge of the board (opponent's on the
          far left, player's on the far right), while the Monster Zones
          land in the same columns for both sides. */}
      {!flipped && <div className="DuelField-emptyZone" />}
      {fieldZones.map((zone, i) => {
        if (zone.kind === 'field') {
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={fieldZone?.card}
              instanceId={fieldZone?.instanceId}
              faceDown={fieldZone?.faceDown}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={getPlacedCardActions(fieldZone?.card, fieldZone?.faceDown ?? false)}
              onMenuAction={
                fieldZone && onFieldAction
                  ? (actionKey) => onFieldAction('field', 0, actionKey)
                  : undefined
              }
            />
          );
        }
        if (zone.kind === 'monster') {
          monsterSlotIndex += 1;
          // Captured into a fresh const rather than referencing
          // monsterSlotIndex directly inside the closure below — that
          // variable keeps incrementing as the loop continues, so a
          // closure over the variable itself (rather than its value at
          // this point in the iteration) would have every Monster Zone's
          // button end up pointing at whatever the FINAL slot index was
          // by the time any of them actually got clicked.
          const slotIndex = monsterSlotIndex;
          const placed = monsterZones[slotIndex] ?? undefined;
          // Position toggle only applies to face-up monsters — there's no
          // Set Monster yet, so faceDown is always false here in
          // practice, but the guard is correct regardless.
          const positionAction: FieldZoneAction[] =
            placed && !placed.faceDown
              ? placed.position === 'defense'
                ? [{ key: 'toAttack', label: 'To ATK' }]
                : [{ key: 'toDefense', label: 'To DEF' }]
              : [];
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={placed?.card}
              instanceId={placed?.instanceId}
              faceDown={placed?.faceDown}
              battlePosition={placed?.position}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={[
                ...getPlacedCardActions(placed?.card, placed?.faceDown ?? false),
                ...positionAction,
              ]}
              onMenuAction={
                placed && onFieldAction
                  ? (actionKey) => onFieldAction('monster', slotIndex, actionKey)
                  : undefined
              }
              showRotatedOverlay
            />
          );
        }
        if (zone.kind === 'grave') {
          const topCard = grave.length > 0 ? grave[grave.length - 1] : undefined;
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard}
              count={grave.length > 0 ? grave.length : undefined}
              stackOffsetStepX={GRAVE_STACK_OFFSET_STEP_X}
              stackOffsetStepY={GRAVE_STACK_OFFSET_STEP_Y}
              stackMaxLayers={GRAVE_STACK_MAX_LAYERS}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={VIEW_ONLY_ACTIONS}
              onMenuAction={onViewGrave ? () => onViewGrave() : undefined}
            />
          );
        }
        if (zone.kind === 'banished') {
          const topCard = banished.length > 0 ? banished[banished.length - 1] : undefined;
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard}
              count={banished.length > 0 ? banished.length : undefined}
              stackOffsetStepX={BANISHED_STACK_OFFSET_STEP_X}
              stackOffsetStepY={BANISHED_STACK_OFFSET_STEP_Y}
              stackMaxLayers={BANISHED_STACK_MAX_LAYERS}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={VIEW_ONLY_ACTIONS}
              onMenuAction={onViewBanished ? () => onViewBanished() : undefined}
            />
          );
        }
        return <FieldZone key={i} label={zone.label} />;
      })}
    </div>
  );

  const deckRow = (
    <div className="DuelField-row">
      {/* Both sides get exactly one leading empty cell here, for two
          different reasons that happen to need the same fix: the
          opponent's deck row needs it to align with its own (unshifted)
          field row above it, while the player's deck row needs it to
          stay shifted in step with its own field row. */}
      <div className="DuelField-emptyZone" />
      {deckZones.map((zone, i) => {
        if (zone.kind === 'main' && mainDeck.length > 0) {
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={mainDeck.length}
              topCardInstanceId={mainDeckTopCardId}
              stackOffsetStepX={MAIN_DECK_STACK_OFFSET_STEP_X}
              stackOffsetStepY={MAIN_DECK_STACK_OFFSET_STEP_Y}
              stackMaxLayers={MAIN_DECK_STACK_MAX_LAYERS}
              onClick={onDrawCard}
              menuActions={MAIN_DECK_ACTIONS}
              onMenuAction={onMainDeckAction}
            />
          );
        }
        if (zone.kind === 'extra' && extraDeck.length > 0) {
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={extraDeck.length}
              stackOffsetStepX={EXTRA_DECK_STACK_OFFSET_STEP_X}
              stackOffsetStepY={EXTRA_DECK_STACK_OFFSET_STEP_Y}
              stackMaxLayers={EXTRA_DECK_STACK_MAX_LAYERS}
              menuActions={VIEW_ONLY_ACTIONS}
              onMenuAction={onViewExtraDeck ? () => onViewExtraDeck() : undefined}
            />
          );
        }
        if (zone.kind === 'spellTrap') {
          spellTrapSlotIndex += 1;
          const slotIndex = spellTrapSlotIndex;
          const placed = spellTrapZones[slotIndex] ?? undefined;
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={placed?.card}
              instanceId={placed?.instanceId}
              faceDown={placed?.faceDown}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={getPlacedCardActions(placed?.card, placed?.faceDown ?? false)}
              onMenuAction={
                placed && onFieldAction
                  ? (actionKey) => onFieldAction('spellTrap', slotIndex, actionKey)
                  : undefined
              }
            />
          );
        }
        return <FieldZone key={i} label={zone.label} />;
      })}
    </div>
  );

  return (
    <div className="DuelField-playerField">
      {flipped ? (
        <>
          {deckRow}
          {fieldRow}
        </>
      ) : (
        <>
          {fieldRow}
          {deckRow}
        </>
      )}
    </div>
  );
}

interface DuelFieldProps {
  playerMainDeck?: CardData[];
  playerExtraDeck?: CardData[];
  playerMainDeckTopCardId?: string;
  playerMonsterZones?: (PlacedCard | null)[];
  playerSpellTrapZones?: (PlacedCard | null)[];
  playerGrave?: CardData[];
  playerBanished?: CardData[];
  playerFieldZone?: PlacedCard | null;
  onDrawCard?: () => void;
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  onFieldAction?: (zoneType: 'monster' | 'spellTrap' | 'field', index: number, actionKey: string) => void;
  onMainDeckAction?: (actionKey: string) => void;
  onViewExtraDeck?: () => void;
  onViewGrave?: () => void;
  onViewBanished?: () => void;
}

function DuelField({
  playerMainDeck = [],
  playerExtraDeck = [],
  playerMainDeckTopCardId,
  playerMonsterZones = [],
  playerSpellTrapZones = [],
  playerGrave = [],
  playerBanished = [],
  playerFieldZone = null,
  onDrawCard,
  onCardHover,
  onCardHoverEnd,
  onFieldAction,
  onMainDeckAction,
  onViewExtraDeck,
  onViewGrave,
  onViewBanished,
}: DuelFieldProps) {
  return (
    <div className="DuelField">
      <PlayerField flipped />
      <div className="DuelField-centerLine" />
      <PlayerField
        mainDeck={playerMainDeck}
        extraDeck={playerExtraDeck}
        mainDeckTopCardId={playerMainDeckTopCardId}
        monsterZones={playerMonsterZones}
        spellTrapZones={playerSpellTrapZones}
        grave={playerGrave}
        banished={playerBanished}
        fieldZone={playerFieldZone}
        onDrawCard={onDrawCard}
        onCardHover={onCardHover}
        onCardHoverEnd={onCardHoverEnd}
        onFieldAction={onFieldAction}
        onMainDeckAction={onMainDeckAction}
        onViewExtraDeck={onViewExtraDeck}
        onViewGrave={onViewGrave}
        onViewBanished={onViewBanished}
      />
    </div>
  );
}

export default DuelField;
