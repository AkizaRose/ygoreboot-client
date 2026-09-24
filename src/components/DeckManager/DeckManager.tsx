import { useEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import { useSavedDecks } from './useSavedDecks';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog';
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
  const {
    savedDecks,
    loading,
    selectedDeckId,
    setSelectedDeckId,
    getSavedDeck,
    saveDeck,
    renameDeck,
    deleteDeck,
    setDefaultDeck,
  } = useSavedDecks();
  const [nameInput, setNameInput] = useState('');
  // The name to show in the "has been saved" confirmation — set right
  // after a successful-looking Save click, cleared once the player
  // dismisses it. Holding the NAME (not just a boolean) means the
  // message stays accurate even if the player immediately starts typing
  // a different one into the name field before dismissing the dialog.
  const [savedConfirmName, setSavedConfirmName] = useState<string | null>(null);
  // The id of the deck a Delete click is asking the player to confirm —
  // deleteDeck itself isn't called until they answer Yes; a plain
  // boolean wouldn't be enough on its own since the confirmation message
  // needs that deck's own name, looked up from savedDecks below.
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  // Once the saved-deck list has actually loaded, and nothing's been
  // picked yet (a fresh visit to the page, not a deck the player already
  // chose), auto-select whichever deck is marked default — this is what
  // makes the Deck Builder open with that deck already loaded, since
  // selecting it here is what the effect below reacts to. A no-op if the
  // player has no default deck set at all.
  useEffect(() => {
    if (loading || selectedDeckId) return;
    const defaultDeck = savedDecks.find((deck) => deck.isDefault);
    if (defaultDeck) setSelectedDeckId(defaultDeck.id);
  }, [loading, savedDecks, selectedDeckId, setSelectedDeckId]);

  // Tracks which deck's CONTENTS were last actually loaded into the
  // builder — deliberately separate from selectedDeckId itself, so this
  // effect can tell "the player picked a different deck" (load it) apart
  // from "the saved-deck list merely changed underneath the same
  // selection" (e.g. someone renamed some other deck in another tab,
  // which still changes savedDecks' own array reference and therefore
  // getSavedDeck's identity below) — the latter should only refresh the
  // name field, never silently reload the builder's contents and wipe
  // whatever the player is mid-edit on.
  const lastLoadedIdRef = useRef<string | null>(null);

  // Whenever the selected saved deck changes, populate the name field
  // with its current name (so Rename starts from something sensible
  // instead of an empty or stale field) and load its contents into the
  // builder — this is what makes clicking a deck's name in the dropdown
  // load it immediately, with no separate Load button needed.
  useEffect(() => {
    if (!selectedDeckId) return;
    const deck = getSavedDeck(selectedDeckId);
    if (!deck) return;
    setNameInput(deck.name);
    if (lastLoadedIdRef.current === selectedDeckId) return;
    lastLoadedIdRef.current = selectedDeckId;
    onLoadDeck(resolveCards(deck.main), resolveCards(deck.extra), resolveCards(deck.side));
  }, [selectedDeckId, getSavedDeck]);

  const handleSave = () => {
    const trimmedName = nameInput.trim();
    if (!trimmedName) return;
    saveDeck(nameInput, mainDeck, extraDeck, sideDeck);
    setSavedConfirmName(trimmedName);
  };

  const handleRename = () => {
    if (!selectedDeckId) return;
    renameDeck(selectedDeckId, nameInput);
  };

  // Opens the confirmation dialog rather than deleting immediately — the
  // actual delete only happens if the player answers Yes (see
  // handleDeleteConfirm below).
  const handleDeleteClick = () => {
    if (!selectedDeckId) return;
    setDeleteConfirmId(selectedDeckId);
  };

  const handleDeleteConfirm = () => {
    if (!deleteConfirmId) return;
    deleteDeck(deleteConfirmId);
    setNameInput('');
    setDeleteConfirmId(null);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmId(null);
  };

  const handleSetDefault = () => {
    if (!selectedDeckId) return;
    setDefaultDeck(selectedDeckId);
  };

  // Looked up fresh on every render (not stored alongside deleteConfirmId
  // itself) so the dialog's own message always reflects the deck's
  // CURRENT name — relevant in the unlikely case it gets renamed from
  // another tab while this confirmation is still open.
  const deckPendingDelete = deleteConfirmId
    ? (savedDecks.find((deck) => deck.id === deleteConfirmId) ?? null)
    : null;

  return (
    <div className="DeckManager">

      <select
        className="DeckManager-select"
        value={selectedDeckId ?? ''}
        onChange={(e) => setSelectedDeckId(e.target.value || null)}
        disabled={loading}
      >
        <option value="">{loading ? 'Loading decks…' : '— Select a saved deck —'}</option>
        {savedDecks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.name}
            {deck.isDefault ? ' (default)' : ''}
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
          onClick={handleRename}
          disabled={!selectedDeckId || !nameInput.trim()}
        >
          Rename
        </button>
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleDeleteClick}
          disabled={!selectedDeckId}
        >
          Delete
        </button>
        <button
          type="button"
          className="DeckManager-button"
          onClick={handleSetDefault}
          disabled={!selectedDeckId}
        >
          Set Default
        </button>
      </div>

      {savedConfirmName && (
        <ConfirmDialog
          message={`${savedConfirmName} has been saved`}
          buttons={[{ label: 'OK', onClick: () => setSavedConfirmName(null) }]}
          onDismiss={() => setSavedConfirmName(null)}
        />
      )}

      {deckPendingDelete && (
        <ConfirmDialog
          message={`Delete ${deckPendingDelete.name}? This cannot be undone`}
          buttons={[
            { label: 'Yes', onClick: handleDeleteConfirm },
            { label: 'No', onClick: handleDeleteCancel },
          ]}
          onDismiss={handleDeleteCancel}
        />
      )}
    </div>
  );
}

export default DeckManager;