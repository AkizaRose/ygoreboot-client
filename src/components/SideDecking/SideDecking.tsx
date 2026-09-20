import CardImage from '../CardView/CardImage';
import CategoryCounter from '../DeckBuilder/CategoryCounter';
import type { CardData } from '../../types/Card';
import { MAIN_DECK_SIZE, EXTRA_DECK_SIZE, SIDE_DECK_SIZE, countCardsByCategory } from '../DeckBuilder/useDeck';
import normalCountIcon from '../../assets/ui/deckbuilder/normalcount.png';
import effectCountIcon from '../../assets/ui/deckbuilder/effectcount.png';
import spellCountIcon from '../../assets/ui/deckbuilder/spellcount.png';
import trapCountIcon from '../../assets/ui/deckbuilder/trapcount.png';
import fusionCountIcon from '../../assets/ui/deckbuilder/fusioncount.png';
import ritualCountIcon from '../../assets/ui/deckbuilder/ritualcount.png';
import evolutionCountIcon from '../../assets/ui/deckbuilder/evolutioncount.png';
import './SideDecking.css';

// Same native-size-then-scale approach, and the same SCALE value, as
// DeckBuilder's own DeckSlots — cards on this screen are the same visual
// size as everywhere else cards are shown in a grid.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.061;

const MAIN_DECK_COLUMNS = 10;
const EXTRA_DECK_COLUMNS = 10;
const SIDE_DECK_COLUMNS = 10;

interface SideDeckingGridProps {
  cards: CardData[];
  // Always rendered at this many cells, regardless of how many real
  // cards there are — same fixed-size-grid approach as DeckBuilder's own
  // DeckSlots (totalSlots), so this screen's Main/Extra/Side Deck grids
  // look exactly like the Deck Builder's own, empty cells included,
  // rather than shrinking to fit however many cards are actually in the
  // deck.
  totalSlots: number;
  columns: number;
  selectedIndices: number[];
  disabled: boolean;
  // Indices that can't be SELECTED right now (already-selected ones stay
  // clickable, to deselect) — used only for the Side Deck grid, to grey
  // out whichever cards aren't legal for the currently active swap
  // channel (see MultiplayerDuelFieldPage's own sideDeckIneligibleIndices
  // for how this is computed, and toggleSideSelection there for the
  // actual enforcement — this prop is purely the visual side of that
  // same rule). Defaults to none, for the Main/Extra grids, which have
  // no such restriction of their own.
  ineligibleIndices?: number[];
  onToggle: (index: number) => void;
  onCardHover: (card: CardData) => void;
  onCardHoverEnd: () => void;
}

