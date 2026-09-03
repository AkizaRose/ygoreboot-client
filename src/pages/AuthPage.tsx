import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import './AuthPage.css';

type Mode = 'login' | 'signup';

// Kept simple and URL/display-safe, since usernames may eventually show
// up in more places (matchmaking, duel invites) than just this form.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function getFriendlyErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/username-already-in-use':
      return 'That username is already taken.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect username or password.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signUp, logIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (!USERNAME_PATTERN.test(username.trim())) {
        setError(
          'Username must be 3-20 characters, using only letters, numbers, and underscores.',
        );
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUp(username, email, password);
      } else {
        await logIn(username, password);
      }
      navigate('/');
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="AuthPage">
      <div className="AuthPage-box">
        <h1 className="AuthPage-title">{mode === 'login' ? 'Log In' : 'Create Account'}</h1>
        <form className="AuthPage-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="AuthPage-input"
            required
            autoComplete="username"
          />
          {mode === 'signup' && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="AuthPage-input"
              required
              autoComplete="email"
            />
          )}
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="AuthPage-input"
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'signup' && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="AuthPage-input"
              required
              autoComplete="new-password"
            />
          )}
          {error && <p className="AuthPage-error">{error}</p>}
          <button type="submit" className="AuthPage-submitButton" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>
        <button
          type="button"
          className="AuthPage-toggleButton"
          onClick={() => {
            setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
            setError(null);
          }}
        >
          {mode === 'login'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}

export default AuthPage;
