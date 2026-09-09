import { useState } from 'react';
import { AVATAR_OPTIONS, getAvatarUrl } from './avatars';
import { useUserAvatar } from './useUserAvatar';
import './AvatarSelector.css';

function AvatarSelector() {
  const { avatarId, setAvatarId } = useUserAvatar();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPicker = () => {
    setError(null);
    setIsPickerOpen(true);
  };

  const handleSelect = async (newAvatarId: string) => {
    if (newAvatarId === avatarId) {
      setIsPickerOpen(false);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await setAvatarId(newAvatarId);
      setIsPickerOpen(false);
    } catch (err) {
      console.error('[AvatarSelector] Failed to save avatar selection:', err);
      setError('Could not save your avatar. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="AvatarSelector-box"
        onClick={openPicker}
        aria-label="Change avatar"
      >
        <img src={getAvatarUrl(avatarId)} alt="Your avatar" className="AvatarSelector-image" />
      </button>

      {isPickerOpen && (
        <div className="AvatarSelector-overlay" onClick={() => setIsPickerOpen(false)}>
          <div className="AvatarSelector-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="AvatarSelector-title">Choose an Avatar</h2>
            <div className="AvatarSelector-grid">
              {AVATAR_OPTIONS.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  className={
                    avatar.id === avatarId
                      ? 'AvatarSelector-option AvatarSelector-option--selected'
                      : 'AvatarSelector-option'
                  }
                  onClick={() => handleSelect(avatar.id)}
                  disabled={isSaving}
                >
                  <img src={avatar.url} alt={avatar.id} className="AvatarSelector-optionImage" />
                </button>
              ))}
            </div>
            {error && <p className="AvatarSelector-error">{error}</p>}
            <button
              type="button"
              className="AvatarSelector-closeButton"
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

export default AvatarSelector;
