import './TurnCounter.css';

interface TurnCounterProps {
  turnNumber: number;
  isMyTurn: boolean;
}

// Renders in the same row as PhaseTracker (DuelField.tsx's own
// phaseTrackerRow), in the column matching the opponent's own Banished
// Zone (grid-column: 1 — see TurnCounter.css) rather than PhaseTracker's
// own column.
function TurnCounter({ turnNumber, isMyTurn }: TurnCounterProps) {
  return (
    <div className="TurnCounter">
      <div
        className={[
          'TurnCounter-label',
          isMyTurn ? 'TurnCounter-label--mine' : 'TurnCounter-label--opponent',
        ].join(' ')}
      >
        Turn {turnNumber}
      </div>
    </div>
  );
}

export default TurnCounter;