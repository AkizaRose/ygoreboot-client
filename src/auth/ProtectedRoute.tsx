import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import './ProtectedRoute.css';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth();

  // Avoids a flash of "redirected to /login" before Firebase has had a
  // chance to check for an existing session on first load.
  if (loading) {
    return <div className="ProtectedRoute-loading">Loading…</div>;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;
