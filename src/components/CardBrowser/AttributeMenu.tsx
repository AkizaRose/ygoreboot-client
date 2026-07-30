import darkIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Dark.png';
import divineIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Divine.png';
import earthIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Earth.png';
import fireIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Fire.png';
import lightIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Light.png';
import waterIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Water.png';
import windIcon from '../../assets/ui/cardbrowser/searchmenu/attribute/Wind.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

// Monster attributes only — Spell/Trap technically share the same
// `attribute` field on card data (used for the card's attribute icon), but
// that's not something a person would filter by, so this list is just the
// seven real monster attributes.
const ATTRIBUTE_OPTIONS: SingleSelectOption[] = [
  { value: 'Dark', label: 'Dark', icon: darkIcon },
  { value: 'Divine', label: 'Divine', icon: divineIcon },
  { value: 'Earth', label: 'Earth', icon: earthIcon },
  { value: 'Fire', label: 'Fire', icon: fireIcon },
  { value: 'Light', label: 'Light', icon: lightIcon },
  { value: 'Water', label: 'Water', icon: waterIcon },
  { value: 'Wind', label: 'Wind', icon: windIcon },
];

interface AttributeMenuProps {
  selected: string | null;
  onSelect: (value: string) => void;
}

function AttributeMenu({ selected, onSelect }: AttributeMenuProps) {
  return <SingleSelectMenu options={ATTRIBUTE_OPTIONS} selected={selected} onSelect={onSelect} />;
}

export default AttributeMenu;
