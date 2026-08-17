import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import '../components/NavMenu/NavMenu.css';
import './DuelMenuPage.css';

function DuelMenuPage() {
  const navigate = useNavigate();
  const { savedDecks, loading } = useSavedDecks();
  const [selectedDeckId, setSelectedDeckId] = useState('');

  const handleSoloMode = () => {
    if (!selectedDeckId) return;
    navigate(`/duel/solo/${selectedDeckId}`);
  };

  return (
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
          onClick={handleSoloMode}
          disabled={!selectedDeckId}
        >
          Solo Mode
        </button>
        <button type="button" className="NavMenu-button" onClick={() => navigate('/')}>
          Exit
        </button>
      </nav>
    </div>
  );
}

export default DuelMenuPage;