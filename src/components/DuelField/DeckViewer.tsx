import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
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

  // Click-to-select — independent of the hover menu above (the Hand
  // Viewer wants this without wanting any menu at all, so the two are
  // deliberately separate props, not bundled together the way
  // getCardActions/onCardAction are).
  onCardClick?: (instanceId: string) => void;

  // Optional per-card selection outline — same 'mine' (red)/'opponent'
  // (blue) convention as CardLayer's own getSelectionColor/selectionColor
  // (see that file), just re-implemented here as its own small inset
  // box-shadow rather than shared code, since these cards render through
  // a completely separate path (a plain grid of CardImage elements, not
  // CardLayer's individually-positioned/animated ones).
  getSelectionColor?: (instanceId: string) => 'mine' | 'opponent' | null;
}

function DeckViewer({
  cards,
  onClose,
  onCardHover,
  onCardHoverEnd,
  getCardActions,
  onCardAction,
  onCardClick,
  getSelectionColor,
}: DeckViewerProps) {
  // Which card (by instanceId) currently shows its context menu.
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);

  // Position of the floating context menu in viewport coordinates.
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
  });

  const gridRef = useRef<HTMLDivElement | null>(null);
  const hoveredCellRef = useRef<HTMLDivElement | null>(null);
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
      setHoveredInstanceId((current) =>
        current === instanceId ? null : current,
      );
    }, MENU_HIDE_DELAY_MS);
  };

  const updateMenuPosition = () => {
    if (!hoveredCellRef.current) {
      return;
    }

    const rect = hoveredCellRef.current.getBoundingClientRect();

    setMenuPosition({
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  };

  useEffect(() => () => cancelHide(), []);

  // Keep the menu attached to the hovered card when the grid is scrolled.
  useEffect(() => {
    const grid = gridRef.current;

    if (!grid || hoveredInstanceId === null) {
      return;
    }

    updateMenuPosition();

    const handleScroll = () => {
      updateMenuPosition();
    };

    grid.addEventListener('scroll', handleScroll);

    return () => {
      grid.removeEventListener('scroll', handleScroll);
    };
  }, [hoveredInstanceId]);

  const handleAction = (instanceId: string, actionKey: string) => {
    cancelHide();
    setHoveredInstanceId(null);
    onCardAction?.(instanceId, actionKey);
  };

  const hoveredCard = cards.find(
    ({ instanceId }) => instanceId === hoveredInstanceId,
  );

  const hoveredActions = hoveredCard && getCardActions
    ? getCardActions(hoveredCard.card)
    : [];

  const showMenu = hoveredInstanceId !== null && hoveredActions.length > 0;

  return (
    <div className="DeckViewer">
      <div className="DeckViewer-topBar">
        <button
          type="button"
          className="DeckViewer-exitButton"
          onClick={onClose}
        >
          Exit
        </button>
      </div>

      <div
        ref={gridRef}
        className="DeckViewer-grid"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, max-content)` }}
      >
        {cards.map(({ instanceId, card }) => {
          const selectionColor = getSelectionColor?.(instanceId) ?? null;
          return (
            <div
              key={instanceId}
              ref={(element) => {
                if (hoveredInstanceId === instanceId) {
                  hoveredCellRef.current = element;
                }
              }}
              className="DeckViewer-cell"
              style={{
                width: CARD_WIDTH * SCALE,
                height: CARD_HEIGHT * SCALE,
                cursor: onCardClick ? 'pointer' : undefined,
              }}
              onClick={onCardClick ? () => onCardClick(instanceId) : undefined}
              onMouseEnter={() => {
                cancelHide();

                const element = document.querySelector(
                  `[data-deck-viewer-instance-id="${instanceId}"]`,
                );

                if (element instanceof HTMLDivElement) {
                  hoveredCellRef.current = element;
                }

                setHoveredInstanceId(instanceId);
                onCardHover?.(card);

                requestAnimationFrame(() => {
                  updateMenuPosition();
                });
              }}
              onMouseLeave={() => {
                scheduleHide(instanceId);
                onCardHoverEnd?.();
              }}
              data-deck-viewer-instance-id={instanceId}
            >
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
              {/* Same 'mine' (red)/'opponent' (blue) inset outline
                  CardLayer draws for a selected field/hand card (see
                  DeckViewerProps' own getSelectionColor comment) — scaled
                  down (1px inset/border, vs. CardLayer's 3px) to stay
                  legible at this grid's own much smaller thumbnail size.
                  Sits outside .DeckViewer-cardWrapper's own scale
                  transform (a sibling, not nested inside it) so this
                  border always renders at a crisp, constant 1-2px
                  regardless of SCALE, rather than being scaled down along
                  with it into an ~0px hairline. */}
              {selectionColor && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 1,
                    pointerEvents: 'none',
                    boxShadow: `inset 0 0 0 2px ${selectionColor === 'mine' ? '#e53935' : '#1e88e5'}`,
                    borderRadius: 2,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {createPortal(
        <AnimatePresence>
          {showMenu && (
            <motion.div
              key="deck-viewer-context-menu"
              style={{
                position: 'fixed',
                left: menuPosition.left,
                top: menuPosition.top,
                transform: 'translate(-50%, calc(-100% - 4px))',
                // Lives here, not in .DeckViewer-contextMenu's own CSS
                // (where it used to be, back when that class was on
                // this same, positioned element) — z-index has no
                // effect at all on the INNER element below, which has
                // no `position` of its own (defaults to static), only
                // on an element that's actually positioned, which this
                // one is.
                zIndex: 9999,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              onMouseEnter={() => {
                cancelHide();
              }}
              onMouseLeave={() => {
                if (hoveredInstanceId !== null) {
                  scheduleHide(hoveredInstanceId);
                }
              }}
            >
              {/* Same reasoning as Hand.tsx's own nested motion.div: the
                  slide lives here, as a plain pixel offset, rather than
                  on the outer element above alongside its own
                  percentage-based translateY(calc(-100% - 4px)) —
                  keeping the two on separate elements means neither
                  has to account for the other. This nested exit
                  animation still plays correctly even though
                  AnimatePresence only directly tracks the OUTER element
                  — exit propagates to descendant motion components
                  automatically. */}
              <motion.div
                className="DeckViewer-contextMenu"
                initial={{ y: 8 }}
                animate={{ y: 0 }}
                exit={{ y: 8 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {hoveredActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="DeckViewer-contextMenuButton"
                    onClick={() =>
                      hoveredInstanceId !== null &&
                      handleAction(hoveredInstanceId, action.key)
                    }
                  >
                    {action.label}
                  </button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export default DeckViewer;
