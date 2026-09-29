import { useNavigate } from 'react-router-dom';
import { useLiveDuels } from './useLiveDuels';
import { getAvatarUrl } from '../Avatar/avatars';
import './LiveDuelList.css';

// Duel Spectating's own "Live Matches" list — every ongoing duel, shown
// with both players' usernames/avatars, letting any signed-in user watch
// one live without needing an invite. Deliberately doesn't filter out the
// viewer's own match the way DuelHostList filters out the viewer's own
// hosting slot — a player revisiting the Duel Menu Page mid-match (e.g. a
// second browser tab) has no real use for spectating their own duel, but
// it's harmless to list, and excluding it would need an extra per-row
// "is this me" check for no real benefit.
function LiveDuelList() {
  const navigate = useNavigate();
  const { duels, loading } = useLiveDuels();

  const handleSpectateClick = (duelId: string) => {
    navigate(`/duel/multiplayer/${duelId}?spectate=true`);
  };

  return (
    <div className="LiveDuelList">
      <h2 className="LiveDuelList-title">Live Matches</h2>
      {loading ? (
        <p className="LiveDuelList-message">Loading…</p>
      ) : duels.length === 0 ? (
        <p className="LiveDuelList-message">No matches are currently live.</p>
      ) : (
        <ul className="LiveDuelList-list">
          {duels.map((duel) => (
            <li key={duel.duelId}>
              <button
                type="button"
                className="LiveDuelList-duelButton"
                onClick={() => handleSpectateClick(duel.duelId)}
              >
                <span className="LiveDuelList-player">
                  <img
                    src={getAvatarUrl(duel.player1AvatarId)}
                    alt=""
                    className="LiveDuelList-playerAvatar"
                  />
                  <span className="LiveDuelList-playerName">{duel.player1Username}</span>
                </span>
                <span className="LiveDuelList-vs">vs</span>
                <span className="LiveDuelList-player">
                  <img
                    src={getAvatarUrl(duel.player2AvatarId)}
                    alt=""
                    className="LiveDuelList-playerAvatar"
                  />
                  <span className="LiveDuelList-playerName">{duel.player2Username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LiveDuelList;
