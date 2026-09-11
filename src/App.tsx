import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import CardPrewarmGate from './components/CardView/CardPrewarmGate';
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import DuelMenuPage from './pages/DuelMenuPage';
import MultiplayerDuelFieldPage from './pages/MultiplayerDuelFieldPage';
import DeckBuilderPage from './pages/DeckBuilderPage';
import AccountPage from './pages/AccountPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <CardPrewarmGate>
                  <LandingPage />
                </CardPrewarmGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duel"
            element={
              <ProtectedRoute>
                <CardPrewarmGate>
                  <DuelMenuPage />
                </CardPrewarmGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duel/multiplayer/:duelId"
            element={
              <ProtectedRoute>
                <MultiplayerDuelFieldPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck-builder"
            element={
              <ProtectedRoute>
                <CardPrewarmGate>
                  <DeckBuilderPage />
                </CardPrewarmGate>
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;