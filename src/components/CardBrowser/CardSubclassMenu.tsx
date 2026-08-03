import monsterNormalIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/monster/Normal.png';
import monsterEffectIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/monster/Effect.png';
import monsterFusionIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/monster/Fusion.png';
import monsterRitualIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/monster/Ritual.png';
import monsterEvolutionIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/monster/Evolution.png';
import continuousIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Continuous.png';
import counterIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Counter.png';
import equipIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Equip.png';
import normalIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Normal.png';
import fieldIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Field.png';
import spellTrapRitualIcon from '../../assets/ui/cardbrowser/searchmenu/cardsubtype/spelltrap/Ritual.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

const MONSTER_SUBCLASS_OPTIONS: SingleSelectOption[] = [
  { value: 'Normal', label: 'Normal', icon: monsterNormalIcon },
  { value: 'Effect', label: 'Effect', icon: monsterEffectIcon },
  { value: 'Fusion', label: 'Fusion', icon: monsterFusionIcon },
  { value: 'Ritual', label: 'Ritual', icon: monsterRitualIcon },
  { value: 'Evolution', label: 'Evolution', icon: monsterEvolutionIcon },
];

const SPELL_SUBCLASS_OPTIONS: SingleSelectOption[] = [
  { value: 'Normal', label: 'Normal', icon: normalIcon },
  { value: 'Continuous', label: 'Continuous', icon: continuousIcon },
  { value: 'Equip', label: 'Equip', icon: equipIcon },
  { value: 'Field', label: 'Field', icon: fieldIcon },
  { value: 'Ritual', label: 'Ritual', icon: spellTrapRitualIcon },
];

const TRAP_SUBCLASS_OPTIONS: SingleSelectOption[] = [
  { value: 'Normal', label: 'Normal', icon: normalIcon },
  { value: 'Continuous', label: 'Continuous', icon: continuousIcon },
  { value: 'Counter', label: 'Counter', icon: counterIcon },
];

interface CardSubclassMenuProps {
  cardClass: string | null;
  selected: string | null;
  onSelect: (value: string) => void;
}

function CardSubclassMenu({ cardClass, selected, onSelect }: CardSubclassMenuProps) {
  const options =
    cardClass === 'Monster'
      ? MONSTER_SUBCLASS_OPTIONS
      : cardClass === 'Spell'
        ? SPELL_SUBCLASS_OPTIONS
        : cardClass === 'Trap'
          ? TRAP_SUBCLASS_OPTIONS
          : [];

  // Shouldn't normally happen — the Card Subclass button is disabled
  // whenever no Card Class is selected — but bail out cleanly just in case.
  if (options.length === 0) return null;

  return <SingleSelectMenu options={options} selected={selected} onSelect={onSelect} />;
}

export default CardSubclassMenu;
