import './StatRangeMenu.css';

// Strips anything that isn't 0-9, so pasted or typed non-digit characters
// (letters, minus signs, decimal points, etc.) never make it into the field.
function sanitizeDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

interface StatRangeMenuProps {
  label: string;
  min: string;
  max: string;
  onChangeMin: (value: string) => void;
  onChangeMax: (value: string) => void;
}

function StatRangeMenu({ label, min, max, onChangeMin, onChangeMax }: StatRangeMenuProps) {
  return (
    <div className="StatRangeMenu">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="StatRangeMenu-input"
        value={min}
        onChange={(e) => onChangeMin(sanitizeDigits(e.target.value))}
        aria-label={`Minimum ${label}`}
      />
      <span className="StatRangeMenu-label">
        ≤ {label} ≤
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="StatRangeMenu-input"
        value={max}
        onChange={(e) => onChangeMax(sanitizeDigits(e.target.value))}
        aria-label={`Maximum ${label}`}
      />
    </div>
  );
}

export default StatRangeMenu;
