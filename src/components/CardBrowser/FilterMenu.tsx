import { useEffect, useState } from 'react';
import applyIcon from '../../assets/ui/cardbrowser/searchfilters/apply.png';
import applyHoverIcon from '../../assets/ui/cardbrowser/searchfilters/apply_hover.png';
import applyClickIcon from '../../assets/ui/cardbrowser/searchfilters/apply_click.png';
import resetIcon from '../../assets/ui/cardbrowser/searchfilters/reset.png';
import resetHoverIcon from '../../assets/ui/cardbrowser/searchfilters/reset_hover.png';
import resetClickIcon from '../../assets/ui/cardbrowser/searchfilters/reset_click.png';
import cardClassIcon from '../../assets/ui/cardbrowser/searchfilters/cardclass.png';
import cardClassHoverIcon from '../../assets/ui/cardbrowser/searchfilters/cardclass_hover.png';
import cardClassClickIcon from '../../assets/ui/cardbrowser/searchfilters/cardclass_click.png';
import cardSubclassIcon from '../../assets/ui/cardbrowser/searchfilters/cardsubclass.png';
import cardSubclassHoverIcon from '../../assets/ui/cardbrowser/searchfilters/cardsubclass_hover.png';
import cardSubclassClickIcon from '../../assets/ui/cardbrowser/searchfilters/cardsubclass_click.png';
import cardSubclassUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/cardsubclass_unselectable.png';
import attributeIcon from '../../assets/ui/cardbrowser/searchfilters/attribute.png';
import attributeHoverIcon from '../../assets/ui/cardbrowser/searchfilters/attribute_hover.png';
import attributeClickIcon from '../../assets/ui/cardbrowser/searchfilters/attribute_click.png';
import attributeUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/attribute_unselectable.png';
import monsterTypeIcon from '../../assets/ui/cardbrowser/searchfilters/monstertype.png';
import monsterTypeHoverIcon from '../../assets/ui/cardbrowser/searchfilters/monstertype_hover.png';
import monsterTypeClickIcon from '../../assets/ui/cardbrowser/searchfilters/monstertype_click.png';
import monsterTypeUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/monstertype_unselectable.png';
import levelIcon from '../../assets/ui/cardbrowser/searchfilters/level.png';
import levelHoverIcon from '../../assets/ui/cardbrowser/searchfilters/level_hover.png';
import levelClickIcon from '../../assets/ui/cardbrowser/searchfilters/level_click.png';
import levelUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/level_unselectable.png';
import atkIcon from '../../assets/ui/cardbrowser/searchfilters/atk.png';
import atkHoverIcon from '../../assets/ui/cardbrowser/searchfilters/atk_hover.png';
import atkClickIcon from '../../assets/ui/cardbrowser/searchfilters/atk_click.png';
import atkUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/atk_unselectable.png';
import defIcon from '../../assets/ui/cardbrowser/searchfilters/def.png';
import defHoverIcon from '../../assets/ui/cardbrowser/searchfilters/def_hover.png';
import defClickIcon from '../../assets/ui/cardbrowser/searchfilters/def_click.png';
import defUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/def_unselectable.png';
import limitIcon from '../../assets/ui/cardbrowser/searchfilters/limit.png';
import limitHoverIcon from '../../assets/ui/cardbrowser/searchfilters/limit_hover.png';
import limitClickIcon from '../../assets/ui/cardbrowser/searchfilters/limit_click.png';
import IconButton from './IconButton';
import CardClassMenu from './CardClassMenu';
import CardSubclassMenu from './CardSubclassMenu';
import AttributeMenu from './AttributeMenu';
import MonsterTypeMenu from './MonsterTypeMenu';
import LevelMenu from './LevelMenu';
import StatRangeMenu from './StatRangeMenu';
import LimitMenu from './LimitMenu';
import './FilterMenu.css';

// What has to be true in Card Class for a given filter button to be usable:
//   'none'      - always enabled (Card Class itself, Limit)
//   'cardClass' - enabled once any Card Class is selected (Card Subclass)
//   'monster'   - enabled only when Card Class is specifically Monster
//                 (Attribute, Monster Type, Level, ATK, DEF)
type FilterRequirement = 'none' | 'cardClass' | 'monster';

