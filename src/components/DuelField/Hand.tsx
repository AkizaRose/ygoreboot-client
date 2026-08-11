import { useEffect, useRef, useState } from 'react';
import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import './Hand.css';

const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.1;

// How long to wait before actually hiding the menu after the cursor
// leaves. Without this, the menu (which only renders while hovered)
// unmounts the instant the cursor crosses the small visual gap between
// the card and the menu above it — before it can ever reach the menu.
const MENU_HIDE_DELAY_MS = 150;

interface HandAction {
  key: string;
  label: string;
}

// Which actions are available for a given card. Class-specific ones
// (Normal Summon, Activate, Set) come first, followed by the universal
// ones every card gets regardless of class — structured as a list
// (rather than separate flags) so more actions can be added here later
// without changing how the menu itself renders.
function getHandActions(card: CardData): HandAction[] {
  const actions: HandAction[] = [];

  const isNormalOrEffectMonster =
    card.cardClass === 'Monster' &&
    (card.cardSubclass === 'Normal' || card.cardSubclass === 'Effect');

  if (isNormalOrEffectMonster) {
    actions.push({ key: 'normalSummon', label: 'Normal Summon' });
  }

  if (card.cardClass === 'Spell') {
    actions.push({ key: 'activate', label: 'Activate' }, { key: 'set', label: 'Set' });
  }

  if (card.cardClass === 'Trap') {
    actions.push({ key: 'set', label: 'Set' });
  }

  actions.push(
    { key: 'toGrave', label: 'To Grave' },
    { key: 'banish', label: 'Banish' },
    { key: 'stackTop', label: 'Stack (to top)' },
    { key: 'stackBottom', label: 'Stack (to bottom)' },
  );

  return actions;
}

interface HandProps {
  cards: CardData[];
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  onNormalSummon: (index: number) => void;
  onActivateSpell: (index: number) => void;
  onSetSpellOrTrap: (index: number) => void;
  onToGrave: (index: number) => void;
  onBanish: (index: number) => void;
  onStackTop: (index: number) => void;
  onStackBottom: (index: number) => void;
}

function Hand({
  cards,
  onCardHover,
  onCardHoverEnd,
  onNormalSummon,
  onActivateSpell,
  onSetSpellOrTrap,
  onToGrave,
  onBanish,
  onStackTop,
  onStackBottom,
}: HandProps) {
  // Which hand card (by index) currently shows its context menu — a
  // separate concern from the CardDisplay hover callbacks above, though
  // both are driven by the same mouseenter/mouseleave.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  const cancelHide = () => {
    if (hideTimeoutRef.current !== undefined) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = undefined;
    }
  };

  const scheduleHide = (index: number) => {
    cancelHide();
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredIndex((current) => (current === index ? null : current));
    }, MENU_HIDE_DELAY_MS);
  };

  useEffect(() => () => cancelHide(), []);

  const handleAction = (index: number, actionKey: string) => {
    cancelHide();
    switch (actionKey) {
      case 'normalSummon':
        onNormalSummon(index);
        break;
      case 'activate':
        onActivateSpell(index);
        break;
      case 'set':
        onSetSpellOrTrap(index);
        break;
      case 'toGrave':
        onToGrave(index);
        break;
      case 'banish':
        onBanish(index);
        break;
      case 'stackTop':
        onStackTop(index);
        break;
      case 'stackBottom':
        onStackBottom(index);
        break;
    }
    setHoveredIndex(null);
  };

  return (
    <div className="Hand">
      {cards.map((card, i) => {
        const actions = getHandActions(card);
        const showMenu = hoveredIndex === i && actions.length > 0;

        return (
          <div
            key={i}
            className="Hand-cell"
            style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
            onMouseEnter={() => {
              cancelHide();
              setHoveredIndex(i);
              onCardHover?.(card);
            }}
            onMouseLeave={() => {
              scheduleHide(i);
              onCardHoverEnd?.();
            }}
          >
            {showMenu && (
              <div className="Hand-contextMenu">
                {actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="Hand-contextMenuButton"
                    onClick={() => handleAction(i, action.key)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            <div
              className="Hand-cardWrapper"
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
  );
}

export default Hand;
