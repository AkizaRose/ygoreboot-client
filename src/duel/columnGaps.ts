// Per-column gap control for the duel field grid (DuelField.tsx /
// DuelField.css / cardGeometry.ts all read from this one array, so they
// can never drift out of sync with each other).
//
// The board is a 9-column grid (columns 0-8, left to right in the
// player's own unflipped view) shared identically by every row — both
// players' field rows and deck rows all line up on the same 9 columns,
// which is what keeps Monster Zones stacked directly above/below
// Spell/Trap Zones. That leaves 8 gaps between neighbouring columns:
// COLUMN_GAPS[i] is the gap between column i and column i + 1.
//
// What sits in each column (same for every row):
//   0: leading empty cell (player's own field/deck rows) / Banished Zone
//      (opponent's field row only)
//   1: Field Zone / Grave / Extra Deck / Main Deck — never a Monster or
//      Spell/Trap Zone
//   2-6: ALWAYS a Monster Zone (field rows) or a Spell/Trap Zone (deck
//      rows) in every row that uses them
//   7: Grave / Field Zone / Main Deck / Extra Deck — never a Monster or
//      Spell/Trap Zone
//   8: Banished Zone (player's own field row only) / PhaseTracker /
//      TurnCounter
//
// So COLUMN_GAPS[0] (left of column 1) and COLUMN_GAPS[7] (right of
// column 7) are the two gaps that never sit next to a Monster/Spell-Trap
// Zone on either side — these are the "columns that don't contain
// horizontal zones" and are safe to shrink freely to save screen space.
//
// COLUMN_GAPS[1] through COLUMN_GAPS[6] all have a Monster Zone or
// Spell/Trap Zone on at least one side (often both) — FieldZone's
// rotated Defense Position overlay (see FieldZone.css) needs clearance
// on both sides of a zone like that, so keep these at 36 or higher.
// Shrinking them below that risks the rotated overlay of one zone
// visually clipping into its neighbor.
export const COLUMN_GAPS: number[] = [12, 20, 36, 36, 36, 36, 20, 12];
