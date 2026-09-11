import FieldZone, { type FieldZoneAction } from './FieldZone';
import type { CardData } from '../../types/Card';
import type { CardInstance, PlacedCard } from '../../types/CardInstance';
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
  { key: 'stackTop', label: 'To T. Deck' },
  { key: 'stackBottom', label: 'To B. Deck' },
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
// Symmetrically, a face-up Spell/Trap/Field Spell gets a "Set" option
// that flips it back face-down — but never Monster Zone cards, since
// there's no Set Monster yet.
function getPlacedCardActions(card: CardData | undefined, faceDown: boolean): FieldZoneAction[] {
  const base =
    card && isExtraDeckMonster(card)
      ? EXTRA_DECK_MONSTER_FIELD_ACTIONS
      : STANDARD_FIELD_CARD_ACTIONS;
  if (faceDown) {
    return [{ key: 'activate', label: 'Activate' }, ...base];
  }
  if (card && card.cardClass !== 'Monster') {
    return [{ key: 'set', label: 'Set' }, ...base];
  }
  return base;
}

// Main Deck and Extra Deck share "View", but only Main Deck gets Shuffle
// — Extra Deck's order is meaningful (matches the Deck Builder) and
// isn't meant to be randomized. Grave/Banished also stay view-only.
const VIEW_ACTION: FieldZoneAction = { key: 'view', label: 'View' };
const VIEW_ONLY_ACTIONS: FieldZoneAction[] = [VIEW_ACTION];

const MAIN_DECK_ACTIONS: FieldZoneAction[] = [
  VIEW_ACTION,
  { key: 'shuffle', label: 'Shuffle' },
  { key: 'mill', label: 'Mill' },
  { key: 'banishTop', label: 'Banish Top' },
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

// Deliberately more visible than Grave/Banished's near-flat offset — a
// Fusion stack is realistically only ever a handful of cards deep, so a
// subtler offset (fine for piles that can grow into the dozens) would
// barely read as "there's more than one card here" at that scale.
const MONSTER_STACK_OFFSET_STEP_X = 1.5;
const MONSTER_STACK_OFFSET_STEP_Y = 1.5;
const MONSTER_STACK_MAX_LAYERS = 6;
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
  // Used INSTEAD of mainDeck/extraDeck's own .length when provided — the
  // opponent's deck pile only ever has a COUNT available in the first
  // place (their actual card contents are deliberately never sent to
  // this client at all — see useMultiplayerDuel), so there's nothing
  // real to put in a CardData[] for that side.
  mainDeckCount?: number;
  extraDeckCount?: number;
  // The 3 Monster Zone / Spell-Trap Zone slots, left-to-right in the
  // player's own (unreversed) view — index 0 is the leftmost. Only ever
  // passed for the player's side for now.
  monsterZones?: (PlacedCard | null)[];
  spellTrapZones?: (PlacedCard | null)[];
  // Grave/Banished piles — shown face-up (top card + count), unlike the
  // face-down Main/Extra Deck piles, since these aren't secret zones.
  // CardInstance (not just CardData), unlike the Main/Extra Deck props
  // above — the top card here needs a real instanceId (used as its React
  // key), unlike the deck piles' generic pile image.
  grave?: CardInstance[];
  banished?: CardInstance[];
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
  // Separate from onViewGrave/onViewBanished above — those open the
  // player's OWN Grave/Banished (with per-card actions); these open the
  // OPPONENT's, which the player can look through but never act on. Only
  // ever meaningful when flipped is true.
  onViewOpponentGrave?: () => void;
  onViewOpponentBanished?: () => void;
  // Same idea, for an opponent Monster Zone stack's contents — the only
  // "menu action" a flipped zone ever offers at all (see the monster
  // zone rendering below), since everything else there is
  // player-interaction-only.
  onViewOpponentStack?: (index: number) => void;
  // True while a Fusion Summon's material-selection step is in progress
  // (see the duel page's pendingFusionSummon) — while set, Monster Zone
  // hover menus are suppressed here in favor of a direct, multi-select
  // "click monsters to use as Fusion Material" interaction: every
  // OCCUPIED Monster Zone slot becomes clickable via
  // onToggleMaterialSelection instead, toggling that slot in or out of
  // selectedMaterialIndices rather than acting on it directly.
  isSelectingFusionMaterial?: boolean;
  selectedMaterialIndices?: number[];
  onToggleMaterialSelection?: (index: number) => void;
  // Same idea, for Evolution Summon (see the duel page's
  // pendingEvolutionSummon) — but single-select: exactly one material is
  // ever needed, so a click on it completes the selection immediately
  // via onSelectEvolutionMaterial rather than accumulating into a list
  // the player then has to separately confirm.
  isSelectingEvolutionMaterial?: boolean;
  onSelectEvolutionMaterial?: (index: number) => void;
}

