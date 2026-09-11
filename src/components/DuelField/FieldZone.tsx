import { useEffect, useRef, useState } from 'react';
import CardImage from '../CardView/CardImage';
import type { CardData } from '../../types/Card';
import type { CardInstance } from '../../types/CardInstance';
import cardBackImg from '../../assets/card/CardBack.png';
import stackImg from '../../assets/card/Stack.png';
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
  // Ignored when `stackCards` is given instead (Grave/Banished).
  card?: CardData;
  // Stable per-card identity (see src/types/CardInstance.ts) — used as
  // this element's React key so list reconciliation stays correct as
  // cards move between zones.
  instanceId?: string;
  // For face-up multi-card piles (Grave/Banished) — every card actually
  // gets rendered here, not just the top one, each individually keyed by
  // its own instanceId and showing its own real face. Ordered
  // bottom-of-visible-window to top (last entry is the actual top of the
  // pile); when provided (non-empty), this takes priority over `card`
  // for rendering, though `card`/`instanceId` (the top card) are still
  // used for the hover/menu behavior on the outer zone.
  stackCards?: CardInstance[];
  // Whether `card` is showing face-down (Set) rather than face-up. Only
  // affects what's visually rendered — hover still reports the real
  // card, so the player can check what they've Set via Card Display.
  faceDown?: boolean;
  // When provided (and no `card`), the zone renders as a face-down pile
  // (image + count) instead of a plain text label — used for Main Deck /
  // Extra Deck once real deck data has been loaded.
  image?: string;
  count?: number;
  // How the pile visually reads as a stack of cards rather than one
  // flat image. Configurable per-instance (rather than a fixed global
  // constant) since Main Deck and Extra Deck sit at different distances
  // from a centered player viewpoint and may need different-looking
  // stacks to simulate that. X/Y offsets are independent so the stack
  // can lean more steeply in one direction than the other. Layer count
  // is capped rather than scaling 1:1 with the actual card count —
  // beyond a handful of layers the visual difference becomes
  // imperceptible anyway.
  stackOffsetStepX?: number;
  stackOffsetStepY?: number;
  stackMaxLayers?: number;
  onClick?: () => void;
  // Purely visual — a highlighted border indicating this zone is
  // currently chosen as part of some in-progress multi-select
  // interaction (e.g. Fusion Summon material selection). Independent of
  // onClick itself; a zone can be clickable without being selected, or
  // (in principle) selected without being clickable.
  selected?: boolean;
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
  // Same idea as battlePosition, but for the stackCards branch — a
  // Monster Zone Fusion stack needs every layer to share one rotation
  // (the whole stack is in Attack or Defense Position, not each card
  // individually). Undefined for Grave/Banished (they never pass this),
  // which just renders those upright. Also gates the ATK/DEF stats
  // overlay, shown only for the top-most layer, only when this is
  // provided — Grave/Banished stacks never show one.
  stackBattlePosition?: 'attack' | 'defense';
  // True for every zone on the opponent's (flipped) side — added on top
  // of whatever battlePosition/stackBattlePosition already computes,
  // rather than replacing it, so a card's own Attack/Defense rotation
  // and the "this whole side is upside-down from the player's view"
  // rotation compose correctly rather than one overriding the other.
  // Deliberately doesn't touch the ATK/DEF stats overlay (kept upright
  // and readable regardless of which side it's on, matching how actual
  // duel UIs handle this) or the dashed Defense Position guide box
  // (a symmetric rectangle — rotating it 180° has no visible effect
  // anyway).
  rotated180?: boolean;
}

