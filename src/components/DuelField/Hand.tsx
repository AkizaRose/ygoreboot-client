import { useEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import type { CardInstance } from '../../types/CardInstance';
import { getHandSlot } from '../../duel/cardGeometry';
import './Hand.css';

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
    actions.push({ key: 'normalSummon', label: 'N. Summon' });
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
    { key: 'stackTop', label: 'To T. Deck' },
    { key: 'stackBottom', label: 'To B. Deck' },
  );

  return actions;
}

interface HandProps {
  cards: CardInstance[];
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  onNormalSummon: (instanceId: string) => void;
  onActivateSpell: (instanceId: string) => void;
  onSetSpellOrTrap: (instanceId: string) => void;
  onToGrave: (instanceId: string) => void;
  onBanish: (instanceId: string) => void;
  onStackTop: (instanceId: string) => void;
  onStackBottom: (instanceId: string) => void;
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
  // Which hand card (by instanceId) currently shows its context menu —
  // a separate concern from the CardDisplay hover callbacks above,
  // though both are driven by the same mouseenter/mouseleave.
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
    switch (actionKey) {
      case 'normalSummon':
        onNormalSummon(instanceId);
        break;
      case 'activate':
        onActivateSpell(instanceId);
        break;
      case 'set':
        onSetSpellOrTrap(instanceId);
        break;
      case 'toGrave':
        onToGrave(instanceId);
        break;
      case 'banish':
        onBanish(instanceId);
        break;
      case 'stackTop':
        onStackTop(instanceId);
        break;
      case 'stackBottom':
        onStackBottom(instanceId);
        break;
    }
    setHoveredInstanceId(null);
  };

  const hoveredIndex = cards.findIndex((c) => c.instanceId === hoveredInstanceId);
  const hoveredCard = hoveredIndex === -1 ? null : cards[hoveredIndex];
  const hoveredActions = hoveredCard ? getHandActions(hoveredCard.card) : [];
  const hoveredSlot = hoveredIndex === -1 ? null : getHandSlot(cards.length, hoveredIndex);

  return (
    // Position (top:0/left:0) comes from .Hand's own CSS rule now — see
    // that rule's comment for why.
    <div className="Hand">
      {cards.map(({ instanceId, card }, index) => {
        const slot = getHandSlot(cards.length, index);

        return (
          <div
            key={instanceId}
            className="Hand-cell"
            style={{
              width: slot.width,
              height: slot.height,
              left: slot.x,
              top: slot.y,
              // Overlapping cards otherwise stack purely by DOM order
              // (later card on top) — this lets the hovered card rise
              // above whichever neighbors currently cover part of it,
              // regardless of its own position in that order. This
              // z-index, combined with position:absolute, is exactly
              // what makes THIS element its own stacking context — which
              // is precisely why the context menu can no longer live
              // inside it (see below).
              zIndex: hoveredInstanceId === instanceId ? cards.length + 1 : index,
            }}
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
            {/* No card art rendered here anymore — CardLayer (src/duel/)
                renders every hand card as its own independently-
                positioned element, sitting visually on top of this
                cell's exact footprint whenever nothing's mid-move. This
                div's only remaining job is the hover/click/menu target
                itself. */}
          </div>
        );
      })}

      {/* Rendered as a direct child of .Hand — deliberately NOT nested
          inside the hovered .Hand-cell above. That cell's own
          position:absolute + z-index makes it its own stacking context,
          which would trap any z-index set on a menu nested inside it:
          no matter how high, it could only ever win against OTHER
          things inside that same cell, never against CardLayer's cards
          (which live entirely outside it, as a sibling of .Hand within
          .boardStage). .Hand itself has no z-index of its own, so this
          participates directly in .boardStage's own stacking order
          instead, where 9999 legitimately beats CardLayer's cards
          (whose z-index values top out in the low 100s/200s — see
          cardPositions.ts). Position is computed explicitly from the
          hovered card's own slot, since it's no longer nested inside
          that card's cell and so can't rely on that cell's own
          bottom:100%/left:50% relative positioning anymore. */}
      {hoveredSlot && hoveredActions.length > 0 && (
        <div
          className="Hand-contextMenu"
          style={{
            position: 'absolute',
            left: hoveredSlot.x + hoveredSlot.width / 2,
            top: hoveredSlot.y,
            transform: 'translate(-50%, -100%)',
            marginTop: -4,
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={() => scheduleHide(hoveredInstanceId!)}
        >
          {hoveredActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="Hand-contextMenuButton"
              onClick={() => handleAction(hoveredInstanceId!, action.key)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Hand;
