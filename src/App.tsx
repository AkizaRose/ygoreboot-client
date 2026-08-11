import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DuelMenuPage from './pages/DuelMenuPage';
import DuelFieldPage from './pages/DuelFieldPage';
import DeckBuilderPage from './pages/DeckBuilderPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/duel" element={<DuelMenuPage />} />
        <Route path="/duel/solo/:deckId" element={<DuelFieldPage />} />
        <Route path="/deck-builder" element={<DeckBuilderPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
