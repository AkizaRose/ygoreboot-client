import { useEffect, useState } from 'react';
import type { CardData } from '../../types/Card';
import { useSavedDecks } from './useSavedDecks';
import './DeckManager.css';

interface DeckManagerProps {
  // Full card database, needed to turn a saved deck's stored IDs back
  // into real CardData objects when loading.
  cards: CardData[];
  mainDeck: CardData[];
  extraDeck: CardData[];
  sideDeck: CardData[];
  onLoadDeck: (main: CardData[], extra: CardData[], side: CardData[]) => void;
}

function DeckManager({ cards, mainDeck, extraDeck, sideDeck, onLoadDeck }: DeckManagerProps) {
  const { savedDecks, selectedDeckId, setSelectedDeckId, getSavedDeck, saveDeck, renameDeck, deleteDeck } =
    useSavedDecks();
  const [nameInput, setNameInput] = useState('');

  // Whenever the selected saved deck changes, populate the name field with
  // its current name — so Rename starts from something sensible instead of
  // an empty or stale field.
  useEffect(() => {
    if (!selectedDeckId) return;
    const deck = getSavedDeck(selectedDeckId);
    if (deck) setNameInput(deck.name);
  }, [selectedDeckId, getSavedDeck]);

  const resolveCards = (ids: number[]): CardData[] => {
    const cardsById = new Map(cards.map((c) => [c.id, c]));
    const resolved: CardData[] = [];
    for (const id of ids) {
      const card = cardsById.get(id);
      if (card) {
        resolved.push(card);
      } else {
        console.warn(`[DeckManager] Saved card id ${id} not found in card database — skipped.`);
      }
    }
    return resolved;
  };

  const handleSave = () => {
    saveDeck(nameInput, mainDeck, extraDeck, sideDeck);
  };

  const handleLoad = () => {
    if (!selectedDeckId) return;
    const deck = getSavedDeck(selectedDeckId);
    if (!deck) return;
    onLoadDeck(resolveCards(deck.main), resolveCards(deck.extra), resolveCards(deck.side));
  };

  const handleRename = () => {
    if (!selectedDeckId) return;
    renameDeck(selectedDeckId, nameInput);
  };

  const handleDelete = () => {
    if (!selectedDeckId) return;
    deleteDeck(selectedDeckId);
    setNameInput('');
  };

  return (
    <div className="DeckManager">

      <select
        className="DeckManager-select"
        value={selectedDeckId ?? ''}
        onChange={(e) => setSelectedDeckId(e.target.value || null)}
      >
        <option value="">— Select a saved deck —</option>
        {savedDecks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.name}
          </option>
        ))}
      </select>

      <input
        type="text"
        className="DeckManager-nameInput"
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        placeholder="Deck name..."
      />

      <div className="DeckManager-actions">
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleSave}
          disabled={!nameInput.trim()}
        >
          Save
        </button>
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleLoad}
          disabled={!selectedDeckId}
        >
          Load
        </button>
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleRename}
          disabled={!selectedDeckId || !nameInput.trim()}
        >
          Rename
        </button>
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleDelete}
          disabled={!selectedDeckId}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default DeckManager;
