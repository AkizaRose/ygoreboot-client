import { useState } from 'react';
import { SLEEVE_OPTIONS, getSleeveUrl } from './sleeves';
import { useUserSleeve } from './useUserSleeve';
import './SleeveSelector.css';

// Mirrors AvatarSelector.tsx exactly — same box-that-opens-an-overlay-
// grid pattern, same save/cancel/error handling — just for the user's
// own card back (see useUserSleeve/sleeves.ts for the storage side of
// this). The box itself is card-shaped (see SleeveSelector.css) rather
// than square, since that's what it's actually previewing.
function SleeveSelector() {
  const { sleeveId, setSleeveId } = useUserSleeve();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => {
    setError(null);
    setIsPickerOpen(true);
  };

  const handleSelect = async (newSleeveId: string) => {
    if (newSleeveId === sleeveId) {
      setIsPickerOpen(false);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await setSleeveId(newSleeveId);
      setIsPickerOpen(false);
    } catch (err) {
      console.error('[SleeveSelector] Failed to save card back selection:', err);
      setError('Could not save your card back. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="SleeveSelector-box"
        onClick={openPicker}
        aria-label="Change card back"
      >
        <img src={getSleeveUrl(sleeveId)} alt="Your card back" className="SleeveSelector-image" />
      </button>

      {isPickerOpen && (
        <div className="SleeveSelector-overlay" onClick={() => setIsPickerOpen(false)}>
          <div className="SleeveSelector-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="SleeveSelector-title">Choose a Card Back</h2>
            <div className="SleeveSelector-grid">
              {SLEEVE_OPTIONS.map((sleeve) => (
                <button
                  key={sleeve.id}
                  type="button"
                  className={
                    sleeve.id === sleeveId
                      ? 'SleeveSelector-option SleeveSelector-option--selected'
                      : 'SleeveSelector-option'
                  }
                  onClick={() => handleSelect(sleeve.id)}
                  disabled={isSaving}
                >
                  <img src={sleeve.url} alt={sleeve.id} className="SleeveSelector-optionImage" />
                </button>
              ))}
            </div>
            {error && <p className="SleeveSelector-error">{error}</p>}
            <button
              type="button"
              className="SleeveSelector-closeButton"
              onClick={() => setIsPickerOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default SleeveSelector;
