import './PhaseTracker.css';

interface PhaseTrackerProps {
  phaseLabel: string;
  onPrev: () => void;
  onNext: () => void;
}

function PhaseTracker({ phaseLabel, onPrev, onNext }: PhaseTrackerProps) {
  return (
    <div className="PhaseTracker">
      <button
        type="button"
        className="PhaseTracker-arrow"
        onClick={onPrev}
        aria-label="Previous phase"
      >
        ‹
      </button>
      <span className="PhaseTracker-label">{phaseLabel}</span>
      <button
        type="button"
        className="PhaseTracker-arrow"
        onClick={onNext}
        aria-label="Next phase"
      >
        ›
      </button>
    </div>
  );
}

export default PhaseTracker;
