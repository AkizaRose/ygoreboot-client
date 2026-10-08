// Per-column size of the background image drawn behind each duel field
// zone (see FieldZone.css's ::before) — width and height are set
// independently, in px, for each column. Same column numbering as
// columnGaps.ts (columns 0-8, left to right in the player's own unflipped
// view, shared by every row), and, like that file, DuelField.tsx looks
// each zone's column up here, so the board and its images stay in sync.
//
// What sits in each column:
//   0: Banished Zone (opponent's field row only)
//   1: Field Zone / Extra Deck (player)  —  Grave / Main Deck (opponent)
//   2-6: Monster Zones (field rows) / Spell/Trap Zones (deck rows — see
//        SPELL_TRAP_IMAGE_SIZE below)
//   7: Grave / Main Deck (player)  —  Field Zone / Extra Deck (opponent)
//   8: Banished Zone (player's field row only)
//
// Every image is centered on its 72x108 zone and may be larger than it
// (it's drawn outside the zone's own box, so it doesn't affect layout —
// column widths come from columnGaps.ts). To keep the zone just inside
// the image's own border and the artwork undistorted, size an image so
// that, at its scale, the border's inner edge is at least as big as the
// zone. For the current PNGs (border inner edge at x 16-240 of 256 and,
// for the tall 256x372 images, y 8-364; for the square 256x256 ones,
// y 12-243):
//   - square (Monster / Spell-Trap Zone):  120 x 120
//   - tall (Field / Grave / Banished / Extra Deck):  83 x 121
// Change a column's width/height freely if the art changes.
// Each image is drawn 1px smaller than the card on every side (TALL: 70x103
// vs the card's 72x105), so antialiasing / sub-pixel rounding of the
// scaled card art can't let a sliver of the zone image show at its edges.
const SQUARE: ZoneImageSize = { width: 103, height: 103 };
const TALL: ZoneImageSize = { width: 70, height: 103 };

export interface ZoneImageSize {
  width: number;
  height: number;
}

export const COLUMN_ZONE_IMAGE_SIZES: ZoneImageSize[] = [
  TALL, // 0
  TALL, // 1
  SQUARE, // 2
  SQUARE, // 3
  SQUARE, // 4
  SQUARE, // 5
  SQUARE, // 6
  TALL, // 7
  TALL, // 8
];

// Columns 1-7 hold zones with differently-shaped images: columns 2-6 hold
// Monster Zones (square image) in the field rows but Spell/Trap Zones
// (narrow image) in the deck rows, and columns 1 and 7 hold the Main Deck
// (narrow) alongside Grave/Field Zone/Extra Deck. A column's size can only
// suit one of them, so COLUMN_ZONE_IMAGE_SIZES above is what Monster
// Zones and the Field/Grave/Banished/Extra Deck zones use, and these two
// zone types are sized by their own settings instead.
export const SPELL_TRAP_IMAGE_SIZE: ZoneImageSize = TALL;
export const MAIN_DECK_IMAGE_SIZE: ZoneImageSize = TALL;
