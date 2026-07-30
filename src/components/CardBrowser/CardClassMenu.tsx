import monsterIcon from '../../assets/ui/cardbrowser/searchmenu/cardtype/Monster.png';
import spellIcon from '../../assets/ui/cardbrowser/searchmenu/cardtype/Spell.png';
import trapIcon from '../../assets/ui/cardbrowser/searchmenu/cardtype/Trap.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

const CARD_CLASS_OPTIONS: SingleSelectOption[] = [
  { value: 'Monster', label: 'Monster', icon: monsterIcon },
  { value: 'Spell', label: 'Spell', icon: spellIcon },
  { value: 'Trap', label: 'Trap', icon: trapIcon },
];

interface CardClassMenuProps {
  selected: string | null;
  onSelect: (value: string) => void;
}

function CardClassMenu({ selected, onSelect }: CardClassMenuProps) {
  return <SingleSelectMenu options={CARD_CLASS_OPTIONS} selected={selected} onSelect={onSelect} />;
}

export default CardClassMenu;
