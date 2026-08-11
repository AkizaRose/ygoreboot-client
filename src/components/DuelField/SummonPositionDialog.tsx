import atkPositionImg from '../../assets/ui/duelfield/atkposition.png';
import defPositionImg from '../../assets/ui/duelfield/defposition.png';
import './SummonPositionDialog.css';

interface SummonPositionDialogProps {
  onSelectAttack: () => void;
  onSelectDefense: () => void;
}

// Deliberately no backdrop-dismiss/cancel here (unlike ConfirmDialog) —
// once a summon action has gotten this far (an empty Monster Zone slot
// was already confirmed to exist), a position must actually be chosen
// to complete it; there's no "back out" state to return to.
function SummonPositionDialog({ onSelectAttack, onSelectDefense }: SummonPositionDialogProps) {
  return (
    <div className="SummonPositionDialog-overlay">
      <div className="SummonPositionDialog-box">
        <button
          type="button"
          className="SummonPositionDialog-button"
          onClick={onSelectAttack}
        >
          <img src={atkPositionImg} alt="Attack Position" />
        </button>
        <button
          type="button"
          className="SummonPositionDialog-button"
          onClick={onSelectDefense}
        >
          <img src={defPositionImg} alt="Defense Position" />
        </button>
      </div>
    </div>
  );
}

export default SummonPositionDialog;
