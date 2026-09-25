import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import ViewportScaler from './components/ViewportScaler/ViewportScaler';
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
        {/* Scales every routed page uniformly to fit the actual window —
            see ViewportScaler.tsx for why this is what makes window
            resizing and native browser zoom both behave the DuelingBook
            way ("everything shrinks to fit, nothing moves relative to
            anything else"). Wrapping it here, once, around every Route
            rather than inside each page individually, is what lets it
            react to route changes (a differently-sized page swapping in)
            for free, via the ResizeObserver watching its own content. */}
        <ViewportScaler>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <LandingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/duel"
              element={
                <ProtectedRoute>
                  <DuelMenuPage />
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
                  <DeckBuilderPage />
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
        </ViewportScaler>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;