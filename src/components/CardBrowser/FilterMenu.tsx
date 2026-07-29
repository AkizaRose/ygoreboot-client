import applyIcon from '../../assets/ui/cardbrowser/searchfilters/apply.png';
import resetIcon from '../../assets/ui/cardbrowser/searchfilters/reset.png';
import cardClassIcon from '../../assets/ui/cardbrowser/searchfilters/cardclass.png';
import cardSubclassIcon from '../../assets/ui/cardbrowser/searchfilters/cardsubclass.png';
import attributeIcon from '../../assets/ui/cardbrowser/searchfilters/attribute.png';
import monsterTypeIcon from '../../assets/ui/cardbrowser/searchfilters/monstertype.png';
import levelIcon from '../../assets/ui/cardbrowser/searchfilters/level.png';
import atkIcon from '../../assets/ui/cardbrowser/searchfilters/atk.png';
import defIcon from '../../assets/ui/cardbrowser/searchfilters/def.png';
import limitIcon from '../../assets/ui/cardbrowser/searchfilters/limit.png';
import './FilterMenu.css';

interface FilterButtonConfig {
  key: string;
  label: string;
  icon: string;
}

// 4x2 grid, in source order (grid auto-placement fills left-to-right,
// top-to-bottom across the 4 columns defined in FilterMenu.css):
//   Card Class, Card Subclass, Attribute, Monster Type
//   Level, ATK, DEF, Limit
const FILTER_GRID: FilterButtonConfig[] = [
  { key: 'cardClass', label: 'Card Class', icon: cardClassIcon },
  { key: 'cardSubclass', label: 'Card Subclass', icon: cardSubclassIcon },
  { key: 'attribute', label: 'Attribute', icon: attributeIcon },
  { key: 'monsterType', label: 'Monster Type', icon: monsterTypeIcon },
  { key: 'level', label: 'Level', icon: levelIcon },
  { key: 'atk', label: 'ATK', icon: atkIcon },
  { key: 'def', label: 'DEF', icon: defIcon },
  { key: 'limit', label: 'Limit', icon: limitIcon },
];

interface FilterMenuProps {
  onApply: () => void;
  onReset: () => void;
}

function FilterMenu({ onApply, onReset }: FilterMenuProps) {
  return (
    <div className="FilterMenu">
      <div className="FilterMenu-grid">
        <button
          type="button"
          className="FilterMenu-actionButton"
          onClick={onApply}
          aria-label="Apply"
        >
          <img src={applyIcon} alt="Apply" />
        </button>
        <button
          type="button"
          className="FilterMenu-actionButton"
          onClick={onReset}
          aria-label="Reset"
        >
          <img src={resetIcon} alt="Reset" />
        </button>

        <div className="FilterMenu-separator" />

        {FILTER_GRID.map((button) => (
          <div key={button.key} className="FilterMenu-buttonSlot">
            <button type="button" className="FilterMenu-button" aria-label={button.label}>
              <img src={button.icon} alt={button.label} />
            </button>
          </div>
        ))}

        <div className="FilterMenu-separator" />

      </div>
    </div>
  );
}

export default FilterMenu;
