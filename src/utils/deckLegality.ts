import cardData from '../data/carddata.json';
import type { CardData } from '../types/Card';
import type { SavedDeck } from '../components/DeckManager/useSavedDecks';
import {
  MAIN_DECK_SIZE as MAIN_DECK_MAX,
  EXTRA_DECK_SIZE as EXTRA_DECK_MAX,
  SIDE_DECK_SIZE as SIDE_DECK_MAX,
  MAX_COPIES,
  MAX_LEGEND_COPIES,
  MAX_LEGEND_CARDS,
  getLimitName,
} from '../components/DeckBuilder/useDeck';

// The one shared place every numeric deck-legality rule for this format
// lives. useDeck.ts already enforces the UPPER bound of each of these
// (MAIN_DECK_SIZE/EXTRA_DECK_SIZE/SIDE_DECK_SIZE/MAX_COPIES/
// MAX_LEGEND_COPIES/MAX_LEGEND_CARDS, re-exported here under their
// -_MAX names rather than redeclared, so the two can never drift apart)
// live while a deck is being BUILT — a deck assembled entirely through
// the Deck Builder's own UI can never end up violating any of those. But
// none of that enforcement runs a LOWER bound on the Main Deck (the
// builder has no reason to stop someone adding fewer than 40 cards), and
// none of it re-checks a deck that already exists — one saved before
// these rules existed, saved by directly editing Firestore, or valid at
// save-time but no longer valid because the card database itself changed
// since (a card gaining or losing Legend status, say). validateDeckLegality
// below is what re-checks a whole deck wholesale against every rule at
// once, for exactly that reason — see useDuelHosting.ts's own
// assertDeckIsLegal, which runs it before a player can host or join a
// match.
export const MAIN_DECK_MIN = 40;
export { MAIN_DECK_MAX, EXTRA_DECK_MAX, SIDE_DECK_MAX, MAX_COPIES, MAX_LEGEND_COPIES, MAX_LEGEND_CARDS };

// Built once, at module load — the same "id -> CardData" lookup
// buildInitialState (in useMultiplayerDuel.ts) and DeckManager's own
// resolveCards build for themselves, centralized here so this module's
// own resolveDeckCardIds below doesn't need a `cards` prop threaded in
// from wherever it's called.
const allCards = cardData as CardData[];
const cardById = new Map(allCards.map((card) => [card.id, card]));

// Turns a saved deck's stored card ids back into real CardData objects —
// same behavior as DeckManager's own (private) resolveCards: an id with
// no matching card (the database changed since the deck was saved) is
// silently skipped rather than thrown on, since that's also effectively
// what playing the duel itself would do with it.
export function resolveDeckCardIds(ids: number[]): CardData[] {
  const resolved: CardData[] = [];
  for (const id of ids) {
    const card = cardById.get(id);
    if (card) resolved.push(card);
  }
  return resolved;
}

export interface DeckLegalityResult {
  legal: boolean;
  errors: string[];
}

// Re-checks every numeric rule in the format at once, against already-
// resolved CardData arrays — see this module's own comment above for why
// this exists separately from useDeck.ts's own live, add-time
// enforcement. Combined-deck rules (Legend count, copy limits) are
// checked across Main + Extra + Side together, same as useDeck.ts's own
// canAddCard does while building.
export function validateDeckLegality(
  main: CardData[],
  extra: CardData[],
  side: CardData[],
): DeckLegalityResult {
  const errors: string[] = [];

  if (main.length < MAIN_DECK_MIN || main.length > MAIN_DECK_MAX) {
    errors.push(
      `Main Deck must have ${MAIN_DECK_MIN}-${MAIN_DECK_MAX} cards (currently ${main.length}).`,
    );
  }
  if (extra.length > EXTRA_DECK_MAX) {
    errors.push(
      `Extra Deck can have at most ${EXTRA_DECK_MAX} cards (currently ${extra.length}).`,
    );
  }
  if (side.length > SIDE_DECK_MAX) {
    errors.push(`Side Deck can have at most ${SIDE_DECK_MAX} cards (currently ${side.length}).`);
  }

  const combined = [...main, ...extra, ...side];

  const legendCount = combined.filter((card) => !!card.legend).length;
  if (legendCount > MAX_LEGEND_CARDS) {
    errors.push(
      `Deck can have at most ${MAX_LEGEND_CARDS} Legend cards (currently ${legendCount}).`,
    );
  }

  // Grouped by getLimitName (not name/id directly) — see that function's
  // own comment for why: alternate-artwork entries and explicit
  // treatedAsName cards (e.g. Harpie Lady 1/2/3) all need to share one
  // pooled copy count, not each get their own.
  const copyCounts = new Map<string, { count: number; isLegend: boolean }>();
  for (const card of combined) {
    const limitName = getLimitName(card);
    const existing = copyCounts.get(limitName);
    if (existing) {
      existing.count += 1;
      // Legend-ness is a property of the CARD, not the count entry, but
      // every copy sharing a limit name should always agree on it in
      // practice — falling back to whichever copy set it first if they
      // somehow didn't would be silently wrong, so this just keeps
      // whatever the first copy said, same as the rest of this function
      // implicitly assumes.
    } else {
      copyCounts.set(limitName, { count: 1, isLegend: !!card.legend });
    }
  }
  for (const [limitName, { count, isLegend }] of copyCounts) {
    const max = isLegend ? MAX_LEGEND_COPIES : MAX_COPIES;
    if (count > max) {
      errors.push(
        isLegend
          ? `"${limitName}" is a Legend card and can only appear ${max} time in the deck (currently ${count}).`
          : `"${limitName}" can only appear ${max} times in the deck (currently ${count}).`,
      );
    }
  }

  return { legal: errors.length === 0, errors };
}

// Convenience wrapper for the common case — a SavedDeck (raw ids, as
// stored in Firestore) rather than already-resolved CardData arrays.
// Used by useDuelHosting.ts's own assertDeckIsLegal, which only ever has
// a SavedDeck (from useSavedDecks' own getSavedDeck) to start from.
export function validateSavedDeckLegality(savedDeck: SavedDeck): DeckLegalityResult {
  return validateDeckLegality(
    resolveDeckCardIds(savedDeck.main),
    resolveDeckCardIds(savedDeck.extra),
    resolveDeckCardIds(savedDeck.side),
  );
}
