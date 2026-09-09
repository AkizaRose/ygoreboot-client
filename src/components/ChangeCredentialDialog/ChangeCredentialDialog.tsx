import { useState, type FormEvent } from 'react';
import './ChangeCredentialDialog.css';

interface ChangeCredentialDialogProps {
  title: string;
  newValueLabel: string;
  confirmValueLabel: string;
  inputType: 'email' | 'password';
  onSubmit: (currentPassword: string, newValue: string) => Promise<void>;
  onClose: () => void;
}

function getFriendlyErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/requires-recent-login':
      return 'Please log out and back in, then try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function ChangeCredentialDialog({
  title,
  newValueLabel,
  confirmValueLabel,
  inputType,
  onSubmit,
  onClose,
}: ChangeCredentialDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newValue, setNewValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newValue !== confirmValue) {
      setError(
        `New and confirmation ${inputType === 'email' ? 'emails' : 'passwords'} don't match.`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(currentPassword, newValue);
      onClose();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="ChangeCredentialDialog-overlay" onClick={onClose}>
      <div className="ChangeCredentialDialog-box" onClick={(e) => e.stopPropagation()}>
        <h2 className="ChangeCredentialDialog-title">{title}</h2>
        <form className="ChangeCredentialDialog-form" onSubmit={handleSubmit}>
          <label className="ChangeCredentialDialog-label">
            Current Password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="ChangeCredentialDialog-input"
              required
              autoComplete="current-password"
            />
          </label>
          <label className="ChangeCredentialDialog-label">
            {newValueLabel}
            <input
              type={inputType}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="ChangeCredentialDialog-input"
              required
              autoComplete={inputType === 'email' ? 'email' : 'new-password'}
            />
          </label>
          <label className="ChangeCredentialDialog-label">
            {confirmValueLabel}
            <input
              type={inputType}
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              className="ChangeCredentialDialog-input"
              required
              autoComplete={inputType === 'email' ? 'email' : 'new-password'}
            />
          </label>
          {error && <p className="ChangeCredentialDialog-error">{error}</p>}
          <div className="ChangeCredentialDialog-actions">
            <button type="submit" className="ChangeCredentialDialog-button" disabled={isSubmitting}>
              {isSubmitting ? 'Please wait…' : 'Save'}
            </button>
            <button
              type="button"
              className="ChangeCredentialDialog-button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ChangeCredentialDialog;
