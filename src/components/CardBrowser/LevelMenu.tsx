import './LevelMenu.css';

const LEVELS = [1, 2, 3, 4, 5];

interface LevelMenuProps {
  min: number;
  max: number;
  onChangeMin: (value: number) => void;
  onChangeMax: (value: number) => void;
}

function LevelMenu({ min, max, onChangeMin, onChangeMax }: LevelMenuProps) {
  return (
    <div className="LevelMenu">
      <select
        className="LevelMenu-select"
        value={min}
        onChange={(e) => onChangeMin(Number(e.target.value))}
        aria-label="Minimum Level"
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
      <span className="LevelMenu-label">≤ Level ≤</span>
      <select
        className="LevelMenu-select"
        value={max}
        onChange={(e) => onChangeMax(Number(e.target.value))}
        aria-label="Maximum Level"
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LevelMenu;
