import limitedIcon from '../../assets/ui/cardbrowser/searchmenu/limit/1.png';
import semiLimitedIcon from '../../assets/ui/cardbrowser/searchmenu/limit/2.png';
import unlimitedIcon from '../../assets/ui/cardbrowser/searchmenu/limit/3.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

// card.limit is a number (1/2/3); SingleSelectMenu works in string values,
// so these are converted back to a number at filter time in CardBrowser.
const LIMIT_OPTIONS: SingleSelectOption[] = [
  { value: '1', label: 'Limited', icon: limitedIcon },
  { value: '2', label: 'Semi-Limited', icon: semiLimitedIcon },
  { value: '3', label: 'Unlimited', icon: unlimitedIcon },
];

interface LimitMenuProps {
  selected: string | null;
  onSelect: (value: string) => void;
}

function LimitMenu({ selected, onSelect }: LimitMenuProps) {
  return <SingleSelectMenu options={LIMIT_OPTIONS} selected={selected} onSelect={onSelect} />;
}

export default LimitMenu;
