import { useNavigate } from 'react-router-dom';
import { useReplayHistory } from '../components/Replay/useReplayHistory';
import { getAvatarUrl } from '../components/Avatar/avatars';
import './ReplaysPage.css';

const RESULT_LABEL: Record<string, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
};

function ReplaysPage() {
  const navigate = useNavigate();
  const { entries, loading, error } = useReplayHistory();

  return (
    <div className="ReplaysPage">
      <div className="ReplaysPage-box">
        <h1 className="ReplaysPage-title">Replays</h1>

        {loading && <p className="ReplaysPage-status">Loading your match history…</p>}
        {!loading && error && <p className="ReplaysPage-status">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="ReplaysPage-status">
            No completed matches yet — a match's replay appears here once it finishes.
          </p>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="ReplaysPage-list">
            {entries.map((entry) => (
              <button
                type="button"
                key={entry.duelId}
                className="ReplaysPage-row"
                onClick={() => navigate(`/replays/${entry.duelId}`)}
              >
                <img
                  src={getAvatarUrl(entry.opponentAvatarId)}
                  alt=""
                  className="ReplaysPage-rowAvatar"
                />
                <div className="ReplaysPage-rowInfo">
                  <span className="ReplaysPage-rowOpponent">{entry.opponentUsername}</span>
                  <span className="ReplaysPage-rowDate">
                    {entry.matchCompletedAt.toDate().toLocaleString()}
                  </span>
                </div>
                <span className={`ReplaysPage-rowResult ReplaysPage-rowResult--${entry.result}`}>
                  {RESULT_LABEL[entry.result]}
                </span>
              </button>
            ))}
          </div>
        )}

        <button type="button" className="ReplaysPage-backButton" onClick={() => navigate('/')}>
          Back
        </button>
      </div>
    </div>
  );
}

export default ReplaysPage;