interface FilterButtonConfig {
  key: string;
  label: string;
  tooltip: string;
  icon: string;
  hoverIcon: string;
  clickIcon: string;
  unselectableIcon?: string;
  requirement: FilterRequirement;
}

// 4x2 grid, in source order (grid auto-placement fills left-to-right,
// top-to-bottom across the 4 columns defined in FilterMenu.css):
//   Card Class, Card Subclass, Attribute, Monster Type
//   Level, ATK, DEF, Limit
const FILTER_GRID: FilterButtonConfig[] = [
  {
    key: 'cardClass',
    label: 'Card Class',
    tooltip: 'Card Type',
    icon: cardClassIcon,
    hoverIcon: cardClassHoverIcon,
    clickIcon: cardClassClickIcon,
    requirement: 'none',
  },
  {
    key: 'cardSubclass',
    label: 'Card Subclass',
    tooltip: 'Card Subtype',
    icon: cardSubclassIcon,
    hoverIcon: cardSubclassHoverIcon,
    clickIcon: cardSubclassClickIcon,
    unselectableIcon: cardSubclassUnselectableIcon,
    requirement: 'cardClass',
  },
  {
    key: 'attribute',
    label: 'Attribute',
    tooltip: 'Attribute',
    icon: attributeIcon,
    hoverIcon: attributeHoverIcon,
    clickIcon: attributeClickIcon,
    unselectableIcon: attributeUnselectableIcon,
    requirement: 'monster',
  },
  {
    key: 'monsterType',
    label: 'Monster Type',
    tooltip: 'Type',
    icon: monsterTypeIcon,
    hoverIcon: monsterTypeHoverIcon,
    clickIcon: monsterTypeClickIcon,
    unselectableIcon: monsterTypeUnselectableIcon,
    requirement: 'monster',
  },
  {
    key: 'level',
    label: 'Level',
    tooltip: 'Level',
    icon: levelIcon,
    hoverIcon: levelHoverIcon,
    clickIcon: levelClickIcon,
    unselectableIcon: levelUnselectableIcon,
    requirement: 'monster',
  },
  {
    key: 'atk',
    label: 'ATK',
    tooltip: 'ATK',
    icon: atkIcon,
    hoverIcon: atkHoverIcon,
    clickIcon: atkClickIcon,
    unselectableIcon: atkUnselectableIcon,
    requirement: 'monster',
  },
  {
    key: 'def',
    label: 'DEF',
    tooltip: 'DEF',
    icon: defIcon,
    hoverIcon: defHoverIcon,
    clickIcon: defClickIcon,
    unselectableIcon: defUnselectableIcon,
    requirement: 'monster',
  },
  {
    key: 'limit',
    label: 'Limit',
    tooltip: 'Limit',
    icon: limitIcon,
    hoverIcon: limitHoverIcon,
    clickIcon: limitClickIcon,
    requirement: 'none',
  },
];

function isRequirementMet(requirement: FilterRequirement, selectedCardClass: string | null) {
  switch (requirement) {
    case 'cardClass':
      return !!selectedCardClass;
    case 'monster':
      return selectedCardClass === 'Monster';
    case 'none':
    default:
      return true;
  }
}

// Only these have a submenu built so far; the rest are wired up one at a
// time. Buttons without an entry here just don't open anything yet.
const SUBMENU_KEYS = new Set([
  'cardClass',
  'cardSubclass',
  'attribute',
  'monsterType',
  'level',
  'atk',
  'def',
  'limit',
]);

interface FilterMenuProps {
  onApply: () => void;
  onReset: () => void;
  selectedCardClass: string | null;
  onSelectCardClass: (value: string) => void;
  selectedCardSubclass: string | null;
  onSelectCardSubclass: (value: string) => void;
  selectedAttribute: string | null;
  onSelectAttribute: (value: string) => void;
  selectedMonsterType: string | null;
  onSelectMonsterType: (value: string) => void;
  levelMin: number;
  levelMax: number;
  onChangeLevelMin: (value: number) => void;
  onChangeLevelMax: (value: number) => void;
  atkMin: string;
  atkMax: string;
  onChangeAtkMin: (value: string) => void;
  onChangeAtkMax: (value: string) => void;
  defMin: string;
  defMax: string;
  onChangeDefMin: (value: string) => void;
  onChangeDefMax: (value: string) => void;
  selectedLimit: string | null;
  onSelectLimit: (value: string) => void;
}

