import './TurnCounter.css';

interface TurnCounterProps {
  turnNumber: number;
  isMyTurn: boolean;
}

// Sits directly above PhaseTracker, in the opponent's own field row (see
// DuelField.tsx's own fieldRow — rendered only for the flipped/opponent
// PlayerField instance, at the same grid-column: 7 PhaseTracker itself
// uses one row down) rather than in a dedicated row of its own, since
// there's no separate row above the opponent's field zones to put one
// in.
function TurnCounter({ turnNumber, isMyTurn }: TurnCounterProps) {
  return (
    <div
      className={[
        'TurnCounter',
        isMyTurn ? 'TurnCounter--mine' : 'TurnCounter--opponent',
      ].join(' ')}
    >
      Turn {turnNumber}
    </div>
  );
}

export default TurnCounter;
