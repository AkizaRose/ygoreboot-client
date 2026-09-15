import { useEffect, useRef, useState } from 'react';
import type { CardData } from '../../types/Card';
import './FieldZone.css';

// Matches the zone box's own size (see .FieldZone in FieldZone.css).
const ZONE_WIDTH = 72;
const ZONE_HEIGHT = 105;

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
  // The occupying card, if any — no longer used to RENDER anything here
  // (see CardLayer, in src/duel/), only for this zone's own logic: is
  // there something here to hover/click/show a menu for, and what ATK/
  // DEF should the stats overlay below show. The actual card art for
  // whatever's in this zone is a separate, independently-positioned
  // element in CardLayer, which happens to sit visually on top of this
  // zone's own footprint whenever nothing's mid-move.
  card?: CardData;
  // Whether `card` is currently showing face-down (Set) — still matters
  // here even without rendering anything: hover still reports the real
  // card via onCardHover regardless, so Card Display can reveal it.
  faceDown?: boolean;
  // When provided (and no `card`), this zone represents a face-down pile
  // (Main Deck / Extra Deck) rather than a single card slot — used for
  // the pile-count badge and to enable the deck menu/click-to-draw,
  // same as `card` does for single-card zones.
  image?: string;
  count?: number;
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
  // Only meaningful for face-up Monster Zone cards — drives the ATK/DEF
  // stats overlay below (which value is dimmed), independently of
  // however CardLayer happens to be rendering/rotating the card itself
  // right now.
  battlePosition?: 'attack' | 'defense';
  // Manually adjusted stats (see StatAdjustDialog) — null/undefined
  // means "use card.atk/card.def as-is." Only ever meaningful alongside
  // battlePosition above, for the same face-up Monster Zone cards.
  atkOverride?: number | null;
  defOverride?: number | null;
  // Opens StatAdjustDialog — only ever wired up for the player's OWN
  // Monster Zones (see DuelField.tsx), never the opponent's. Presence
  // alone is what makes the stats overlay itself clickable at all (see
  // its pointer-events handling below); omitted entirely rather than
  // passed-but-disabled for the opponent's side.
  onStatsClick?: () => void;
  // Only Monster Zones render ATK/DEF. Grave, Banished, Field, and
  // Spell/Trap Zones can also receive a Monster card for their top-card
  // display, but must never show the Monster Zone stats overlay.
  showStats?: boolean;
  // True for every zone on the opponent's (flipped) side. Only used here
  // to flip the stats overlay's own vertical position (see
  // .FieldZone-statsOverlay--top in FieldZone.css) — the card's own
  // rotation is CardLayer's concern entirely now, not this component's.
  rotated180?: boolean;
  // How far the pile's actual top card has drifted from this zone's own
  // base position, in pixels — see DuelField.tsx's own topCardOffset,
  // which computes this using the exact same per-layer step/cap math
  // that positions the real top card (in cardPositions.ts). Nudges the
  // pile count label to track the top card as a pile grows, rather than
  // staying fixed to the zone itself and drifting visibly off-center
  // from a large pile's actual top card.
  pileCountOffsetX?: number;
  pileCountOffsetY?: number;
}

function FieldZone({
  label,
  card,
  faceDown = false,
  image,
  count,
  onClick,
  selected = false,
  onCardHover,
  onCardHoverEnd,
  menuActions,
  onMenuAction,
  showRotatedOverlay = false,
  battlePosition = 'attack',
  atkOverride = null,
  defOverride = null,
  onStatsClick,
  showStats = false,
  rotated180 = false,
  pileCountOffsetX = 0,
  pileCountOffsetY = 0,
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
      {/* No card/pile art rendered here anymore — CardLayer (src/duel/)
          renders every card as its own independently-positioned element,
          which sits visually on top of this zone's footprint whenever
          nothing's mid-move. This div's only remaining visual jobs: the
          zone's own border/background (see .FieldZone in FieldZone.css),
          the rotated overlay above, the stats overlay and pile count
          below, and the plain text label when this zone is empty. */}
      {!hasContent && <span className="FieldZone-label">{label}</span>}
      {showStats &&
        card &&
        !faceDown &&
        card.cardClass === 'Monster' &&
        (card.atk || card.def) &&
        (() => {
          // card.atk/card.def are strings in this codebase's own data
          // (e.g. "2500", occasionally something non-numeric for a
          // variable-stat card) — kept as-is here for DISPLAY, so a
          // card with a genuinely non-numeric base stat still shows
          // whatever that string actually is rather than "NaN". A
          // separate, parsed numeric value is used only for the
          // increased/decreased COMPARISON below, since atkOverride
          // (once set, from StatAdjustDialog) is always a real number.
          const baseAtk = card.atk;
          const baseDef = card.def;
          const effectiveAtk = atkOverride ?? baseAtk;
          const effectiveDef = defOverride ?? baseDef;
          const baseAtkNum = baseAtk !== undefined ? Number(baseAtk) : NaN;
          const baseDefNum = baseDef !== undefined ? Number(baseDef) : NaN;
          // Only meaningful when there's actually an override to compare
          // AND the base parses to a real number — a card with a
          // non-numeric base stat falls through to no adjustment
          // styling at all, rather than a nonsensical comparison.
          const atkAdjustClass =
            atkOverride != null && !Number.isNaN(baseAtkNum) && atkOverride !== baseAtkNum
              ? atkOverride > baseAtkNum
                ? 'FieldZone-statsOverlay--increased'
                : 'FieldZone-statsOverlay--decreased'
              : undefined;
          const defAdjustClass =
            defOverride != null && !Number.isNaN(baseDefNum) && defOverride !== baseDefNum
              ? defOverride > baseDefNum
                ? 'FieldZone-statsOverlay--increased'
                : 'FieldZone-statsOverlay--decreased'
              : undefined;
          return (
            <div
              className={[
                'FieldZone-statsOverlay',
                rotated180 && 'FieldZone-statsOverlay--top',
                onStatsClick && 'FieldZone-statsOverlay--clickable',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={
                onStatsClick
                  ? (event) => {
                      // Stops this from also reaching the zone's own
                      // onClick (e.g. Fusion/Evolution material
                      // selection) — the overlay is a distinct,
                      // dedicated click target, not a proxy for the
                      // zone's own click behavior.
                      event.stopPropagation();
                      onStatsClick();
                    }
                  : undefined
              }
            >
              <span
                className={[
                  battlePosition === 'defense' && 'FieldZone-statsOverlay--dimmed',
                  atkAdjustClass,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {effectiveAtk ?? '?'}
              </span>
              /
              <span
                className={[
                  battlePosition !== 'defense' && 'FieldZone-statsOverlay--dimmed',
                  defAdjustClass,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {effectiveDef ?? '?'}
              </span>
            </div>
          );
        })()}
      {count != null && (
        <span
          className="FieldZone-pileCount"
          style={
            pileCountOffsetX || pileCountOffsetY
              ? { transform: `translate(${pileCountOffsetX}px, ${pileCountOffsetY}px)` }
              : undefined
          }
        >
          {count}
        </span>
      )}
    </div>
  );
}

export default FieldZone;