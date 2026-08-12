import { useEffect, useRef, useState } from 'react';
import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import type { CardInstance } from '../../types/CardInstance';
import './DeckViewer.css';

// Same technique used everywhere else — render each card at native size,
// then scale the wrapper down, rather than a smaller dedicated rendering
// path just for this grid.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.08;
const COLUMNS = 10;

// Same delay-before-hide reasoning as Hand's/FieldZone's context menus —
// without it, the menu (which only renders while hovered) would unmount
// the instant the cursor crosses the small visual gap between the card
// and the menu above it, before it can ever reach the menu.
const MENU_HIDE_DELAY_MS = 150;

export interface DeckViewerAction {
  key: string;
  label: string;
}

interface DeckViewerProps {
  cards: CardInstance[];
  onClose: () => void;
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  // Optional per-card hover menu. Both must be supplied together — when
  // omitted, cards in this viewer are hoverable for Card Display only,
  // with no action menu (e.g. Extra Deck / Grave / Banished viewers,
  // which don't have per-card actions yet).
  getCardActions?: (card: CardData) => DeckViewerAction[];
  onCardAction?: (instanceId: string, actionKey: string) => void;
}

function DeckViewer({
  cards,
  onClose,
  onCardHover,
  onCardHoverEnd,
  getCardActions,
  onCardAction,
}: DeckViewerProps) {
  // Which card (by instanceId) currently shows its context menu.
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  const cancelHide = () => {
    if (hideTimeoutRef.current !== undefined) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }
  };

  const scheduleHide = (instanceId: string) => {
    cancelHide();
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredInstanceId((current) => (current === instanceId ? null : current));
    }, MENU_HIDE_DELAY_MS);
  };

  useEffect(() => () => cancelHide(), []);

  const handleAction = (instanceId: string, actionKey: string) => {
    cancelHide();
    setHoveredInstanceId(null);
    onCardAction?.(instanceId, actionKey);
  };

  return (
    <div className="DeckViewer">
      <div className="DeckViewer-topBar">
        <button type="button" className="DeckViewer-exitButton" onClick={onClose}>
          Exit
        </button>
      </div>

      <div
        className="DeckViewer-grid"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, max-content)` }}
      >
        {cards.map(({ instanceId, card }) => {
          const actions = getCardActions ? getCardActions(card) : [];
          const showMenu = hoveredInstanceId === instanceId && actions.length > 0;

          return (
            <div
              key={instanceId}
              className="DeckViewer-cell"
              style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
              onMouseEnter={() => {
                cancelHide();
                setHoveredInstanceId(instanceId);
                onCardHover?.(card);
              }}
              onMouseLeave={() => {
                scheduleHide(instanceId);
                onCardHoverEnd?.();
              }}
            >
              {showMenu && (
                <div className="DeckViewer-contextMenu">
                  {actions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className="DeckViewer-contextMenuButton"
                      onClick={() => handleAction(instanceId, action.key)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              <div
                className="DeckViewer-cardWrapper"
                style={{
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  transform: `scale(${SCALE})`,
                }}
              >
                <CardImage card={card} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DeckViewer;
