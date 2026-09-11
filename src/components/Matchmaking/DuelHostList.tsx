import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useDuelHosts, type DuelHost } from './useDuelHosts';
import { getAvatarUrl } from '../Avatar/avatars';
import './DuelHostList.css';

interface DuelHostListProps {
  selectedDeckId: string;
  onJoin: (host: DuelHost, deckId: string) => Promise<void>;
}

function DuelHostList({ selectedDeckId, onJoin }: DuelHostListProps) {
  const { currentUser } = useAuth();
  const { hosts, loading } = useDuelHosts();
  const [joiningUid, setJoiningUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A player hosting shouldn't see themselves as a joinable option —
  // joining "yourself" doesn't mean anything.
  const joinableHosts = hosts.filter((host) => host.uid !== currentUser?.uid);

  const handleJoinClick = async (host: DuelHost) => {
    if (!selectedDeckId) {
      setError('Select a deck first.');
      return;
    }
    setError(null);
    setJoiningUid(host.uid);
    try {
      await onJoin(host, selectedDeckId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not join that duel. Please try again.',
      );
    } finally {
      setJoiningUid(null);
    }
  };

  return (
    <div className="DuelHostList">
      <h2 className="DuelHostList-title">Join a Duel</h2>
      {error && <p className="DuelHostList-error">{error}</p>}
      {loading ? (
        <p className="DuelHostList-message">Loading…</p>
      ) : joinableHosts.length === 0 ? (
        <p className="DuelHostList-message">No one is currently hosting a duel.</p>
      ) : (
        <ul className="DuelHostList-list">
          {joinableHosts.map((host) => (
            <li key={host.uid}>
              <button
                type="button"
                className="DuelHostList-hostButton"
                onClick={() => handleJoinClick(host)}
                disabled={joiningUid !== null}
              >
                <img src={getAvatarUrl(host.avatarId)} alt="" className="DuelHostList-hostAvatar" />
                <span className="DuelHostList-hostName">{host.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default DuelHostList;
