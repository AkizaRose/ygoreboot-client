import type { TurnPhase } from '../Matchmaking/useMultiplayerDuel';
import './PhaseTracker.css';

const PHASE_LABELS: Record<TurnPhase, string> = {
  draw: 'Draw Phase',
  main1: 'Main 1',
  battle: 'Battle Phase',
  main2: 'Main 2',
  end: 'End Phase',
};

interface PhaseTrackerProps {
  currentPhase: TurnPhase;
  turnEnding: boolean;
  isMyTurn: boolean;
  onPrevPhase: () => void;
  onNextPhase: () => void;
  onStartTurn: () => void;
}

function PhaseTracker({
  currentPhase,
  turnEnding,
  isMyTurn,
  onPrevPhase,
  onNextPhase,
  onStartTurn,
}: PhaseTrackerProps) {
  // Arrows are the turn player's normal way of navigating phases — never
  // available to the other player, and not available to EITHER player
  // once turnEnding (the End Turn/Start Turn handoff is the label's own
  // interaction at that point, not the arrows'). Kept in the DOM
  // (disabled, not removed) so the tracker's own width — and therefore
  // the label's position — stays constant regardless of who's currently
  // allowed to click.
  const arrowsEnabled = isMyTurn && !turnEnding;
  const canGoPrev = arrowsEnabled && currentPhase !== 'draw';

  let label: string;
  let labelClickable = false;
  let onLabelClick: (() => void) | undefined;

  if (turnEnding) {
    // Only the player ABOUT to start their turn can ever click this —
    // the player who just ended theirs sees the same text as a plain,
    // non-interactive status readout.
    label = isMyTurn ? 'End Turn' : 'Start Turn';
    labelClickable = !isMyTurn;
    onLabelClick = !isMyTurn ? onStartTurn : undefined;
  } else {
    label = PHASE_LABELS[currentPhase];
  }

  return (
    <div className="PhaseTracker">
      <button
        type="button"
        className="PhaseTracker-arrow"
        onClick={onPrevPhase}
        disabled={!canGoPrev}
        aria-label="Previous phase"
      >
        ◀
      </button>
      <div
        className={[
          'PhaseTracker-label',
          isMyTurn ? 'PhaseTracker-label--mine' : 'PhaseTracker-label--opponent',
          labelClickable ? 'PhaseTracker-label--clickable' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onLabelClick}
        role={labelClickable ? 'button' : undefined}
      >
        {label}
      </div>
      <button
        type="button"
        className="PhaseTracker-arrow"
        onClick={onNextPhase}
        disabled={!arrowsEnabled}
        aria-label="Next phase"
      >
        ▶
      </button>
    </div>
  );
}

export default PhaseTracker;
