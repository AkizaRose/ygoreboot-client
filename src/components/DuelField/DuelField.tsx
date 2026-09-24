import type { CSSProperties } from 'react';
import FieldZone, { type FieldZoneAction } from './FieldZone';
import PhaseTracker from './PhaseTracker';
import TurnCounter from './TurnCounter';
import type { TurnPhase } from '../Matchmaking/useMultiplayerDuel';
import type { CardData } from '../../types/Card';
import type { CardInstance, PlacedCard } from '../../types/CardInstance';
import cardBackImg from '../../assets/card/CardBack.png';
import { PLAYER_STACK_OFFSETS, OPPONENT_STACK_OFFSETS, ZONE_WIDTH } from '../../duel/cardGeometry';
import { COLUMN_GAPS } from '../../duel/columnGaps';
import './DuelField.css';

// Every .DuelField-row below shares this same computed grid — each
// column is a fixed ZONE_WIDTH-wide track (matching FieldZone's own
// fixed size; see FieldZone.css), widened by that column's own gap from
// COLUMN_GAPS so each gap can be tuned independently instead of the grid
// applying one uniform `gap` to every column. The row itself gets
// `gap: 0`, and every FieldZone/emptyZone cell (which have a definite
// 72px width) naturally falls back to sitting flush at the START of its
// now-wider track, which is what leaves the extra width from
// COLUMN_GAPS[i] to show up as empty space to the RIGHT of column i
// instead — i.e. exactly where the gap between column i and i + 1
// belongs. The final (9th) column doesn't need a trailing gap, since
// there's no column after it.
const DUEL_FIELD_ROW_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: [...COLUMN_GAPS.map((gap) => `${ZONE_WIDTH + gap}px`), `${ZONE_WIDTH}px`].join(
    ' ',
  ),
  gap: 0,
};

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

const MOVE_ACTION: FieldZoneAction = { key: 'move', label: 'Move' };

// Announces "[Player] activated the effect of [card name]" in chat.
// Only ever offered for FACE-UP cards (see getPlacedCardActions below) —
// a face-down card's identity isn't public knowledge yet, so there's
// nothing to declare.
const DECLARE_ACTION: FieldZoneAction = { key: 'declare', label: 'Declare' };

function isExtraDeckMonster(card: CardData): boolean {
  return (
    card.cardClass === 'Monster' &&
    ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '')
  );
}

// includeMove defaults to true (Monster Zone, Spell/Trap Zone) —
// explicitly passed false for the Field Zone call site only, per Move
// being available for every zone type except Field Spells.
function getPlacedCardActions(
  card: CardData | undefined,
  faceDown: boolean,
  includeMove: boolean = true,
): FieldZoneAction[] {
  const base =
    card && isExtraDeckMonster(card)
      ? EXTRA_DECK_MONSTER_FIELD_ACTIONS
      : STANDARD_FIELD_CARD_ACTIONS;
  const withMove = includeMove ? [...base, MOVE_ACTION] : base;
  if (faceDown) {
    // No Declare here — a face-down card's identity isn't public yet.
    return [{ key: 'activate', label: 'Activate' }, ...withMove];
  }
  if (card && card.cardClass !== 'Monster') {
    return [{ key: 'set', label: 'Set' }, ...withMove, DECLARE_ACTION];
  }
  return [...withMove, DECLARE_ACTION];
}

// The pile count label used to sit at a fixed spot on the zone itself,
// regardless of how many cards were in the pile — fine for a small
// pile, but visibly off-center from the actual top card once a pile
// has enough layers to noticeably stagger away from the zone's own
// base position. This computes exactly how far the top card has
// drifted, using the SAME per-layer step/cap math stackEntries (in
// cardPositions.ts) uses to position the actual card objects — so the
// label tracks the real top card exactly, not an approximation of it.
function topCardOffset(
  count: number,
  flipped: boolean,
  kind: 'grave' | 'banished' | 'mainDeck' | 'extraDeck',
): { x: number; y: number } {
  const offsets = (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS)[kind];
  const visibleLayers = Math.min(count, offsets.maxLayers + 1);
  const topLayerIndex = Math.max(0, visibleLayers - 1);
  return { x: topLayerIndex * offsets.stepX, y: topLayerIndex * offsets.stepY };
}

