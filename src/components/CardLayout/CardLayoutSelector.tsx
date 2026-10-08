import { useState } from 'react';
import { CARD_LAYOUT_OPTIONS, type CardLayoutId } from './cardLayouts';
import { useCardLayout } from './CardLayoutContext';
import './CardLayoutSelector.css';

// The two layout previews (src/assets/ui/cardlayoutselect/) side by side —
// clicking one saves it as this user's card layout (see
// CardLayoutProvider for the storage side, and for why it applies to
// every card image this user sees, theirs and their opponent's alike).
// Rendered inside an AccountPage-box by AccountPage.tsx.
function CardLayoutSelector() {
  const { layout, setCardLayout } = useCardLayout();
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (newLayout: CardLayoutId) => {
    if (newLayout === layout) return;
    setError(null);
    try {
      await setCardLayout(newLayout);
    } catch (err) {
      console.error('[CardLayoutSelector] Failed to save card layout selection:', err);
      setError('Could not save your card layout. Please try again.');
    }
  };

  return (
    <>
      <div className="CardLayoutSelector-options">
        {CARD_LAYOUT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              option.id === layout
                ? 'CardLayoutSelector-option CardLayoutSelector-option--selected'
                : 'CardLayoutSelector-option'
            }
            onClick={() => handleSelect(option.id)}
            aria-pressed={option.id === layout}
          >
            <img
              src={option.previewUrl}
              alt={`${option.label} card layout`}
              className="CardLayoutSelector-image"
            />
            <span className="CardLayoutSelector-label">{option.label}</span>
          </button>
        ))}
      </div>
      {error && <p className="CardLayoutSelector-error">{error}</p>}
    </>
  );
}

export default CardLayoutSelector;
