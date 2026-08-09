import { useCallback, useEffect, useState } from 'react';
import type { CardData } from '../../types/Card';

// Only card IDs are stored, not full card objects — smaller storage
// footprint, and a saved deck always reflects the *current* version of a
// card (stats, text, etc.) rather than freezing a stale copy from
// whenever it was saved.
export interface SavedDeck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  updatedAt: number;
}

const STORAGE_KEY = 'ygoreboot:savedDecks';

function loadFromStorage(): SavedDeck[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[useSavedDecks] Failed to read saved decks from localStorage:', err);
    return [];
  }
}

function saveToStorage(decks: SavedDeck[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  } catch (err) {
    console.error('[useSavedDecks] Failed to write saved decks to localStorage:', err);
  }
}

export function useSavedDecks() {
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>(() => loadFromStorage());
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  // Persist to localStorage on every change. Runs on mount too (harmless
  // — just re-writes what was already there).
  useEffect(() => {
    saveToStorage(savedDecks);
  }, [savedDecks]);

  const getSavedDeck = useCallback(
    (id: string) => savedDecks.find((deck) => deck.id === id) ?? null,
    [savedDecks],
  );

  // Overwrites the deck with a matching name if one exists, otherwise
  // creates a new entry. Either way, selects the resulting deck
  // afterward, so a subsequent Save reuses the same entry by default.
  const saveDeck = useCallback(
    (name: string, main: CardData[], extra: CardData[], side: CardData[]) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;

      const payload = {
        main: main.map((c) => c.id),
        extra: extra.map((c) => c.id),
        side: side.map((c) => c.id),
        updatedAt: Date.now(),
      };

      const existing = savedDecks.find((deck) => deck.name === trimmedName);

      if (existing) {
        setSavedDecks((prev) =>
          prev.map((deck) => (deck.id === existing.id ? { ...deck, ...payload } : deck)),
        );
        setSelectedDeckId(existing.id);
      } else {
        const newDeck: SavedDeck = { id: crypto.randomUUID(), name: trimmedName, ...payload };
        setSavedDecks((prev) => [...prev, newDeck]);
        setSelectedDeckId(newDeck.id);
      }
    },
    [savedDecks],
  );

  const renameDeck = useCallback((id: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    setSavedDecks((prev) =>
      prev.map((deck) =>
        deck.id === id ? { ...deck, name: trimmedName, updatedAt: Date.now() } : deck,
      ),
    );
  }, []);

  const deleteDeck = useCallback((id: string) => {
    setSavedDecks((prev) => prev.filter((deck) => deck.id !== id));
    setSelectedDeckId((prev) => (prev === id ? null : prev));
  }, []);

  return {
    savedDecks,
    selectedDeckId,
    setSelectedDeckId,
    getSavedDeck,
    saveDeck,
    renameDeck,
    deleteDeck,
  };
}
