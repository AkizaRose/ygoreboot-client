import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ChangeCredentialDialog from '../components/ChangeCredentialDialog/ChangeCredentialDialog';
import AvatarSelector from '../components/Avatar/AvatarSelector';
import SleeveSelector from '../components/Sleeve/SleeveSelector';
import CardLayoutSelector from '../components/CardLayout/CardLayoutSelector';
import { useMatchRecord } from '../components/Account/useMatchRecord';
import './AccountPage.css';

type OpenDialog = 'email' | 'password' | null;

function AccountPage() {
  const { currentUser, changeEmail, changePassword } = useAuth();
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const navigate = useNavigate();
  // loading isn't used here the way it gates other pages' own first
  // render — this whole page already renders immediately regardless (the
  // rest of it doesn't wait on any async load either), so 0/0/0 while
  // this is still loading just reads as "no matches recorded yet" for a
  // moment rather than as a distinct loading state worth blocking on.
  const { matchWins, matchLosses, matchDraws } = useMatchRecord();

  return (
    <div className="AccountPage">
      <div className="AccountPage-content">
        <AvatarSelector />
        <SleeveSelector />

        {/* Stacks the account-details box and the new Match Record box
            in a column together, rather than letting the match record
            box join AccountPage-content's own row alongside AvatarSelector
            (that row's own display: flex, with no direction override, is
            row by default) and end up squeezed in beside it instead of
            sitting naturally underneath the account details. */}
        <div className="AccountPage-boxColumn">
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

        {/* Which layout every card image is drawn in, for this user —
            their own cards, their opponent's, both players' when
            spectating, replays, deck builder, card browser. Unlike the
            card back above, it's purely viewer-side: other players never
            see (or are affected by) it. */}
        <div className="AccountPage-box">
          <h1 className="AccountPage-title">Card Layout</h1>
          <CardLayoutSelector />
        </div>

        {/* Whole-account totals, across every match this account has ever
            completed — not per-deck or per-duel. Written by
            useMultiplayerDuel's own account-stats effect the moment a
            match's outcome is decided; this panel is read-only, purely a
            display of the same three fields (see useMatchRecord's own
            comment). */}
        <div className="AccountPage-box">
          <h1 className="AccountPage-title">Match Record</h1>

          <div className="AccountPage-matchRecordRow">
            <div className="AccountPage-matchRecordStat">
              <span className="AccountPage-matchRecordValue AccountPage-matchRecordValue--wins">
                {matchWins}
              </span>
              <span className="AccountPage-matchRecordLabel">Wins</span>
            </div>
            <div className="AccountPage-matchRecordStat">
              <span className="AccountPage-matchRecordValue AccountPage-matchRecordValue--draws">
                {matchDraws}
              </span>
              <span className="AccountPage-matchRecordLabel">Draws</span>
            </div>
            <div className="AccountPage-matchRecordStat">
              <span className="AccountPage-matchRecordValue AccountPage-matchRecordValue--losses">
                {matchLosses}
              </span>
              <span className="AccountPage-matchRecordLabel">Losses</span>
            </div>
          </div>
        </div>
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