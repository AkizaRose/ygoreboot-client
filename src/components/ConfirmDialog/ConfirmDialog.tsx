import './ConfirmDialog.css';

interface ConfirmDialogButton {
  label: string;
  onClick: () => void;
}

interface ConfirmDialogProps {
  message: string;
  buttons: ConfirmDialogButton[];
  onDismiss?: () => void;
}

function ConfirmDialog({ message, buttons, onDismiss }: ConfirmDialogProps) {
  return (
    <div className="ConfirmDialog-overlay" onClick={onDismiss}>
      <div className="ConfirmDialog-box" onClick={(e) => e.stopPropagation()}>
        <p className="ConfirmDialog-message">{message}</p>
        <div className="ConfirmDialog-actions">
          {buttons.map((button) => (
            <button
              key={button.label}
              type="button"
              className="ConfirmDialog-button"
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;