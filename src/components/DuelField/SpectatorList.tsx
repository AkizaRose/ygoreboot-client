import type { DuelSpectator } from '../Matchmaking/useDuelSpectators';
import { getAvatarUrl } from '../Avatar/avatars';
import './SpectatorList.css';

interface SpectatorListProps {
  spectators: DuelSpectator[];
}

// Sits directly below the win/loss match-status box in the Multiplayer
// Duel Field Page's own left-hand column — visible to the players AND
// every spectator alike (see useDuelSpectators' own comment on why both
// subscribe to the same list), so anyone watching can see who else is
// watching.
function SpectatorList({ spectators }: SpectatorListProps) {
  return (
    <div className="SpectatorList">
      <div className="SpectatorList-title">Spectators ({spectators.length})</div>
      {spectators.length === 0 ? (
        <p className="SpectatorList-message">No one is spectating.</p>
      ) : (
        <ul className="SpectatorList-list">
          {spectators.map((spectator) => (
            <li key={spectator.uid} className="SpectatorList-row">
              <img
                src={getAvatarUrl(spectator.avatarId)}
                alt=""
                className="SpectatorList-avatar"
              />
              <span className="SpectatorList-name">{spectator.username}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SpectatorList;
