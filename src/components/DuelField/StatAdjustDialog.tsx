import { useState } from 'react';
import './StatAdjustDialog.css';

const MAX_DIGITS = 5;

interface StatAdjustDialogProps {
  baseAtk: number;
  baseDef: number;
  // The stat currently in effect — equal to base whenever no override
  // has ever been set, which is also why "filled with the base stats by
  // default" and "filled with the current stats" describe the exact
  // same value the very first time this opens on a given monster.
  // Re-opening on an already-adjusted monster shows what it's actually
  // set to right now, not silently reverting to base every time.
  currentAtk: number;
  currentDef: number;
  onConfirm: (atk: number, def: number) => void;
  onCancel: () => void;
  onReset: () => void;
}

// Strips anything non-numeric and caps the length — used for both
// fields identically, on every keystroke, rather than validating once
// on submit. Deliberately allows an empty string through (rather than
// forcing a minimum of one digit) so the field can be fully cleared
// and retyped; Confirm treats an empty field as 0.
function sanitizeDigits(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, MAX_DIGITS);
}

function StatAdjustDialog({
  baseAtk,
  baseDef,
  currentAtk,
  currentDef,
  onConfirm,
  onCancel,
  onReset,
}: StatAdjustDialogProps) {
  const [atkInput, setAtkInput] = useState(String(currentAtk));
  const [defInput, setDefInput] = useState(String(currentDef));

  const handleConfirm = () => {
    onConfirm(atkInput === '' ? 0 : Number(atkInput), defInput === '' ? 0 : Number(defInput));
  };

  return (
    <div className="StatAdjustDialog-overlay">
      <div className="StatAdjustDialog-box">
        <div className="StatAdjustDialog-field">
          <label htmlFor="StatAdjustDialog-atk">ATK</label>
          <input
            id="StatAdjustDialog-atk"
            type="text"
            inputMode="numeric"
            value={atkInput}
            onChange={(e) => setAtkInput(sanitizeDigits(e.target.value))}
          />
        </div>
        <div className="StatAdjustDialog-field">
          <label htmlFor="StatAdjustDialog-def">DEF</label>
          <input
            id="StatAdjustDialog-def"
            type="text"
            inputMode="numeric"
            value={defInput}
            onChange={(e) => setDefInput(sanitizeDigits(e.target.value))}
          />
        </div>
        <div className="StatAdjustDialog-actions">
          <button type="button" onClick={handleConfirm}>
            Confirm
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {/* Base stats passed through purely for a reasonable default
              display value — resetting itself doesn't read atkInput/
              defInput at all, it goes straight to base via onReset. */}
          <button type="button" onClick={onReset} title={`Reset to ${baseAtk}/${baseDef}`}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export default StatAdjustDialog;
