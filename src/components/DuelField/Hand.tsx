import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { CardData } from '../../types/Card';
import type { CardInstance } from '../../types/CardInstance';
import { getHandSlot } from '../../duel/cardGeometry';
import { HAND_HOVER_LIFT } from '../../duel/CardLayer';
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
    { key: 'reveal', label: 'Reveal' },
    // Announces "[Player] activated the effect of [card name]" in chat
    // and, like Reveal, briefly sends the card through the reveal zone
    // and back — see handleHandDeclare in MultiplayerDuelFieldPage.
    { key: 'declare', label: 'Declare' },
  );

  return actions;
}

interface HandProps {
  cards: CardInstance[];
  onCardHover?: (card: CardData) => void;
  onCardHoverEnd?: () => void;
  // Reports which card's own hover context (the card itself, OR its
  // context menu, with the same brief grace period between them the
  // menu itself gets) is currently active — mirrors this component's
  // own hoveredInstanceId state exactly (see the effect that reports it
  // below), rather than the raw, immediate cursor position. CardLayer's
  // own hover-lift effect wants this: without it, moving the cursor
  // from the card to its own menu would drop the card back down before
  // the menu could even be reached, since the two are visually
  // separate elements.
  onHoveredInstanceChange?: (instanceId: string | null) => void;
  onNormalSummon: (instanceId: string) => void;
  onActivateSpell: (instanceId: string) => void;
  onSetSpellOrTrap: (instanceId: string) => void;
  onToGrave: (instanceId: string) => void;
  onBanish: (instanceId: string) => void;
  onStackTop: (instanceId: string) => void;
  onStackBottom: (instanceId: string) => void;
  onReveal: (instanceId: string) => void;
  onDeclare: (instanceId: string) => void;
}

function Hand({
  cards,
  onCardHover,
  onCardHoverEnd,
  onHoveredInstanceChange,
  onNormalSummon,
  onActivateSpell,
  onSetSpellOrTrap,
  onToGrave,
  onBanish,
  onStackTop,
  onStackBottom,
  onReveal,
  onDeclare,
}: HandProps) {
  // Which hand card (by instanceId) currently shows its context menu —
  // a separate concern from the CardDisplay hover callbacks above,
  // though both are driven by the same mouseenter/mouseleave.
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const hideTimeoutRef = useRef<number | undefined>(undefined);

  // Reports this component's own hoveredInstanceId upward whenever it
  // changes — see onHoveredInstanceChange's own comment for why this,
  // rather than the raw cursor position, is what CardLayer's hover-lift
  // effect should track: this state already captures "hovering the
  // card OR its own menu, with a brief grace period while moving
  // between them" (see cancelHide/scheduleHide below), which is exactly
  // the lift's own desired behavior too.
  useEffect(() => {
    onHoveredInstanceChange?.(hoveredInstanceId);
    // onHoveredInstanceChange intentionally not a dependency — it's the
    // parent's own setState function, effectively stable in practice,
    // and including it would risk extra fires if the parent ever passes
    // a fresh closure on some unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredInstanceId]);

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
      case 'reveal':
        onReveal(instanceId);
        break;
      case 'declare':
        onDeclare(instanceId);
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
      <AnimatePresence>
        {hoveredSlot && hoveredActions.length > 0 && (
          <motion.div
            key="hand-context-menu"
            style={{
              position: 'absolute',
              left: hoveredSlot.x + hoveredSlot.width / 2,
              // Matches the card's own hover-lift exactly (see
              // HAND_HOVER_LIFT's own comment in CardLayer.tsx) —
              // without this, the menu would stay anchored to the
              // card's unlifted position while the card itself rises
              // above it.
              top: hoveredSlot.y - HAND_HOVER_LIFT,
              transform: 'translate(-50%, -100%)',
              marginTop: -4,
              // Lives here, not in .Hand-contextMenu's own CSS (where
              // it used to be, back when that class was on this same,
              // positioned element) — z-index has no effect at all on
              // the INNER element below, which has no `position` of its
              // own (defaults to static), only on an element that's
              // actually positioned, which this one is.
              zIndex: 9999,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onMouseEnter={cancelHide}
            onMouseLeave={() => scheduleHide(hoveredInstanceId!)}
          >
            {/* The actual slide lives on this inner element, as a plain
                pixel offset, rather than on the outer one above as a
                percentage — the outer's own translate(-100%) is already
                a percentage of its own (content-dependent) height, and
                combining that with an animated percentage risked not
                animating reliably. A plain pixel slide on a separate,
                nested element sidesteps that entirely: it's independent
                of the outer's own transform, so the two compose without
                either one needing to account for the other. Framer
                Motion still plays this nested exit animation correctly
                even though AnimatePresence only directly tracks the
                OUTER element above — exit propagates to descendant
                motion components automatically. */}
            <motion.div
              className="Hand-contextMenu"
              initial={{ y: 8 }}
              animate={{ y: 0 }}
              exit={{ y: 8 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Hand;
