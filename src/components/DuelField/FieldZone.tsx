import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
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
  // this zone's framer-motion layoutId when a face-up card is shown, so
  // it can be recognized as "the same card" when it appears here after
  // leaving Hand (or another zone) elsewhere in the tree, and animated
  // smoothly between the two rather than just popping in.
  instanceId?: string;
  // For face-up multi-card piles (Grave/Banished) — every card actually
  // gets rendered here, not just the top one, each individually
  // layoutId-tracked by its own instanceId and showing its own real
  // face. This is what lets a card animate smoothly out to Hand
  // regardless of whether it was the top card or one underneath, and
  // avoids the earlier problem where cards underneath the top were
  // represented by a generic placeholder image that visibly swapped in
  // the instant the pile's composition changed. Ordered bottom-of-
  // visible-window to top (last entry is the actual top of the pile);
  // when provided (non-empty), this takes priority over `card` for
  // rendering, though `card`/`instanceId` (the top card) are still used
  // for the hover/menu behavior on the outer zone.
  stackCards?: CardInstance[];
  // Per-instanceId starting rotation (degrees) for a stackCards entry's
  // very first frame here — mirrors Hand's entryRotations for the exact
  // same reason: a monster arriving from Defense Position on the field
  // needs to visually unwind back to upright while it moves, rather than
  // snapping straight the instant it mounts (a CSS transition can't
  // animate an element's very first paint, so this has to be driven by
  // framer-motion's initial/animate instead). Cards with no entry here
  // just start upright, matching the animate target, so nothing visibly
  // animates for them.
  stackCardEntryRotations?: Record<string, number>;
  // Per-instanceId flag for a stackCards entry's very first frame here —
  // mirrors Hand's entryFlips for the same reason: a Set (face-down)
  // Spell/Trap/Field Spell being sent to Grave/Banished needs to
  // visually unfurl into its revealed face while it moves there, rather
  // than the destination just instantly showing the face from the first
  // frame while only the move itself animates. Cards with no entry here
  // (already face-up sources) just start fully revealed, matching the
  // animate target, so nothing visibly animates for them.
  stackCardEntryFlips?: Record<string, boolean>;
  // Whether `card` is showing face-down (Set) rather than face-up. Only
  // affects what's visually rendered — hover still reports the real
  // card, so the player can check what they've Set via Card Display.
  faceDown?: boolean;
  // When provided (and no `card`), the zone renders as a face-down pile
  // (image + count) instead of a plain text label — used for Main Deck /
  // Extra Deck once real deck data has been loaded.
  image?: string;
  count?: number;
  // Only meaningful alongside `image` — identifies the specific card
  // currently on top of this pile, so it (and only it) can be tracked
  // for the draw animation. Only ever passed for Main Deck, since Extra
  // Deck cards aren't drawn from. The count badge deliberately isn't
  // part of the tracked element, so it stays put and just updates
  // instantly rather than visually "flying along" with the drawn card.
  topCardInstanceId?: string;
  // True only for the one render immediately after a new card arrives at
  // the top of this pile from elsewhere (e.g. Stack to top) — plays the
  // same flip-reveal "unfurl" effect used for Set cards, so the arriving
  // card turns face-down into place rather than just popping in. Not set
  // for the normal case of a draw simply exposing the next card
  // underneath, which was already face-down and shouldn't visually flip.
  topCardEntryFlip?: boolean;
  // Same idea, for rotation instead of flip — a Defense Position monster
  // being Stacked (to top) needs to visually rotate back to upright
  // while it moves, at the same time as the flip-reveal above. Degrees,
  // matching the same -90/0 values used for Hand's/Grave's equivalents.
  topCardEntryRotation?: number;
  // Same idea as topCardInstanceId, but for the bottom of the pile —
  // tracks whichever card is currently at the very back, so a card
  // arriving via Stack (to bottom) can be animated smoothly from
  // wherever it came from. Positioned at the zone's own base (unoffset)
  // position, matching where the bottom-most stack layer visually sits.
  // Only meaningfully distinct from the top card when the pile has more
  // than one card — the caller is responsible for only passing this when
  // that's true (see DuelField.tsx), since two elements sharing the same
  // layoutId simultaneously would be invalid.
  bottomCardInstanceId?: string;
  bottomCardEntryFlip?: boolean;
  bottomCardEntryRotation?: number;
  // A card currently leaving this pile via a viewer action (e.g. Main
  // Deck's "To Grave"), rather than the normal draw-from-top or
  // Stack-to-top/bottom paths — those cards can be any card in the pile,
  // not necessarily the tracked top or bottom, so there's normally no
  // matching source element for the destination to animate from at all.
  // This provides one, transiently, positioned at the top of the pile
  // (the same spot the real top card sits) purely so the move has
  // somewhere to animate from — it only needs to exist long enough for
  // that animation to play, then gets cleared by the caller (see
  // DuelFieldPage's deckDepartureCardId cleanup).
  departureCardInstanceId?: string;
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
  instanceId,
  stackCards,
  stackCardEntryRotations,
  stackCardEntryFlips,
  faceDown = false,
  image,
  count,
  topCardInstanceId,
  topCardEntryFlip,
  topCardEntryRotation,
  bottomCardInstanceId,
  bottomCardEntryFlip,
  bottomCardEntryRotation,
  departureCardInstanceId,
  stackOffsetStepX = 2,
  stackOffsetStepY = 2,
  stackMaxLayers = 4,
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
      {stackCards && stackCards.length > 0 ? (
        <>
          {stackCards.map((entry, j) => (
            <motion.div
              key={entry.instanceId}
              layoutId={entry.instanceId}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="FieldZone-cardOuter"
              style={{
                width: ZONE_WIDTH,
                height: ZONE_HEIGHT,
                // x/y are framer-motion's own tracked values (not a raw
                // CSS transform string), so they compose correctly with
                // the layoutId-driven layout animation on this same
                // element rather than fighting it — same reasoning as
                // the Hand hover-lift effect.
                x: j * stackOffsetStepX,
                y: j * stackOffsetStepY,
              }}
            >
              <motion.div
                className="FieldZone-cardRotation"
                initial={{ rotate: stackCardEntryRotations?.[entry.instanceId] ?? 0 }}
                animate={{ rotate: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <motion.div
                  className="FieldZone-flipReveal"
                  initial={{ scaleX: stackCardEntryFlips?.[entry.instanceId] ? 0 : 1 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
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
                </motion.div>
              </motion.div>
            </motion.div>
          ))}
        </>
      ) : card && !faceDown ? (
        <>
          {buildStackLayers(stackImg)}
          <div
            className="FieldZone-topCardOffset"
            style={{ transform: `translate(${topOffsetX}px, ${topOffsetY}px)` }}
          >
            <motion.div
              key={instanceId}
              layoutId={instanceId}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="FieldZone-cardOuter"
              style={{ width: ZONE_WIDTH, height: ZONE_HEIGHT }}
            >
              <motion.div
                className="FieldZone-cardRotation"
                initial={{ rotate: 0 }}
                animate={{ rotate: battlePosition === 'defense' ? -90 : 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
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
              </motion.div>
            </motion.div>
          </div>
        </>
      ) : card && faceDown ? (
        <motion.div
          key={instanceId}
          layoutId={instanceId}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="FieldZone-cardOuter"
          style={{ width: ZONE_WIDTH, height: ZONE_HEIGHT }}
        >
          <motion.div
            className="FieldZone-flipReveal"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <div className="FieldZone-pile">
              <img className="FieldZone-pileImage" src={cardBackImg} alt="" />
            </div>
          </motion.div>
        </motion.div>
      ) : image ? (
        <div className="FieldZone-pile">
          {bottomCardInstanceId && (
            <motion.div
              key={bottomCardInstanceId}
              layoutId={bottomCardInstanceId}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="FieldZone-pileImageWrapper"
              style={{ position: 'absolute', top: 0, left: 0 }}
            >
              <motion.div
                className="FieldZone-cardRotation"
                initial={{ rotate: bottomCardEntryRotation ?? 0 }}
                animate={{ rotate: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <motion.div
                  className="FieldZone-flipReveal"
                  initial={{ scaleX: bottomCardEntryFlip ? 0 : 1 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <img className="FieldZone-pileImage" src={image} alt={label} />
                </motion.div>
              </motion.div>
            </motion.div>
          )}
          {buildStackLayers(cardBackImg)}
          {departureCardInstanceId && (
            <div
              className="FieldZone-topCardOffset"
              style={{ transform: `translate(${topOffsetX}px, ${topOffsetY}px)` }}
            >
              <motion.div
                key={departureCardInstanceId}
                layoutId={departureCardInstanceId}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="FieldZone-pileImageWrapper"
              >
                <img className="FieldZone-pileImage" src={image} alt={label} />
              </motion.div>
            </div>
          )}
          <div
            className="FieldZone-topCardOffset"
            style={{ transform: `translate(${topOffsetX}px, ${topOffsetY}px)` }}
          >
            {topCardInstanceId ? (
              <motion.div
                key={topCardInstanceId}
                layoutId={topCardInstanceId}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="FieldZone-pileImageWrapper"
              >
                <motion.div
                  className="FieldZone-cardRotation"
                  initial={{ rotate: topCardEntryRotation ?? 0 }}
                  animate={{ rotate: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                >
                  <motion.div
                    className="FieldZone-flipReveal"
                    initial={{ scaleX: topCardEntryFlip ? 0 : 1 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                  >
                    <img className="FieldZone-pileImage" src={image} alt={label} />
                  </motion.div>
                </motion.div>
              </motion.div>
            ) : (
              <img className="FieldZone-pileImage" src={image} alt={label} />
            )}
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
