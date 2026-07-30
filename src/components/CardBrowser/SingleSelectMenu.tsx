import './SingleSelectMenu.css';

export interface SingleSelectOption {
  value: string;
  label: string;
  // Optional: some subclasses (e.g. Normal Spell/Trap) have no dedicated
  // icon asset. An empty icon column is still rendered so the label/
  // checkbox stay aligned with rows that do have one.
  icon?: string;
}

interface SingleSelectMenuProps {
  options: SingleSelectOption[];
  selected: string | null;
  onSelect: (value: string) => void;
}

function SingleSelectMenu({ options, selected, onSelect }: SingleSelectMenuProps) {
  return (
    <div className="SingleSelectMenu">
      {options.map((option) => (
        // display: contents (see SingleSelectMenu.css) promotes the icon/
        // label/checkbox to be direct items of the parent grid, so every
        // row's icon, label, and checkbox line up in the same three
        // columns.
        <label key={option.value} className="SingleSelectMenu-row">
          {option.icon ? (
            <img className="SingleSelectMenu-icon" src={option.icon} alt="" />
          ) : (
            <span className="SingleSelectMenu-icon" />
          )}
          <span className="SingleSelectMenu-label">{option.label}</span>
          <input
            type="checkbox"
            className="SingleSelectMenu-checkbox"
            checked={selected === option.value}
            onChange={() => onSelect(option.value)}
          />
        </label>
      ))}
    </div>
  );
}

export default SingleSelectMenu;
