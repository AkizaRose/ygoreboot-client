import { useEffect } from 'react';
import type { CardPositionEntry } from './cardPositions';
import CardImage from '../components/CardView/CardImage';
import cardBackImg from '../assets/card/CardBack.png';
import { CARD_NATIVE_WIDTH, CARD_NATIVE_HEIGHT } from './cardGeometry';

interface CardLayerProps {
  entries: CardPositionEntry[];
}

// TEMPORARY DIAGNOSTIC — remove once the animation bug is confirmed
// fixed. Logs whenever a specific card's element genuinely mounts or
// unmounts (not just re-renders with new props) — this is the one thing
// that can't be determined from reading the code alone, since it
// depends on whether React treats two renders as "the same element,
// moved" or "a different element entirely." Reproduce the bug, then
// check the console for an unmount/remount pair around the instanceId
// of whichever card stops animating.
function MountLogger({ instanceId }: { instanceId: string }) {
  useEffect(() => {
    console.log(`[CardLayer] mounted: ${instanceId}`);
    return () => console.log(`[CardLayer] unmounted: ${instanceId}`);
  }, [instanceId]);
  return null;
}

// Renders every card that currently exists in the duel — hand, field,
// deck piles, everything — as ONE persistent element per instanceId.
// "Moving" a card is just a different entry.x/y/rotation/scale showing
// up on the next render for the same key; the CSS transition below is
// what turns that into motion, the same mechanism the Hand<->Monster
// Zone proof of concept demonstrated, just fed by real game state now
// instead of a couple of hardcoded arrays.
//
// pointer-events: none on every card — hover/click/menu interaction
// stays owned by the (now purely visual-chrome) zone or hand-cell
// underneath, exactly as it worked before this existed. That underlying
// element occupies the exact same footprint a resting card sits in, so
// nothing about hover/menu behavior needed to change; this layer is
// purely what's visible on top.
function CardLayer({ entries }: CardLayerProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {entries.map((entry) => {
        // Two nested levels, not one combined transform — scale and
        // rotate need DIFFERENT origins, and a single element can only
        // have one transform-origin. This outer level is sized to the
        // card's actual ON-SCREEN size (native size × scale) and
        // positioned at entry.x/y — rotating it uses the default center
        // origin, which is exactly the zone's own center, so a card
        // rotating into Defense Position pivots in place rather than
        // swinging out around its corner. The inner level is the FULL
        // native 813x1185 size, scaled down from its own top-left corner
        // — shrinking toward the same corner the outer box is already
        // positioned from, so scale never shifts the card away from
        // entry.x/y the way scaling from center would.
        const displayWidth = CARD_NATIVE_WIDTH * entry.scale;
        const displayHeight = CARD_NATIVE_HEIGHT * entry.scale;
        return (
          <div
            key={entry.instanceId}
            style={{
              position: 'absolute',
              left: entry.x,
              top: entry.y,
              width: displayWidth,
              height: displayHeight,
              transform: `rotate(${entry.rotation}deg)`,
              transition: 'left 0.3s ease-in-out, top 0.3s ease-in-out, transform 0.3s ease-in-out',
              zIndex: entry.zIndex,
            }}
          >
            <MountLogger instanceId={entry.instanceId} />
            <div
              style={{
                width: CARD_NATIVE_WIDTH,
                height: CARD_NATIVE_HEIGHT,
                transform: `scale(${entry.scale})`,
                transformOrigin: 'top left',
              }}
            >
              {/* faceDown covers two different situations that both
                  render the same way: a card whose identity IS known but
                  is deliberately hidden (a Set Spell/Trap, the player's
                  own deck pile), and a card whose identity genuinely
                  ISN'T known to this client at all (entry.card === null
                  — the opponent's hidden hand/deck, see
                  cardPositions.ts). Both show a plain card back; only
                  the first case could show the real face if faceDown
                  were ever toggled off. */}
              {entry.card && !entry.faceDown ? (
                <CardImage card={entry.card} />
              ) : (
                <img
                  src={cardBackImg}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CardLayer;