function FilterMenu({
  onApply,
  onReset,
  selectedCardClass,
  onSelectCardClass,
  selectedCardSubclass,
  onSelectCardSubclass,
  selectedAttribute,
  onSelectAttribute,
  selectedMonsterType,
  onSelectMonsterType,
  levelMin,
  levelMax,
  onChangeLevelMin,
  onChangeLevelMax,
  atkMin,
  atkMax,
  onChangeAtkMin,
  onChangeAtkMax,
  defMin,
  defMax,
  onChangeDefMin,
  onChangeDefMax,
  selectedLimit,
  onSelectLimit,
}: FilterMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  // If Card Class changes in a way that makes the currently-open submenu's
  // requirement no longer met (e.g. switching away from Monster while
  // Attribute is open, or clearing Card Class while Card Subclass is open),
  // back out of it automatically.
  useEffect(() => {
    if (!activeSubmenu) return;
    const activeButton = FILTER_GRID.find((button) => button.key === activeSubmenu);
    if (activeButton && !isRequirementMet(activeButton.requirement, selectedCardClass)) {
      setActiveSubmenu(null);
    }
  }, [selectedCardClass, activeSubmenu]);

  return (
    <div className="FilterMenu">
      <div className="FilterMenu-grid">
        <IconButton
          icon={applyIcon}
          hoverIcon={applyHoverIcon}
          clickIcon={applyClickIcon}
          alt="Apply"
          title="Apply"
          className="FilterMenu-actionButton"
          onClick={onApply}
        />
        <IconButton
          icon={resetIcon}
          hoverIcon={resetHoverIcon}
          clickIcon={resetClickIcon}
          alt="Reset"
          title="Reset"
          className="FilterMenu-actionButton"
          onClick={onReset}
        />

        <div className="FilterMenu-separator" />

        {FILTER_GRID.map((button) => {
          const enabled = isRequirementMet(button.requirement, selectedCardClass);
          const icon = !enabled && button.unselectableIcon ? button.unselectableIcon : button.icon;
          const isClickable = SUBMENU_KEYS.has(button.key) && enabled;

          return (
            <div key={button.key} className="FilterMenu-buttonSlot">
              <IconButton
                icon={icon}
                hoverIcon={button.hoverIcon}
                clickIcon={button.clickIcon}
                alt={button.label}
                title={button.tooltip}
                className="FilterMenu-button"
                disabled={!enabled}
                ariaPressed={activeSubmenu === button.key}
                onClick={
                  isClickable
                    ? () =>
                        setActiveSubmenu((current) =>
                          current === button.key ? null : button.key,
                        )
                    : undefined
                }
              />
            </div>
          );
        })}

        <div className="FilterMenu-separator" />
      </div>

      <div className="FilterMenu-submenu">
        {activeSubmenu === 'cardClass' && (
          <CardClassMenu selected={selectedCardClass} onSelect={onSelectCardClass} />
        )}
        {activeSubmenu === 'cardSubclass' && (
          <CardSubclassMenu
            cardClass={selectedCardClass}
            selected={selectedCardSubclass}
            onSelect={onSelectCardSubclass}
          />
        )}
        {activeSubmenu === 'attribute' && (
          <AttributeMenu selected={selectedAttribute} onSelect={onSelectAttribute} />
        )}
        {activeSubmenu === 'monsterType' && (
          <MonsterTypeMenu selected={selectedMonsterType} onSelect={onSelectMonsterType} />
        )}
        {activeSubmenu === 'level' && (
          <LevelMenu
            min={levelMin}
            max={levelMax}
            onChangeMin={onChangeLevelMin}
            onChangeMax={onChangeLevelMax}
          />
        )}
        {activeSubmenu === 'atk' && (
          <StatRangeMenu
            label="ATK"
            min={atkMin}
            max={atkMax}
            onChangeMin={onChangeAtkMin}
            onChangeMax={onChangeAtkMax}
          />
        )}
        {activeSubmenu === 'def' && (
          <StatRangeMenu
            label="DEF"
            min={defMin}
            max={defMax}
            onChangeMin={onChangeDefMin}
            onChangeMax={onChangeDefMax}
          />
        )}
        {activeSubmenu === 'limit' && (
          <LimitMenu selected={selectedLimit} onSelect={onSelectLimit} />
        )}
      </div>
    </div>
  );
}

export default FilterMenu;
