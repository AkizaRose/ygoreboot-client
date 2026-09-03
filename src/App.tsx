import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import CardPrewarmGate from './components/CardView/CardPrewarmGate';
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import DuelMenuPage from './pages/DuelMenuPage';
import DuelFieldPage from './pages/DuelFieldPage';
import DeckBuilderPage from './pages/DeckBuilderPage';

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
            path="/duel/solo/:deckId"
            element={
              <ProtectedRoute>
                <CardPrewarmGate>
                  <DuelFieldPage />
                </CardPrewarmGate>
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
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;