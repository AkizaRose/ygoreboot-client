// Pixel geometry for every zone on the board. This is the "zones become
// coordinates, not components" half of the card-object-permanence
// refactor discussed alongside this file — FieldZone/Hand stop owning
// the card elements they used to render, and instead this module (plus
// cardPositions.ts) becomes the single source of truth for where every
// card actually sits.
//
// Every constant below is taken directly from the current DuelField.tsx/
// FieldZone.tsx/Hand.tsx/DuelField.css — not re-derived from scratch —
// specifically so a card animating between (say) Hand and the Monster
// Zone lands exactly where the existing, hand-tuned zone boxes already
// are, rather than drifting to a slightly different spot.

// --- Field zone box size (FieldZone.tsx) ---
export const ZONE_WIDTH = 72;
export const ZONE_HEIGHT = 105;

// --- Native card art size, and the two different scales it's shown at
// depending on where it is (FieldZone.tsx vs Hand.tsx) — a card genuinely
// changes size as it moves between them, so any animation between the
// two needs to interpolate `scale` too, not just x/y. ---
export const CARD_NATIVE_WIDTH = 813;
export const CARD_NATIVE_HEIGHT = 1185;
export const FIELD_CARD_SCALE = ZONE_WIDTH / CARD_NATIVE_WIDTH;
export const HAND_CARD_SCALE = 0.12;
const HAND_CELL_WIDTH = CARD_NATIVE_WIDTH * HAND_CARD_SCALE;
export const HAND_CELL_HEIGHT = CARD_NATIVE_HEIGHT * HAND_CARD_SCALE;

// --- Grid layout (DuelField.css's .DuelField-row) ---
const COLUMN_WIDTH = 72;
const COLUMN_GAP = 40;
const COLUMN_PITCH = COLUMN_WIDTH + COLUMN_GAP;
const ROW_GAP = 6; // .DuelField-playerField's own gap, between fieldRow/deckRow
const ROW_PITCH = ZONE_HEIGHT + ROW_GAP;
const SIDE_GAP = 24; // .DuelField's own gap, opponent block <-> centerLine <-> player block
const CENTER_LINE_HEIGHT = 1;

export type FieldZoneKind = 'field' | 'monster' | 'grave' | 'banished';
export type DeckZoneKind = 'extra' | 'spellTrap' | 'main';

// Same order as DuelField.tsx's own FIELD_ZONES/DECK_ZONES — deliberately
// duplicated rather than imported, so this module has no dependency on
// the rendering components at all (the whole point is that geometry and
// rendering become separate concerns).
const FIELD_ZONE_KINDS: FieldZoneKind[] = ['field', 'monster', 'monster', 'monster', 'grave', 'banished'];
const DECK_ZONE_KINDS: DeckZoneKind[] = ['extra', 'spellTrap', 'spellTrap', 'spellTrap', 'main'];

// Mirrors the exact column-building logic from DuelField.tsx's fieldRow/
// deckRow JSX: a leading empty cell (conditionally, for fieldRow), then
// the zone kinds in order — reversed for the opponent, to simulate the
// board as it'd look physically rotated 180° from their seat. Rather
// than re-deriving a general formula for "which column is zone kind X
// in," this just builds the same array DuelField.tsx builds and reads
// off column indices from it — the safest way to guarantee this module
// never quietly drifts out of sync with what's actually rendered.
function fieldRowColumns(flipped: boolean): FieldZoneKind[] {
  const kinds = flipped ? [...FIELD_ZONE_KINDS].reverse() : FIELD_ZONE_KINDS;
  return flipped ? kinds : ['__empty__' as FieldZoneKind, ...kinds];
}

function deckRowColumns(flipped: boolean): DeckZoneKind[] {
  const kinds = flipped ? [...DECK_ZONE_KINDS].reverse() : DECK_ZONE_KINDS;
  return ['__empty__' as DeckZoneKind, ...kinds];
}

// Returns the column index (0-based, left to right) of the nth zone of
// a given kind — e.g. findColumn(fieldRowColumns(false), 'monster', 1)
// is the player's own middle Monster Zone slot.
function findColumn<T extends string>(columns: T[], kind: T, occurrence: number): number {
  let seen = -1;
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] === kind) {
      seen += 1;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

// Row index within the whole board, top to bottom: opponent's deck row
// is furthest from the center line (see DuelField.tsx's `flipped ? (deckRow,
// fieldRow) : (fieldRow, deckRow)`), then opponent's field row, then the
// center line itself, then the player's field row, then the player's
// deck row.
// DuelField.css's own .DuelField rule has margin-top: 24px — the grid
// actually renders 24px below whatever contains it, not flush with its
// top edge. Baked in here (rather than removing the CSS margin) so the
// existing visual spacing above the board is preserved exactly as it
// was, while every computed position still lands where the grid
// actually is.
const DUEL_FIELD_MARGIN_TOP = 24;

function rowY(rowIndex: 0 | 1 | 2 | 3): number {
  const base = DUEL_FIELD_MARGIN_TOP;
  if (rowIndex <= 1) return base + rowIndex * ROW_PITCH;
  // NOT base + 2 * ROW_PITCH — that double-counts ROW_GAP. ROW_PITCH
  // already bundles one zone height with one gap (that's what makes
  // rowY(1) work correctly above: row 0's height + the ONE gap between
  // rows 0 and 1). But the opponent's whole two-row block is only
  // ZONE_HEIGHT + ROW_GAP + ZONE_HEIGHT — one gap total, not two — so
  // reusing rowY(1) (which already correctly accounts for that one gap)
  // and adding just one more ZONE_HEIGHT on top of it is what correctly
  // measures "the bottom edge of the opponent's whole block," with
  // nothing extra.
  const afterOpponent = rowY(1) + ZONE_HEIGHT + SIDE_GAP + CENTER_LINE_HEIGHT + SIDE_GAP;
  return afterOpponent + (rowIndex - 2) * ROW_PITCH;
}

// Total pixel height of DuelField's own grid (both players' 2 rows each,
// plus the center line and its surrounding gaps) — this is the shared
// origin everything below the field (Hand, the opponent's hand row) has
// to offset from, now that they're all being positioned in ONE
// coordinate space rather than three independently-centered page
// elements. See MultiplayerDuelFieldPage's own wrapping container for
// where this actually gets used.
export const BOARD_HEIGHT = rowY(3) + ZONE_HEIGHT;
// Total height needed for a wrapper containing both DuelField's grid AND
// Hand — see MultiplayerDuelFieldPage's own board-stage wrapper.
export const STAGE_HEIGHT = BOARD_HEIGHT + 8 + HAND_CELL_HEIGHT; // 8 = HAND_TOP_MARGIN below

export interface ZoneSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees. 180 for every opponent-side zone — see FieldZone's own rotated180. */
  rotated180: boolean;
}

