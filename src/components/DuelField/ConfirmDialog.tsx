import './ConfirmDialog.css';

interface ConfirmDialogButton {
  label: string;
  onClick: () => void;
}

interface ConfirmDialogProps {
  message: string;
  // Exactly the buttons to show, left to right — no inference from any
  // other prop's presence or absence, so there's no ambiguity about how
  // many buttons render. A single entry renders as a persistent,
  // single "OK"-style button; two entries render as a Yes/No-style (or
  // Accept/Decline-style, etc.) pair.
  buttons: ConfirmDialogButton[];
  // Backdrop-click dismiss — omit entirely for a dialog that should
  // persist until its own button is actually clicked (a single-button
  // dialog in particular should almost always omit this).
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