// Main Deck keeps its own hover menu (View plus Shuffle/Mill/Banish
// Top/Reset) — Extra Deck's order is meaningful (matches the Deck
// Builder) and isn't meant to be randomized, so it, along with
// Grave/Banished, is viewed by clicking the zone directly instead of
// through a menu at all (see those zones' own onClick below).
const VIEW_ACTION: FieldZoneAction = { key: 'view', label: 'View' };

const MAIN_DECK_ACTIONS: FieldZoneAction[] = [
  VIEW_ACTION,
  { key: 'shuffle', label: 'Shuffle' },
  { key: 'mill', label: 'Mill' },
  { key: 'banishTop', label: 'Banish Top' },
  { key: 'reset', label: 'Reset' },
];

// Deliberately more visible than Grave/Banished's near-flat offset — a
// Fusion stack is realistically only ever a handful of cards deep, so a
// subtler offset (fine for piles that can grow into the dozens) would
// barely read as "there's more than one card here" at that scale.
const MONSTER_STACK_OFFSET_STEP_X = 1.5;
const MONSTER_STACK_OFFSET_STEP_Y = 1.5;
const MONSTER_STACK_MAX_LAYERS = 6;

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
  // The 5 Monster Zone / Spell-Trap Zone slots, left-to-right in the
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
  // Same idea again, for Ritual Summon (see the duel page's
  // pendingRitualSummon) — multi-select, same as Fusion's own above, not
  // single-select like Evolution's. Only covers the Monster Zone half of
  // Ritual's material selection — Ritual can also tribute from hand,
  // which has no FieldZone to hook a click into at all and is handled
  // separately (see CardLayer's own isSelectingRitualMaterial).
  isSelectingRitualMaterial?: boolean;
  selectedRitualZoneIndices?: number[];
  onToggleRitualZoneMaterial?: (index: number) => void;
  // currentPhase gates the Attack menu option below to the turn
  // player's own Battle Phase — only meaningful for the player's own
  // (non-flipped) side. isMyTurn is also read by the flipped side, for
  // the Attack Position/battle-phase highlighting further down.
  currentPhase?: TurnPhase | null;
  isMyTurn?: boolean;
  // Opens StatAdjustDialog for the given Monster Zone slot index — only
  // ever wired up for the player's own (non-flipped) side, same as
  // onFieldAction.
  onStatsAdjust?: (index: number) => void;
  // Purely visual "select this card" — unlike onStatsAdjust/
  // onFieldAction above, this is wired up on BOTH sides (see
  // DuelField's own two PlayerField calls), since a card on EITHER
  // player's field can be selected. Passed the instanceId of whichever
  // card was clicked.
  onSelectCard?: (instanceId: string) => void;
  // "Move" mode — only ever meaningful for the player's own (non-flipped)
  // side, same as onStatsAdjust/onFieldAction. True while a card is
  // waiting to be relocated (see MultiplayerDuelFieldPage's own
  // pendingMove); suppresses the normal hover menu the same way Fusion/
  // Evolution material selection already does, and switches an empty
  // Monster/Spell-Trap Zone's click into "move here" instead of nothing.
  isSelectingMoveDestination?: boolean;
  onMoveTarget?: (zoneType: 'monster' | 'spellTrap', index: number) => void;
  // The cross-field counterpart — meaningful on the OPPONENT's
  // (flipped) side specifically, unlike isSelectingMoveDestination/
  // onMoveTarget above which are the player's own side only. True only
  // while the card being moved is itself a Monster Zone card (Spell/
  // Trap cards never target the opponent's field at all), switching an
  // empty MONSTER Zone slot on the opponent's own side into a valid
  // "move here" target — their Spell/Trap Zone is never a valid
  // destination for this, per the feature as requested.
  isSelectingMoveToOpponentZone?: boolean;
  onMoveToOpponentTarget?: (index: number) => void;
  // "Equip target" mode — set while an Equip Spell is waiting on its
  // target monster (see MultiplayerDuelFieldPage's own pendingEquip). A
  // SINGLE shared pair, unlike Move's own split into own-field/
  // cross-field variants — an Equip Spell can target a monster on
  // EITHER player's field under the exact same rule (an occupied
  // Monster Zone slot), so this is passed identically to BOTH
  // PlayerField instances (see DuelField's own two calls below).
  // onEquipTarget is called with this PlayerField's own `flipped` value
  // (which side was actually clicked) alongside the slot index, since
  // PlayerField already knows that about itself — the caller (this
  // file's own DuelField) never needs to bind a separate closure per
  // side the way it does for Move's own cross-field handler.
  isSelectingEquipTarget?: boolean;
  onEquipTarget?: (flipped: boolean, index: number) => void;
  // "Attack target" mode — set while an attack is waiting on its target
  // monster (see MultiplayerDuelFieldPage's own pendingAttack). Unlike
  // isSelectingEquipTarget above, this is meaningful ONLY on the
  // OPPONENT's (flipped) side — you can only ever attack the opponent's
  // own monsters, never your own — so onAttackTarget takes just the
  // slot index, no flipped flag: DuelField's own two calls below pass
  // this prop only to the flipped PlayerField instance, never the
  // player's own. Only ever offered for an OCCUPIED Monster Zone slot,
  // same as Equip target.
  isSelectingAttackTarget?: boolean;
  onAttackTarget?: (index: number) => void;
  // Reports whichever Monster/Spell-Trap Zone card (either side) is
  // currently hovered, or null when nothing is — resolved here from
  // FieldZone's own plain onHoverChange boolean against whatever
  // instanceId this call site already knows for that slot (see each
  // <FieldZone>'s own onHoverChange below). Drives the Equip Spell
  // hover-overlay specifically (see CardLayer's own
  // equipOverlayInstanceId, computed in MultiplayerDuelFieldPage from
  // this) — nothing else needs zone-level hover identity yet.
  onFieldInstanceHoverChange?: (instanceId: string | null) => void;
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
  isSelectingRitualMaterial = false,
  selectedRitualZoneIndices = [],
  onToggleRitualZoneMaterial,
  currentPhase,
  isMyTurn = false,
  onStatsAdjust,
  onSelectCard,
  isSelectingMoveDestination = false,
  onMoveTarget,
  isSelectingMoveToOpponentZone = false,
  onMoveToOpponentTarget,
  isSelectingEquipTarget = false,
  onEquipTarget,
  isSelectingAttackTarget = false,
  onAttackTarget,
  onFieldInstanceHoverChange,
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
    <div className="DuelField-row" style={DUEL_FIELD_ROW_GRID_STYLE}>
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
              menuActions={
                flipped
                  ? []
                  : getPlacedCardActions(fieldZone?.card, fieldZone?.faceDown ?? false, false)
              }
              onMenuAction={
                fieldZone && onFieldAction
                  ? (actionKey) => onFieldAction('field', 0, actionKey)
                  : undefined
              }
              onClick={
                fieldZone && onSelectCard ? () => onSelectCard(fieldZone.instanceId) : undefined
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
          //
          // For the opponent (flipped), monsterSlotIndex counts left to
          // right in DISPLAY order, but monsterZones' own array index is
          // always the OPPONENT's own left-to-right order, from their
          // own seat — reversed relative to how it displays here. Not
          // reversing this would put the opponent's own slot 0 (adjacent
          // to THEIR Field Zone) on screen next to Grave instead —
          // exactly backwards from what physically rotating their field
          // 180° should produce. Same reasoning as cardGeometry.ts's own
          // getFieldZoneSlot, which needs the identical fix for the card
          // objects themselves to land in the same boxes these render.
          const slotIndex = flipped ? 4 - monsterSlotIndex : monsterSlotIndex;
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
          // Only for a face-up monster currently in Attack Position,
          // during the TURN PLAYER's own Battle Phase — currentPhase and
          // isMyTurn are only ever meaningfully passed for the player's
          // own (non-flipped) side in the first place (see
          // PlayerFieldProps' own docs), so this never shows for the
          // opponent's monsters regardless.
          const attackAction: FieldZoneAction[] =
            placed &&
            !placed.faceDown &&
            placed.position !== 'defense' &&
            currentPhase === 'battle' &&
            isMyTurn
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
          // Every special-selection mode suppresses the normal hover
          // menu the same way — they're mutually exclusive in practice
          // (never more than one pending at once), but combining the
          // check here means this zone doesn't care which one it is,
          // only whether some selection is in progress at all.
          const isInSelectionMode =
            isSelectingFusionMaterial ||
            isSelectingEvolutionMaterial ||
            isSelectingRitualMaterial ||
            isSelectingMoveDestination ||
            isSelectingEquipTarget ||
            isSelectingAttackTarget;

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
              onHoverChange={(hovering) =>
                onFieldInstanceHoverChange?.(hovering ? (placed?.instanceId ?? null) : null)
              }
              menuActions={
                flipped
                  ? viewStackAction
                  : isInSelectionMode
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
                  : placed && onFieldAction && !isInSelectionMode
                    ? (actionKey) => onFieldAction('monster', slotIndex, actionKey)
                    : undefined
              }
              onClick={
                isSelectingFusionMaterial && placed && onToggleMaterialSelection
                  ? () => onToggleMaterialSelection(slotIndex)
                  : isSelectingEvolutionMaterial && placed && onSelectEvolutionMaterial
                    ? () => onSelectEvolutionMaterial(slotIndex)
                    : isSelectingRitualMaterial && placed && onToggleRitualZoneMaterial
                      ? () => onToggleRitualZoneMaterial(slotIndex)
                      : isSelectingMoveDestination && !placed && onMoveTarget
                        ? () => onMoveTarget('monster', slotIndex)
                        : isSelectingMoveToOpponentZone && !placed && onMoveToOpponentTarget
                          ? () => onMoveToOpponentTarget(slotIndex)
                          : isSelectingEquipTarget && placed && onEquipTarget
                            ? () => onEquipTarget(flipped, slotIndex)
                            : isSelectingAttackTarget && flipped && placed && onAttackTarget
                              ? () => onAttackTarget(slotIndex)
                              : placed && onSelectCard
                                ? () => onSelectCard(placed.instanceId)
                                : undefined
              }
              selected={
                (isSelectingFusionMaterial && selectedMaterialIndices.includes(slotIndex)) ||
                (isSelectingRitualMaterial && selectedRitualZoneIndices.includes(slotIndex))
              }
              showRotatedOverlay
              showStats
              atkOverride={placed?.atkOverride}
              defOverride={placed?.defOverride}
              onStatsClick={
                !flipped && placed && !isInSelectionMode && onStatsAdjust
                  ? () => onStatsAdjust(slotIndex)
                  : undefined
              }
            />
          );
        }
        if (zone.kind === 'grave') {
          const graveVisibleCount = Math.min(
            grave.length,
            (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS).grave.maxLayers + 1,
          );
          const graveStackCards = grave.slice(grave.length - graveVisibleCount);
          const topCard = grave.length > 0 ? grave[grave.length - 1] : undefined;
          const graveOffset = topCardOffset(grave.length, flipped, 'grave');
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard?.card}
              instanceId={topCard?.instanceId}
              stackCards={graveStackCards}
              count={grave.length > 0 ? grave.length : undefined}
              pileCountOffsetX={graveOffset.x}
              pileCountOffsetY={graveOffset.y}
              rotated180={flipped}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              onClick={
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
          const banishedVisibleCount = Math.min(
            banished.length,
            (flipped ? OPPONENT_STACK_OFFSETS : PLAYER_STACK_OFFSETS).banished.maxLayers + 1,
          );
          const banishedStackCards = banished.slice(banished.length - banishedVisibleCount);
          const topCard = banished.length > 0 ? banished[banished.length - 1] : undefined;
          const banishedOffset = topCardOffset(banished.length, flipped, 'banished');
          return (
            <FieldZone
              key={i}
              label={zone.label}
              card={topCard?.card}
              instanceId={topCard?.instanceId}
              stackCards={banishedStackCards}
              count={banished.length > 0 ? banished.length : undefined}
              pileCountOffsetX={banishedOffset.x}
              pileCountOffsetY={banishedOffset.y}
              rotated180={flipped}
              onCardHover={onCardHover}
              onCardHoverEnd={onCardHoverEnd}
              onClick={
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
    <div className="DuelField-row" style={DUEL_FIELD_ROW_GRID_STYLE}>
      {/* Both sides get exactly one leading empty cell here, for two
          different reasons that happen to need the same fix: the
          opponent's deck row needs it to align with its own (unshifted)
          field row above it, while the player's deck row needs it to
          stay shifted in step with its own field row. */}
      <div className="DuelField-emptyZone" />
      {deckZones.map((zone, i) => {
        if (zone.kind === 'main' && resolvedMainDeckCount > 0) {
          const mainDeckOffset = topCardOffset(resolvedMainDeckCount, flipped, 'mainDeck');
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={resolvedMainDeckCount}
              pileCountOffsetX={mainDeckOffset.x}
              pileCountOffsetY={mainDeckOffset.y}
              onClick={flipped ? undefined : onDrawCard}
              menuActions={flipped ? [] : MAIN_DECK_ACTIONS}
              onMenuAction={flipped ? undefined : onMainDeckAction}
            />
          );
        }
        if (zone.kind === 'extra' && resolvedExtraDeckCount > 0) {
          const extraDeckOffset = topCardOffset(resolvedExtraDeckCount, flipped, 'extraDeck');
          return (
            <FieldZone
              key={i}
              label={zone.label}
              image={cardBackImg}
              count={resolvedExtraDeckCount}
              pileCountOffsetX={extraDeckOffset.x}
              pileCountOffsetY={extraDeckOffset.y}
              onClick={!flipped && onViewExtraDeck ? () => onViewExtraDeck() : undefined}
            />
          );
        }
        if (zone.kind === 'spellTrap') {
          spellTrapSlotIndex += 1;
          // Same reasoning as monsterSlotIndex's own fix above.
          const slotIndex = flipped ? 4 - spellTrapSlotIndex : spellTrapSlotIndex;
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
              onHoverChange={(hovering) =>
                onFieldInstanceHoverChange?.(hovering ? (placed?.instanceId ?? null) : null)
              }
              menuActions={
                flipped || isSelectingMoveDestination
                  ? []
                  : getPlacedCardActions(placed?.card, placed?.faceDown ?? false)
              }
              onMenuAction={
                !flipped && placed && onFieldAction && !isSelectingMoveDestination
                  ? (actionKey) => onFieldAction('spellTrap', slotIndex, actionKey)
                  : undefined
              }
              onClick={
                isSelectingMoveDestination && !placed && onMoveTarget
                  ? () => onMoveTarget('spellTrap', slotIndex)
                  : placed && onSelectCard
                    ? () => onSelectCard(placed.instanceId)
                    : undefined
              }
            />
          );
        }
        return <FieldZone key={i} label={zone.label} />;
      })}
      {/* The one genuinely unoccupied cell left in the whole grid: this
          row's own leading empty cell (above) plus DECK_ZONES' 7 entries
          only ever fill columns 0-7, leaving this 9th/last column
          (directly beneath this player's own Banished Zone — fieldRow's
          own last column — and to the right of their Main Deck,
          DECK_ZONES' own last entry) with nothing ever rendered into it.
          Used to hold the Die Roll/Coin Flip buttons — those moved into
          the hand button grid (see MultiplayerDuelFieldPage.tsx) — so
          this is now just a plain spacer, same as the opponent's own
          deckRow always had here. */}
      {!flipped && <div className="DuelField-emptyZone" />}
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
  isSelectingRitualMaterial?: boolean;
  selectedRitualZoneIndices?: number[];
  onToggleRitualZoneMaterial?: (index: number) => void;
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
  // Phase Tracker — see PhaseTracker.tsx for the component itself.
  // currentPhase/turnEnding/isMyTurn are also what gates the Attack
  // menu option below (only shown during the turn player's own Battle
  // Phase), not just what the tracker itself displays.
  currentPhase?: TurnPhase | null;
  turnEnding?: boolean;
  isMyTurn?: boolean;
  turnNumber?: number;
  onPrevPhase?: () => void;
  onNextPhase?: () => void;
  onStartTurn?: () => void;
  // Only ever meaningful for the player's own side — see
  // PlayerFieldProps' own copy of this same prop.
  onStatsAdjust?: (index: number) => void;
  // Meaningful for BOTH sides — see PlayerFieldProps' own copy.
  onSelectCard?: (instanceId: string) => void;
  // Only ever meaningful for the player's own side — see
  // PlayerFieldProps' own copy of these two.
  isSelectingMoveDestination?: boolean;
  onMoveTarget?: (zoneType: 'monster' | 'spellTrap', index: number) => void;
  // Meaningful on the OPPONENT's side — see PlayerFieldProps' own copy.
  isSelectingMoveToOpponentZone?: boolean;
  onMoveToOpponentTarget?: (index: number) => void;
  // Passed identically to BOTH PlayerField instances — see
  // PlayerFieldProps' own copy of these two for the full reasoning.
  isSelectingEquipTarget?: boolean;
  onEquipTarget?: (flipped: boolean, index: number) => void;
  // Passed only to the flipped (opponent) PlayerField instance below —
  // see PlayerFieldProps' own copy for the full reasoning.
  isSelectingAttackTarget?: boolean;
  onAttackTarget?: (index: number) => void;
  // See PlayerFieldProps' own copy for the full reasoning.
  onFieldInstanceHoverChange?: (instanceId: string | null) => void;
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
  isSelectingRitualMaterial,
  selectedRitualZoneIndices,
  onToggleRitualZoneMaterial,
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
  currentPhase,
  turnEnding = false,
  isMyTurn = false,
  turnNumber,
  onPrevPhase,
  onNextPhase,
  onStartTurn,
  onStatsAdjust,
  onSelectCard,
  isSelectingMoveDestination = false,
  onMoveTarget,
  isSelectingMoveToOpponentZone = false,
  onMoveToOpponentTarget,
  isSelectingEquipTarget = false,
  onEquipTarget,
  isSelectingAttackTarget = false,
  onAttackTarget,
  onFieldInstanceHoverChange,
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
        onSelectCard={onSelectCard}
        isSelectingMoveToOpponentZone={isSelectingMoveToOpponentZone}
        onMoveToOpponentTarget={onMoveToOpponentTarget}
        isSelectingEquipTarget={isSelectingEquipTarget}
        onEquipTarget={onEquipTarget}
        isSelectingAttackTarget={isSelectingAttackTarget}
        onAttackTarget={onAttackTarget}
        onFieldInstanceHoverChange={onFieldInstanceHoverChange}
        isMyTurn={isMyTurn}
      />
      {/* Same 9-column grid as every zone row (.DuelField-row) — the
          tracker itself sits at grid-column: 9 (see PhaseTracker.css),
          the same column Banished Zone occupies in the player's own row
          below, so it lines up directly above it without needing its
          own separate coordinate system. TurnCounter shares this row too
          now, at grid-column: 1 — the opponent's own Banished Zone
          column, one row up in fieldRow above (see TurnCounter.css).
          Only rendered once currentPhase/turnNumber are actually known
          (briefly null while the duel doc's first snapshot is still in
          flight) — an empty row still reserves the same vertical space
          either way, so nothing shifts once either does appear. */}
      <div className="DuelField-row DuelField-phaseTrackerRow" style={DUEL_FIELD_ROW_GRID_STYLE}>
        {turnNumber !== undefined && (
          <TurnCounter turnNumber={turnNumber} isMyTurn={isMyTurn} />
        )}
        {currentPhase && (
          <PhaseTracker
            currentPhase={currentPhase}
            turnEnding={turnEnding}
            isMyTurn={isMyTurn}
            onPrevPhase={onPrevPhase ?? (() => {})}
            onNextPhase={onNextPhase ?? (() => {})}
            onStartTurn={onStartTurn ?? (() => {})}
          />
        )}
      </div>
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
        currentPhase={currentPhase}
        isMyTurn={isMyTurn}
        onStatsAdjust={onStatsAdjust}
        onSelectCard={onSelectCard}
        isSelectingMoveDestination={isSelectingMoveDestination}
        onMoveTarget={onMoveTarget}
        isSelectingEquipTarget={isSelectingEquipTarget}
        onEquipTarget={onEquipTarget}
        onFieldInstanceHoverChange={onFieldInstanceHoverChange}
        onFieldAction={onFieldAction}
        onMainDeckAction={onMainDeckAction}
        onViewExtraDeck={onViewExtraDeck}
        isSelectingFusionMaterial={isSelectingFusionMaterial}
        selectedMaterialIndices={selectedMaterialIndices}
        onToggleMaterialSelection={onToggleMaterialSelection}
        isSelectingEvolutionMaterial={isSelectingEvolutionMaterial}
        onSelectEvolutionMaterial={onSelectEvolutionMaterial}
        isSelectingRitualMaterial={isSelectingRitualMaterial}
        selectedRitualZoneIndices={selectedRitualZoneIndices}
        onToggleRitualZoneMaterial={onToggleRitualZoneMaterial}
        onViewGrave={onViewGrave}
        onViewBanished={onViewBanished}
      />
    </div>
  );
}

export default DuelField;