function PlayerField({
  flipped = false,
  mainDeck = [],
  extraDeck = [],
  mainDeckCount,
  extraDeckCount,
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
  onViewOpponentGrave,
  onViewOpponentBanished,
  onViewOpponentStack,
  isSelectingFusionMaterial = false,
  selectedMaterialIndices = [],
  onToggleMaterialSelection,
  isSelectingEvolutionMaterial = false,
  onSelectEvolutionMaterial,
}: PlayerFieldProps) {
  const fieldZones = flipped ? [...FIELD_ZONES].reverse() : FIELD_ZONES;
  const deckZones = flipped ? [...DECK_ZONES].reverse() : DECK_ZONES;
  // mainDeckCount/extraDeckCount (opponent) take priority over the
  // array's own .length (player) when explicitly provided — see the
  // props' own documentation for why the opponent only ever has a count
  // in the first place, never real card data.
  const resolvedMainDeckCount = mainDeckCount ?? mainDeck.length;
  const resolvedExtraDeckCount = extraDeckCount ?? extraDeck.length;

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
              rotated180={flipped}
              onCardHover={flipped && fieldZone?.faceDown ? undefined : onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={flipped ? [] : getPlacedCardActions(fieldZone?.card, fieldZone?.faceDown ?? false)}
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
          // Only for a face-up monster currently in Attack Position — no
          // Battle Phase concept exists yet, so this doesn't gate on one.
          const attackAction: FieldZoneAction[] =
            placed && !placed.faceDown && placed.position !== 'defense'
              ? [{ key: 'attack', label: 'Attack' }]
              : [];
          // Only for genuine stacks (created via Fusion Summon) — a lone
          // monster has nothing extra for View to reveal.
          const viewStackAction: FieldZoneAction[] =
            placed?.stackedBelow && placed.stackedBelow.length > 0 ? [VIEW_ACTION] : [];

          // Everything buried beneath the active top card, oldest
          // (deepest) first, with the top card itself appended last —
          // matches Grave/Banished's own stackCards convention exactly
          // (last entry is the actual top of the pile), so the same
          // rendering path already built for those is reused here
          // unchanged, just with a persistent battle-position rotation
          // layered on via stackBattlePosition below (see FieldZone).
          const stackCards: CardInstance[] | undefined =
            placed?.stackedBelow && placed.stackedBelow.length > 0
              ? [...placed.stackedBelow, { instanceId: placed.instanceId, card: placed.card }]
              : undefined;

          // Either material-selection mode suppresses the normal hover
          // menu the same way — they're mutually exclusive in practice
          // (never both pending at once), but combining the check here
          // means this zone doesn't care which one it is, only whether
          // some selection is in progress at all.
          const isSelectingMaterial = isSelectingFusionMaterial || isSelectingEvolutionMaterial;

          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={placed?.card}
              instanceId={placed?.instanceId}
              stackCards={stackCards}
              stackOffsetStepX={MONSTER_STACK_OFFSET_STEP_X}
              stackOffsetStepY={MONSTER_STACK_OFFSET_STEP_Y}
              stackMaxLayers={MONSTER_STACK_MAX_LAYERS}
              faceDown={placed?.faceDown}
              battlePosition={placed?.position}
              stackBattlePosition={stackCards ? (placed?.position ?? 'attack') : undefined}
              rotated180={flipped}
              onCardHover={flipped && placed?.faceDown ? undefined : onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={
                flipped
                  ? viewStackAction
                  : isSelectingMaterial
                    ? []
                    : [
                        ...attackAction,
                        ...viewStackAction,
                        ...getPlacedCardActions(placed?.card, placed?.faceDown ?? false),
                        ...positionAction,
                      ]
              }
              onMenuAction={
                flipped
                  ? placed && onViewOpponentStack
                    ? (actionKey) => {
                        if (actionKey === 'view') onViewOpponentStack(slotIndex);
                      }
                    : undefined
                  : placed && onFieldAction && !isSelectingMaterial
                    ? (actionKey) => onFieldAction('monster', slotIndex, actionKey)
                    : undefined
              }
              onClick={
                isSelectingFusionMaterial && placed && onToggleMaterialSelection
                  ? () => onToggleMaterialSelection(slotIndex)
                  : isSelectingEvolutionMaterial && placed && onSelectEvolutionMaterial
                    ? () => onSelectEvolutionMaterial(slotIndex)
                    : undefined
              }
              selected={isSelectingFusionMaterial && selectedMaterialIndices.includes(slotIndex)}
              showRotatedOverlay
            />
          );
        }
        if (zone.kind === 'grave') {
          const graveVisibleCount = Math.min(grave.length, GRAVE_STACK_MAX_LAYERS + 1);
          const graveStackCards = grave.slice(grave.length - graveVisibleCount);
          const topCard = grave.length > 0 ? grave[grave.length - 1] : undefined;
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard?.card}
              instanceId={topCard?.instanceId}
              stackCards={graveStackCards}
              count={grave.length > 0 ? grave.length : undefined}
              stackOffsetStepX={GRAVE_STACK_OFFSET_STEP_X}
              stackOffsetStepY={GRAVE_STACK_OFFSET_STEP_Y}
              stackMaxLayers={GRAVE_STACK_MAX_LAYERS}
              rotated180={flipped}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={VIEW_ONLY_ACTIONS}
              onMenuAction={
                flipped
                  ? onViewOpponentGrave
                    ? () => onViewOpponentGrave()
                    : undefined
                  : onViewGrave
                    ? () => onViewGrave()
                    : undefined
              }
            />
          );
        }
        if (zone.kind === 'banished') {
          const banishedVisibleCount = Math.min(banished.length, BANISHED_STACK_MAX_LAYERS + 1);
          const banishedStackCards = banished.slice(banished.length - banishedVisibleCount);
          const topCard = banished.length > 0 ? banished[banished.length - 1] : undefined;
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard?.card}
              instanceId={topCard?.instanceId}
              stackCards={banishedStackCards}
              count={banished.length > 0 ? banished.length : undefined}
              stackOffsetStepX={BANISHED_STACK_OFFSET_STEP_X}
              stackOffsetStepY={BANISHED_STACK_OFFSET_STEP_Y}
              stackMaxLayers={BANISHED_STACK_MAX_LAYERS}
              rotated180={flipped}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={VIEW_ONLY_ACTIONS}
              onMenuAction={
                flipped
                  ? onViewOpponentBanished
                    ? () => onViewOpponentBanished()
                    : undefined
                  : onViewBanished
                    ? () => onViewBanished()
                    : undefined
              }
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
        if (zone.kind === 'main' && resolvedMainDeckCount > 0) {
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={resolvedMainDeckCount}
              stackOffsetStepX={MAIN_DECK_STACK_OFFSET_STEP_X}
              stackOffsetStepY={MAIN_DECK_STACK_OFFSET_STEP_Y}
              stackMaxLayers={MAIN_DECK_STACK_MAX_LAYERS}
              onClick={flipped ? undefined : onDrawCard}
              menuActions={flipped ? [] : MAIN_DECK_ACTIONS}
              onMenuAction={flipped ? undefined : onMainDeckAction}
            />
          );
        }
        if (zone.kind === 'extra' && resolvedExtraDeckCount > 0) {
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={resolvedExtraDeckCount}
              stackOffsetStepX={EXTRA_DECK_STACK_OFFSET_STEP_X}
              stackOffsetStepY={EXTRA_DECK_STACK_OFFSET_STEP_Y}
              stackMaxLayers={EXTRA_DECK_STACK_MAX_LAYERS}
              menuActions={flipped ? [] : VIEW_ONLY_ACTIONS}
              onMenuAction={!flipped && onViewExtraDeck ? () => onViewExtraDeck() : undefined}
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
              rotated180={flipped}
              onCardHover={flipped && placed?.faceDown ? undefined : onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              menuActions={flipped ? [] : getPlacedCardActions(placed?.card, placed?.faceDown ?? false)}
              onMenuAction={
                !flipped && placed && onFieldAction
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
  playerMonsterZones?: (PlacedCard | null)[];
  playerSpellTrapZones?: (PlacedCard | null)[];
  playerGrave?: CardInstance[];
  playerBanished?: CardInstance[];
  playerFieldZone?: PlacedCard | null;
  onDrawCard?: () => void;
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  onFieldAction?: (zoneType: 'monster' | 'spellTrap' | 'field', index: number, actionKey: string) => void;
  onMainDeckAction?: (actionKey: string) => void;
  onViewExtraDeck?: () => void;
  onViewGrave?: () => void;
  onViewBanished?: () => void;
  isSelectingFusionMaterial?: boolean;
  selectedMaterialIndices?: number[];
  onToggleMaterialSelection?: (index: number) => void;
  isSelectingEvolutionMaterial?: boolean;
  onSelectEvolutionMaterial?: (index: number) => void;
  // The opponent's side — deliberately a much smaller set of props than
  // the player's own side gets above. No mainDeck/extraDeck arrays (only
  // ever a count — see PlayerFieldProps), no per-card action wiring at
  // all for monster/spellTrap/field zones (read-only, hover-for-face-up
  // only), and no drawing or deck viewing. Grave/Banished are the one
  // exception: viewable (read-only) via their own dedicated callbacks,
  // same as the player's own, just pointed at a different (also
  // read-only) viewer.
  opponentMainDeckCount?: number;
  opponentExtraDeckCount?: number;
  opponentMonsterZones?: (PlacedCard | null)[];
  opponentSpellTrapZones?: (PlacedCard | null)[];
  opponentGrave?: CardInstance[];
  opponentBanished?: CardInstance[];
  opponentFieldZone?: PlacedCard | null;
  onViewOpponentGrave?: () => void;
  onViewOpponentBanished?: () => void;
  onViewOpponentStack?: (index: number) => void;
}

function DuelField({
  playerMainDeck = [],
  playerExtraDeck = [],
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
  isSelectingFusionMaterial,
  selectedMaterialIndices,
  onToggleMaterialSelection,
  isSelectingEvolutionMaterial,
  onSelectEvolutionMaterial,
  opponentMainDeckCount,
  opponentExtraDeckCount,
  opponentMonsterZones = [],
  opponentSpellTrapZones = [],
  opponentGrave = [],
  opponentBanished = [],
  opponentFieldZone = null,
  onViewOpponentGrave,
  onViewOpponentBanished,
  onViewOpponentStack,
}: DuelFieldProps) {
  return (
    <div className="DuelField">
      <PlayerField
        flipped
        mainDeckCount={opponentMainDeckCount}
        extraDeckCount={opponentExtraDeckCount}
        monsterZones={opponentMonsterZones}
        spellTrapZones={opponentSpellTrapZones}
        grave={opponentGrave}
        banished={opponentBanished}
        fieldZone={opponentFieldZone}
        onCardHover={onCardHover}
        onCardHoverEnd={onCardHoverEnd}
        onViewOpponentGrave={onViewOpponentGrave}
        onViewOpponentBanished={onViewOpponentBanished}
        onViewOpponentStack={onViewOpponentStack}
      />
      <div className="DuelField-centerLine" />
      <PlayerField
        mainDeck={playerMainDeck}
        extraDeck={playerExtraDeck}
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
        isSelectingFusionMaterial={isSelectingFusionMaterial}
        selectedMaterialIndices={selectedMaterialIndices}
        onToggleMaterialSelection={onToggleMaterialSelection}
        isSelectingEvolutionMaterial={isSelectingEvolutionMaterial}
        onSelectEvolutionMaterial={onSelectEvolutionMaterial}
        onViewGrave={onViewGrave}
        onViewBanished={onViewBanished}
      />
    </div>
  );
}

export default DuelField;
