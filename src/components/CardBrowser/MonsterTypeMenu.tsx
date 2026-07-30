import amphibianIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Amphibian.png';
import beastIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Beast.png';
import dinosaurIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Dinosaur.png';
import divineBeastIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/DivineBeast.png';
import dragonIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Dragon.png';
import electricIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Electric.png';
import fairyIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Fairy.png';
import fiendIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Fiend.png';
import fishIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Fish.png';
import flyingIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Flying.png';
import insectIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Insect.png';
import machineIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Machine.png';
import plantIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Plant.png';
import rockIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Rock.png';
import spellcasterIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Spellcaster.png';
import warriorIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Warrior.png';
import zombieIcon from '../../assets/ui/cardbrowser/searchmenu/monstertype/Zombie.png';
import SingleSelectMenu, { type SingleSelectOption } from './SingleSelectMenu';

const MONSTER_TYPE_OPTIONS: SingleSelectOption[] = [
  { value: 'Amphibian', label: 'Amphibian', icon: amphibianIcon },
  { value: 'Beast', label: 'Beast', icon: beastIcon },
  { value: 'Dinosaur', label: 'Dinosaur', icon: dinosaurIcon },
  { value: 'Divine-Beast', label: 'Divine-Beast', icon: divineBeastIcon },
  { value: 'Dragon', label: 'Dragon', icon: dragonIcon },
  { value: 'Electric', label: 'Electric', icon: electricIcon },
  { value: 'Fairy', label: 'Fairy', icon: fairyIcon },
  { value: 'Fiend', label: 'Fiend', icon: fiendIcon },
  { value: 'Fish', label: 'Fish', icon: fishIcon },
  { value: 'Flying', label: 'Flying', icon: flyingIcon },
  { value: 'Insect', label: 'Insect', icon: insectIcon },
  { value: 'Machine', label: 'Machine', icon: machineIcon },
  { value: 'Plant', label: 'Plant', icon: plantIcon },
  { value: 'Rock', label: 'Rock', icon: rockIcon },
  { value: 'Spellcaster', label: 'Spellcaster', icon: spellcasterIcon },
  { value: 'Warrior', label: 'Warrior', icon: warriorIcon },
  { value: 'Zombie', label: 'Zombie', icon: zombieIcon },
];

interface MonsterTypeMenuProps {
  selected: string | null;
  onSelect: (value: string) => void;
}

function MonsterTypeMenu({ selected, onSelect }: MonsterTypeMenuProps) {
  return (
    <SingleSelectMenu options={MONSTER_TYPE_OPTIONS} selected={selected} onSelect={onSelect} />
  );
}

export default MonsterTypeMenu;
