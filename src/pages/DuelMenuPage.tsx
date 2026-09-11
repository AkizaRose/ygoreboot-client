import { useState } from 'react';
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

  const handleHostToggle = async () => {
    if (!isHosting && !selectedDeckId) return;
    setHostError(null);
    try {
      if (isHosting) {
        await stopHosting();
      } else {
        await startHosting(selectedDeckId);
      }
    } catch {
      setHostError('Could not update hosting status. Please try again.');
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