function FieldZone({
  label,
  card,
  instanceId,
  stackCards,
  faceDown = false,
  image,
  count,
  stackOffsetStepX = 2,
  stackOffsetStepY = 2,
  stackMaxLayers = 4,
  onClick,
  selected = false,
  onCardHover,
  onCardHoverEnd,
  menuActions,
  onMenuAction,
  showRotatedOverlay = false,
  battlePosition = 'attack',
  stackBattlePosition,
  rotated180 = false,
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

  // Shared by both the face-up-card branch (Grave/Banished, which pass
  // both `card` and `count`) and the pile branch (Main/Extra Deck, which
  // pass `image` and `count`) — a stack of cards reads the same way
  // regardless of which is showing on top. Zero for anything that
  // doesn't pass `count` at all (Monster/Spell-Trap/Field Zone cards),
  // so those are completely unaffected.
  const stackLayerCount = count != null ? Math.min(Math.max(count - 1, 0), stackMaxLayers) : 0;
  // j=0 is the bottom/deepest layer, fixed at zero offset (the "anchor"
  // of the whole pile). Each layer closer to the top gets progressively
  // more offset, ending with the actual top card at the largest offset
  // of all.
  const topOffsetX = stackLayerCount * stackOffsetStepX;
  const topOffsetY = stackLayerCount * stackOffsetStepY;
  // Parameterized by image rather than hardcoded, since the two callers
  // need different layer art: the face-down pile (Main/Extra Deck) uses
  // the real card back, while the face-up card branch (Grave/Banished)
  // uses a plain white-filled card outline (Stack.png) instead — using
  // the actual card back there would make the cards underneath read as
  // face-down, which they aren't.
  const buildStackLayers = (layerImage: string) =>
    Array.from({ length: stackLayerCount }, (_, j) => j).map((j) => {
      const offsetX = j * stackOffsetStepX;
      const offsetY = j * stackOffsetStepY;
      return (
        <img
          key={j}
          className="FieldZone-stackLayer"
          src={layerImage}
          alt=""
          style={{ transform: `translate(${offsetX}px, ${offsetY}px)` }}
        />
      );
    });

  return (
    <div
      className={[
        'FieldZone',
        onClick && 'FieldZone--clickable',
        selected && 'FieldZone--selected',
      ]
        .filter(Boolean)
        .join(' ')}
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
      {stackCards && stackCards.length > 0 ? (
        <>
          {stackCards.map((entry, j) => {
            const isTopLayer = j === stackCards.length - 1;
            const rotation =
              (stackBattlePosition === 'defense' ? -90 : 0) + (rotated180 ? 180 : 0);
            return (
              <div
                key={entry.instanceId}
                className="FieldZone-cardOuter"
                style={{
                  width: ZONE_WIDTH,
                  height: ZONE_HEIGHT,
                  transform: `translate(${j * stackOffsetStepX}px, ${j * stackOffsetStepY}px)`,
                }}
              >
                <div className="FieldZone-cardRotation" style={{ transform: `rotate(${rotation}deg)` }}>
                  <div
                    className="FieldZone-cardWrapper"
                    style={{
                      width: CARD_WIDTH,
                      height: CARD_HEIGHT,
                      transform: `scale(${CARD_SCALE})`,
                    }}
                  >
                    <CardImage card={entry.card} />
                  </div>
                </div>
                {isTopLayer &&
                  stackBattlePosition &&
                  entry.card.cardClass === 'Monster' &&
                  (entry.card.atk || entry.card.def) && (
                    <div className="FieldZone-statsOverlay">
                      <span
                        className={
                          stackBattlePosition === 'defense'
                            ? 'FieldZone-statsOverlay--dimmed'
                            : undefined
                        }
                      >
                        {entry.card.atk ?? '?'}
                      </span>
                      /
                      <span
                        className={
                          stackBattlePosition !== 'defense'
                            ? 'FieldZone-statsOverlay--dimmed'
                            : undefined
                        }
                      >
                        {entry.card.def ?? '?'}
                      </span>
                    </div>
                  )}
              </div>
            );
          })}
        </>
      ) : card && !faceDown ? (
        <>
          {buildStackLayers(stackImg)}
          <div
            className="FieldZone-topCardOffset"
            style={{ transform: `translate(${topOffsetX}px, ${topOffsetY}px)` }}
          >
            <div key={instanceId} className="FieldZone-cardOuter" style={{ width: ZONE_WIDTH, height: ZONE_HEIGHT }}>
              <div
                className="FieldZone-cardRotation"
                style={{
                  transform: `rotate(${(battlePosition === 'defense' ? -90 : 0) + (rotated180 ? 180 : 0)}deg)`,
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
              {card.cardClass === 'Monster' && (card.atk || card.def) && (
                <div className="FieldZone-statsOverlay">
                  <span
                    className={
                      battlePosition === 'defense' ? 'FieldZone-statsOverlay--dimmed' : undefined
                    }
                  >
                    {card.atk ?? '?'}
                  </span>
                  /
                  <span
                    className={
                      battlePosition !== 'defense' ? 'FieldZone-statsOverlay--dimmed' : undefined
                    }
                  >
                    {card.def ?? '?'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      ) : card && faceDown ? (
        <div key={instanceId} className="FieldZone-cardOuter" style={{ width: ZONE_WIDTH, height: ZONE_HEIGHT }}>
          <div className="FieldZone-pile">
            <img className="FieldZone-pileImage" src={cardBackImg} alt="" />
          </div>
        </div>
      ) : image ? (
        <div className="FieldZone-pile">
          {buildStackLayers(cardBackImg)}
          <div
            className="FieldZone-topCardOffset"
            style={{ transform: `translate(${topOffsetX}px, ${topOffsetY}px)` }}
          >
            <img className="FieldZone-pileImage" src={image} alt={label} />
          </div>
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