// index is only meaningful for 'monster'/'spellTrap' (0/1/2, left to
// right in the OWNING player's own natural view, same convention
// DuelField.tsx already uses for onFieldAction's zoneType+index).
export function getFieldZoneSlot(
  flipped: boolean,
  kind: FieldZoneKind,
  index = 0,
): ZoneSlot {
  const columns = fieldRowColumns(flipped);
  const occurrence = kind === 'monster' ? index : 0;
  const col = findColumn(columns, kind, occurrence);
  const row = flipped ? 1 : 2;
  return {
    x: col * COLUMN_PITCH,
    y: rowY(row as 0 | 1 | 2 | 3),
    width: ZONE_WIDTH,
    height: ZONE_HEIGHT,
    rotated180: flipped,
  };
}

export function getDeckZoneSlot(flipped: boolean, kind: DeckZoneKind, index = 0): ZoneSlot {
  const columns = deckRowColumns(flipped);
  const occurrence = kind === 'spellTrap' ? index : 0;
  const col = findColumn(columns, kind, occurrence);
  const row = flipped ? 0 : 3;
  return {
    x: col * COLUMN_PITCH,
    y: rowY(row as 0 | 1 | 2 | 3),
    width: ZONE_WIDTH,
    height: ZONE_HEIGHT,
    rotated180: flipped,
  };
}

// --- Stack offsets, for cards buried in a pile (Monster Zone Fusion
// stacks, Grave, Banished) — exact values from DuelField.tsx. Layer 0 is
// the deepest/bottom card. ---
export const STACK_OFFSETS: Record<
  'monster' | 'grave' | 'banished' | 'mainDeck' | 'extraDeck',
  { stepX: number; stepY: number; maxLayers: number }
> = {
  monster: { stepX: 1.5, stepY: 1.5, maxLayers: 6 },
  grave: { stepX: 0.25, stepY: 0.25, maxLayers: 50 },
  banished: { stepX: 0.25, stepY: 0.25, maxLayers: 50 },
  mainDeck: { stepX: 0.25, stepY: 0.25, maxLayers: 40 },
  extraDeck: { stepX: -0.25, stepY: 0.25, maxLayers: 10 },
};

// Total pixel width of DuelField's own grid (7 columns) — Hand centers
// itself under this, same as the visual effect Hand.css's own
// `margin: 8px auto` currently achieves by being a separate,
// independently-centered page element.
export const BOARD_WIDTH = 6 * COLUMN_PITCH + COLUMN_WIDTH;
// Hand.css's own `margin: 8px auto` top margin, reproduced as a fixed
// offset now that Hand's vertical position is computed here instead of
// coming from being a normal-flow sibling below DuelField.
const HAND_TOP_MARGIN = 8;

// --- Hand layout (Hand.tsx's own overlap math, reproduced exactly) ---
// handCount is the CURRENT total size of the hand (needed to know
// whether overlap-shrinking kicks in), index is this card's position
// within it, left to right. Returns coordinates already in the SAME
// shared board space DuelField's own zones use (see BOARD_HEIGHT above)
// — not Hand's own local origin — since Hand and DuelField now need to
// agree on one shared (0,0) for a card animating between them to work
// at all.
export function getHandSlot(handCount: number, index: number): ZoneSlot {
  const maxVisible = 6;
  const gap = 4;
  const maxWidth = maxVisible * HAND_CELL_WIDTH + (maxVisible - 1) * gap;
  const normalAdvance = HAND_CELL_WIDTH + gap;
  const advance =
    handCount <= 1 || handCount <= maxVisible
      ? normalAdvance
      : (maxWidth - HAND_CELL_WIDTH) / (handCount - 1);
  const handWidth = handCount === 0 ? 0 : (handCount - 1) * advance + HAND_CELL_WIDTH;
  const handLeft = (BOARD_WIDTH - handWidth) / 2;
  return {
    x: handLeft + index * advance,
    y: BOARD_HEIGHT + HAND_TOP_MARGIN,
    width: HAND_CELL_WIDTH,
    height: HAND_CELL_HEIGHT,
    rotated180: false, // only the player's own hand is ever rendered face-up/readable like this
  };
}
