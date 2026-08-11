import { useEffect, useRef, useState } from 'react';
import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import cardBackImg from '../../assets/card/CardBack.png';
import './FieldZone.css';

// Matches the zone box's own size (see .FieldZone in FieldZone.css) —
// deriving the scale from these rather than hardcoding a scale factor
// means a face-up card always fills the zone exactly, even if the box
// size changes later.
const ZONE_WIDTH = 72;
const ZONE_HEIGHT = 105;
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const CARD_SCALE = ZONE_WIDTH / CARD_WIDTH;

// Same delay-before-hide reasoning as Hand's context menu — without it,
// the menu (which only renders while hovered) would unmount the instant
// the cursor crosses the small visual gap between the card and the menu
// above it, before it can ever reach the menu.
const MENU_HIDE_DELAY_MS = 150;

export interface FieldZoneAction {
  key: string;
  label: string;
}

interface FieldZoneProps {
  label: string;
  // A card placed in this zone (e.g. a Normal Summoned monster, or a Set
  // Spell/Trap). Takes priority over `image` if both are somehow given.
  card?: CardData;
  // Whether `card` is showing face-down (Set) rather than face-up. Only
  // affects what's visually rendered — hover still reports the real
  // card, so the player can check what they've Set via Card Display.
  faceDown?: boolean;
  // When provided (and no `card`), the zone renders as a face-down pile
  // (image + count) instead of a plain text label — used for Main Deck /
  // Extra Deck once real deck data has been loaded.
  image?: string;
  count?: number;
  onClick?: () => void;
  // Only relevant when `card` is present — reports the real card
  // regardless of faceDown, so Card Display can reveal it even though
  // the field itself shows a card back. Never fires for pile content
  // (image), since a face-down pile has no single card to reveal.
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  // The 5 field-card actions, or "View" for Main/Extra Deck — see
  // DuelField.tsx for which one gets passed where.
  menuActions?: FieldZoneAction[];
  onMenuAction?: (actionKey: string) => void;
  // A visual guide for Defense Position: a copy of this zone's own box,
  // rotated -90° around its center, showing how much extra width a
  // rotated (Defense Position) card would occupy. Purely decorative for
  // now — only ever passed for Monster Zones.
  showRotatedOverlay?: boolean;
  // Only meaningful for face-up Monster Zone cards. 'defense' rotates
  // the actual card -90° to align with the overlay above; 'attack' (or
  // omitted) renders it upright, unrotated.
  battlePosition?: 'attack' | 'defense';
}

function FieldZone({
  label,
  card,
  faceDown = false,
  image,
  count,
  onClick,
  onCardHover,
  onCardHoverEnd,
  menuActions,
  onMenuAction,
  showRotatedOverlay = false,
  battlePosition = 'attack',
}: FieldZoneProps) {
  const [showMenu, setShowMenu] = useState(false);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  const hasContent = !!card || !!image;
  const menuEnabled = hasContent && !!menuActions && menuActions.length > 0;

  const cancelHide = () => {
    if (hideTimeoutRef.current !== undefined) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimeoutRef.current = window.setTimeout(() => {
      setShowMenu(false);
    }, MENU_HIDE_DELAY_MS);
  };

  useEffect(() => () => cancelHide(), []);

  const handleMouseEnter = () => {
    cancelHide();
    if (menuEnabled) setShowMenu(true);
    if (card) onCardHover?.(card);
  };

  const handleMouseLeave = () => {
    scheduleHide();
    if (card) onCardHoverEnd?.();
  };

  const handleAction = (event: React.MouseEvent, actionKey: string) => {
    // Stops this click from also bubbling up to the zone's own onClick —
    // matters for Main Deck, which has both "click to draw" AND a menu
    // with a "View" action; without this, clicking View would also draw
    // a card.
    event.stopPropagation();
    cancelHide();
    setShowMenu(false);
    onMenuAction?.(actionKey);
  };

  return (
    <div
      className={onClick ? 'FieldZone FieldZone--clickable' : 'FieldZone'}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {menuEnabled && showMenu && (
        <div className="FieldZone-contextMenu">
          {menuActions!.map((action) => (
            <button
              key={action.key}
              type="button"
              className="FieldZone-contextMenuButton"
              onClick={(e) => handleAction(e, action.key)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {showRotatedOverlay && (
        <div
          className="FieldZone-rotatedOverlay"
          style={{ width: ZONE_WIDTH, height: ZONE_HEIGHT }}
        />
      )}
      {card && !faceDown ? (
        <div
          className="FieldZone-cardOuter"
          style={{
            width: ZONE_WIDTH,
            height: ZONE_HEIGHT,
            transform: battlePosition === 'defense' ? 'rotate(-90deg)' : undefined,
          }}
        >
          <div
            className="FieldZone-cardWrapper"
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              transform: `scale(${CARD_SCALE})`,
            }}
          >
            <CardImage card={card} />
          </div>
        </div>
      ) : card && faceDown ? (
        <div className="FieldZone-pile">
          <img className="FieldZone-pileImage" src={cardBackImg} alt="" />
        </div>
      ) : image ? (
        <div className="FieldZone-pile">
          <img className="FieldZone-pileImage" src={image} alt={label} />
          {count != null && <span className="FieldZone-pileCount">{count}</span>}
        </div>
      ) : (
        <span className="FieldZone-label">{label}</span>
      )}
      {card && count != null && <span className="FieldZone-pileCount">{count}</span>}
    </div>
  );
}

export default FieldZone;
