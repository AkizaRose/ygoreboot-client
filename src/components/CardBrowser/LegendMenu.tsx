import legendIcon from '../../assets/card/Legend.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

// Unlike the old Limit menu (three tiers: Limited/Semi-Limited/Unlimited),
// Legend is a single yes/no property on a card — so this is really just
// one checkbox rather than a set of options. Reusing SingleSelectMenu with
// a single entry keeps the visuals (icon/label/checkbox alignment, click
// sound, etc.) consistent with every other filter menu.
//
// Reuses the same Legend.png shown on the card itself, since there's no
// separate dedicated filter-menu icon for it yet.
const LEGEND_OPTIONS: SingleSelectOption[] = [
  { value: 'Legend', label: 'Legend', icon: legendIcon },
];

interface LegendMenuProps {
  selected: string | null;
  onSelect: (value: string) => void;
}

function LegendMenu({ selected, onSelect }: LegendMenuProps) {
  return <SingleSelectMenu options={LEGEND_OPTIONS} selected={selected} onSelect={onSelect} />;
}

export default LegendMenu;