// A plain click-to-select grid — unlike DeckBuilder's own DeckSlots, this
// has no drag-and-drop and no per-card action menu: every card here does
// exactly one thing (toggle its own selected state). Empty slots (index
// >= cards.length, out to totalSlots) render exactly as DeckBuilder's own
// empty DeckSlots cells do — same class, same look — and are never
// clickable.
function SideDeckingGrid({
  cards,
  totalSlots,
  columns,
  selectedIndices,
  disabled,
  ineligibleIndices = [],
  onToggle,
  onCardHover,
  onCardHoverEnd,
}: SideDeckingGridProps) {
  return (
    <div
      className="SideDecking-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, max-content)` }}
    >
      {Array.from({ length: totalSlots }, (_, i) => {
        const card = cards[i];
        const isSelected = !!card && selectedIndices.includes(i);
        // An already-selected card stays clickable (to deselect) even
        // if it would now be ineligible to newly select — that can only
        // happen for a moment anyway (see
        // MultiplayerDuelFieldPage's own pruneSideSelectionForChannel,
        // which clears any now-ineligible selection the instant the
        // active channel changes), but there's no reason to make a
        // still-selected card temporarily unclickable in that window.
        const isIneligible = !!card && !isSelected && ineligibleIndices.includes(i);
        const isInert = disabled || isIneligible;
        const cellClassName = [
          'SideDecking-cell',
          !card && 'SideDecking-cell--empty',
          isSelected && 'SideDecking-cell--selected',
          card && disabled && 'SideDecking-cell--disabled',
          isIneligible && 'SideDecking-cell--ineligible',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={i}
            className={cellClassName}
            style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
            onClick={card && !isInert ? () => onToggle(i) : undefined}
            title={isIneligible ? 'Only Fusion, Ritual and Evolution Monsters can be Side Decked into the Extra Deck.' : undefined}
            onMouseEnter={card ? () => onCardHover(card) : undefined}
            onMouseLeave={card ? onCardHoverEnd : undefined}
          >
            {card && (
              <>
                <div
                  className="SideDecking-cardWrapper"
                  style={{ width: CARD_WIDTH, height: CARD_HEIGHT, transform: `scale(${SCALE})` }}
                >
                  <CardImage card={card} />
                </div>
                {/* A solid white rectangle covering the whole card,
                    pulsing between 0 and 50% opacity (see
                    SideDecking.css's own @keyframes) — the actual "this
                    card is selected" indicator; the outline (see
                    .SideDecking-cell--selected) stays as a secondary,
                    non-animated cue.

                    Always rendered for every REAL card, whether selected
                    or not — only its own visibility (via the --visible
                    modifier) depends on isSelected. This is what keeps
                    every selected card's pulse in sync with every other
                    one: a CSS animation's timeline starts the moment the
                    animated element is first mounted, not when it
                    becomes visible, so an overlay that only gets
                    created/destroyed as cards are selected/deselected
                    would start its own pulse from 0 each time — visibly
                    out of phase with any other card that happened to get
                    selected at a different moment. Since every card's
                    overlay mounts once, up front, and never unmounts
                    (visibility: hidden, not a conditional render or
                    display: none, is what hides it — see
                    SideDecking.css), they all share the exact same
                    running clock for as long as this screen is open. An
                    empty slot has no card to select, so it gets no
                    overlay at all — nothing here ever toggles it between
                    mounted and unmounted, so there's no sync concern for
                    those. */}
                <div
                  className={
                    isSelected
                      ? 'SideDecking-selectedOverlay SideDecking-selectedOverlay--visible'
                      : 'SideDecking-selectedOverlay'
                  }
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SideDeckingProps {
  mainDeck: CardData[];
  extraDeck: CardData[];
  sideDeck: CardData[];
  // Indices into mainDeck/extraDeck/sideDeck respectively — see
  // MultiplayerDuelFieldPage's own selectedMainIndices/
  // selectedExtraIndices/selectedSideIndices for why indices rather
  // than card ids (multiple copies of the same card need to stay
  // distinguishable).
  selectedMainIndices: number[];
  selectedExtraIndices: number[];
  selectedSideIndices: number[];
  // Which Side Deck indices aren't legal to newly select right now (see
  // SideDeckingGrid's own ineligibleIndices prop, and
  // MultiplayerDuelFieldPage's own sideDeckIneligibleIndices for how this
  // is computed) — only ever applies to the Side Deck grid, never Main or
  // Extra, so this is passed through to that one grid instance alone.
  sideDeckIneligibleIndices?: number[];
  onToggleMainCard: (index: number) => void;
  onToggleExtraCard: (index: number) => void;
  onToggleSideCard: (index: number) => void;
  // This player's own "Done Siding" state — once true, every grid on
  // this screen goes inert, so no selection can change again while
  // waiting on the opponent. The Swap Cards/Reset Deck/Done Siding
  // buttons themselves live outside this component now (see
  // MultiplayerDuelFieldPage's own siding-phase render, which positions
  // them in the same column as the Card Viewer, below it) — this
  // component is purely the three deck grids, styled to match
  // DeckBuilder.
  isDone: boolean;
  onCardHover: (card: CardData) => void;
  onCardHoverEnd: () => void;
}

function SideDecking({
  mainDeck,
  extraDeck,
  sideDeck,
  selectedMainIndices,
  selectedExtraIndices,
  selectedSideIndices,
  sideDeckIneligibleIndices = [],
  onToggleMainCard,
  onToggleExtraCard,
  onToggleSideCard,
  isDone,
  onCardHover,
  onCardHoverEnd,
}: SideDeckingProps) {
  const mainCounts = countCardsByCategory(mainDeck);
  const extraCounts = countCardsByCategory(extraDeck);

  return (
    <div className="SideDecking">
      <div className="SideDecking-section">
        <div className="SideDecking-sectionHeader">
          <h2 className="SideDecking-heading">
            Main Deck ({mainDeck.length}/{MAIN_DECK_SIZE})
          </h2>
          <div className="SideDecking-categoryCounters">
            <CategoryCounter icon={normalCountIcon} count={mainCounts.NormalMonster} label="Normal Monsters" />
            <CategoryCounter icon={effectCountIcon} count={mainCounts.EffectMonster} label="Effect Monsters" />
            <CategoryCounter icon={spellCountIcon} count={mainCounts.Spell} label="Spells" />
            <CategoryCounter icon={trapCountIcon} count={mainCounts.Trap} label="Traps" />
          </div>
        </div>
        <SideDeckingGrid
          cards={mainDeck}
          totalSlots={MAIN_DECK_SIZE}
          columns={MAIN_DECK_COLUMNS}
          selectedIndices={selectedMainIndices}
          disabled={isDone}
          onToggle={onToggleMainCard}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>

      <div className="SideDecking-section">
        <div className="SideDecking-sectionHeader">
          <h2 className="SideDecking-heading">
            Extra Deck ({extraDeck.length}/{EXTRA_DECK_SIZE})
          </h2>
          <div className="SideDecking-categoryCounters">
            <CategoryCounter icon={fusionCountIcon} count={extraCounts.Fusion} label="Fusion Monsters" />
            <CategoryCounter icon={ritualCountIcon} count={extraCounts.Ritual} label="Ritual Monsters" />
            <CategoryCounter icon={evolutionCountIcon} count={extraCounts.Evolution} label="Evolution Monsters" />
          </div>
        </div>
        <SideDeckingGrid
          cards={extraDeck}
          totalSlots={EXTRA_DECK_SIZE}
          columns={EXTRA_DECK_COLUMNS}
          selectedIndices={selectedExtraIndices}
          disabled={isDone}
          onToggle={onToggleExtraCard}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>

      <div className="SideDecking-section">
        <div className="SideDecking-sectionHeader">
          <h2 className="SideDecking-heading">
            Side Deck ({sideDeck.length}/{SIDE_DECK_SIZE})
          </h2>
        </div>
        <SideDeckingGrid
          cards={sideDeck}
          totalSlots={SIDE_DECK_SIZE}
          columns={SIDE_DECK_COLUMNS}
          selectedIndices={selectedSideIndices}
          disabled={isDone}
          ineligibleIndices={sideDeckIneligibleIndices}
          onToggle={onToggleSideCard}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>
    </div>
  );
}

export default SideDecking;
