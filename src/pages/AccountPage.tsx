import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ChangeCredentialDialog from '../components/ChangeCredentialDialog/ChangeCredentialDialog';
import AvatarSelector from '../components/Avatar/AvatarSelector';
import './AccountPage.css';

type OpenDialog = 'email' | 'password' | null;

function AccountPage() {
  const { currentUser, changeEmail, changePassword } = useAuth();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const navigate = useNavigate();

  return (
    <div className="AccountPage">
      <div className="AccountPage-content">
        <AvatarSelector />

        <div className="AccountPage-box">
          <h1 className="AccountPage-title">Account</h1>

          <div className="AccountPage-row">
            <span className="AccountPage-label">Username:</span>
            <span className="AccountPage-value">{currentUser?.displayName}</span>
          </div>

          <div className="AccountPage-row">
            <span className="AccountPage-label">Email:</span>
            <span className="AccountPage-value">{currentUser?.email}</span>
            <button
              type="button"
              className="AccountPage-changeButton"
              onClick={() => setOpenDialog('email')}
            >
              Change Email
            </button>
          </div>

          <div className="AccountPage-row">
            <span className="AccountPage-label">Password:</span>
            <span className="AccountPage-value">••••••••</span>
            <button
              type="button"
              className="AccountPage-changeButton"
              onClick={() => setOpenDialog('password')}
            >
              Change Password
            </button>
          </div>

          <button type="button" className="AccountPage-backButton" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>

      {openDialog === 'email' && (
        <ChangeCredentialDialog
          title="Change Email"
          newValueLabel="New Email"
          confirmValueLabel="Confirm New Email"
          inputType="email"
          onSubmit={(currentPassword, newValue) => changeEmail(currentPassword, newValue)}
          onClose={() => setOpenDialog(null)}
        />
      )}

      {openDialog === 'password' && (
        <ChangeCredentialDialog
          title="Change Password"
          newValueLabel="New Password"
          confirmValueLabel="Confirm New Password"
          inputType="password"
          onSubmit={(currentPassword, newValue) => changePassword(currentPassword, newValue)}
          onClose={() => setOpenDialog(null)}
        />
      )}
    </div>
  );
}

export default AccountPage;
