import './ConfirmDialog.css';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="ConfirmDialog-overlay" onClick={onCancel}>
      <div className="ConfirmDialog-box" onClick={(e) => e.stopPropagation()}>
        <p className="ConfirmDialog-message">{message}</p>
        <div className="ConfirmDialog-actions">
          <button type="button" className="ConfirmDialog-button" onClick={onConfirm}>
            Yes
          </button>
          <button type="button" className="ConfirmDialog-button" onClick={onCancel}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
