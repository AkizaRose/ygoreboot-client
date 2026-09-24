import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import { useDuelHosting } from '../components/Matchmaking/useDuelHosting';
import DuelHostList from '../components/Matchmaking/DuelHostList';
import '../components/NavMenu/NavMenu.css';
import './DuelMenuPage.css';

function DuelMenuPage() {
  const navigate = useNavigate();
  const { savedDecks, loading } = useSavedDecks();
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const { isHosting, startHosting, stopHosting, joinHost } = useDuelHosting();
  const [hostError, setHostError] = useState<string | null>(null);

  // Once the saved-deck list has actually loaded, and the player hasn't
  // picked anything yet, auto-select whichever deck is marked default
  // (see DeckManager.tsx's own "Set Default" button) — same reasoning as
  // that page's own auto-load-on-open effect, just selecting rather than
  // also loading, since this page's own dropdown IS the selection (there's
  // no separate deck-builder-style "load into a workspace" step here).
  useEffect(() => {
    if (loading || selectedDeckId) return;
    const defaultDeck = savedDecks.find((deck) => deck.isDefault);
    if (defaultDeck) setSelectedDeckId(defaultDeck.id);
  }, [loading, savedDecks, selectedDeckId]);

  const handleHostToggle = async () => {
    if (!isHosting && !selectedDeckId) return;
    setHostError(null);
    try {
      if (isHosting) {
        await stopHosting();
      } else {
        await startHosting(selectedDeckId);
      }
    } catch (err) {
      // startHosting throws a specific, player-facing message when the
      // selected deck fails deck-legality validation (see
      // useDuelHosting's own assertDeckIsLegal) — surfaced verbatim
      // rather than replaced with a generic message, same as
      // DuelHostList's own handleJoinClick already does for joinHost.
      setHostError(
        err instanceof Error ? err.message : 'Could not update hosting status. Please try again.',
      );
    }
  };

  return (
    <div className="DuelMenuPage-content">
      <div className="NavMenu">
        <select
          className="DuelMenuPage-deckSelect"
          value={selectedDeckId}
          onChange={(e) => setSelectedDeckId(e.target.value)}
          disabled={loading}
        >
          <option value="">{loading ? 'Loading decks…' : '— Select a deck —'}</option>
          {savedDecks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name}
              {deck.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>

        <nav className="NavMenu-nav">
          <button
            type="button"
            className="NavMenu-button"
            onClick={handleHostToggle}
            disabled={!isHosting && !selectedDeckId}
          >
            {isHosting ? 'Cancel Hosting' : 'Host Duel'}
          </button>
          {hostError && <p className="DuelMenuPage-hostError">{hostError}</p>}
          <button type="button" className="NavMenu-button" onClick={() => navigate('/')}>
            Exit
          </button>
        </nav>
      </div>

      <DuelHostList selectedDeckId={selectedDeckId} onJoin={joinHost} />
    </div>
  );
}

export default DuelMenuPage;