import { useState } from 'react';
import CardImage from '../CardView/CardImage';
import CategoryCounter from './CategoryCounter';
import type { CardData } from '../../types/Card';
import {
  setDragPayload,
  getDragPayload,
  clearDragPayload,
  type DeckName,
  type DragPayload,
} from '../../dragState';
import { MAIN_DECK_SIZE, EXTRA_DECK_SIZE, SIDE_DECK_SIZE, countCardsByCategory } from './useDeck';
import normalCountIcon from '../../assets/ui/deckbuilder/normalcount.png';
import effectCountIcon from '../../assets/ui/deckbuilder/effectcount.png';
import spellCountIcon from '../../assets/ui/deckbuilder/spellcount.png';
import trapCountIcon from '../../assets/ui/deckbuilder/trapcount.png';
import fusionCountIcon from '../../assets/ui/deckbuilder/fusioncount.png';
import ritualCountIcon from '../../assets/ui/deckbuilder/ritualcount.png';
import evolutionCountIcon from '../../assets/ui/deckbuilder/evolutioncount.png';
import './DeckBuilder.css';

// Card is rendered at its native 813x1185 size and then scaled down
// visually — same approach, and the same SCALE value, as CardBrowser, so
// cards appear the same size everywhere in the app rather than having a
// separate (and inconsistent-looking) Deck Builder-specific scale.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.07;

const MAIN_DECK_COLUMNS = 10;
const EXTRA_DECK_COLUMNS = 10;
const SIDE_DECK_COLUMNS = 10;

interface DeckSlotsProps {
  cards: CardData[];
  totalSlots: number;
  columns: number;
  deckName: DeckName;
  onRemove: (index: number) => void;
  onMove: (index: number) => void;
  onDuplicate: (index: number) => void;
  onDropCard: (payload: DragPayload, targetIndex: number | null) => void;
  onCardHover: (card: CardData) => void;
  onCardHoverEnd: () => void;
}

function DeckSlots({
  cards,
  totalSlots,
  columns,
  deckName,
  onRemove,
  onMove,
  onDuplicate,
  onDropCard,
  onCardHover,
  onCardHoverEnd,
}: DeckSlotsProps) {
  // Purely visual — which slot the dragged item is currently hovering
  // over, so it can be highlighted as a drop target.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div
      className="DeckBuilder-grid"
      style={{ gridTemplateColumns: `repeat(${columns}, max-content)` }}
    >
      {Array.from({ length: totalSlots }, (_, i) => {
        const card = cards[i];
        const cellClassName = [
          'DeckBuilder-cell',
          !card && 'DeckBuilder-cell--empty',
          dragOverIndex === i && 'DeckBuilder-cell--dragOver',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={i}
            className={cellClassName}
            style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
            draggable={!!card}
            onDragStart={
              card
                ? (e) => {
                    setDragPayload({ card, source: deckName, index: i });
                    e.dataTransfer.setData('text/plain', String(card.id));
                    e.dataTransfer.effectAllowed = 'move';
                  }
                : undefined
            }
            onDragEnd={() => clearDragPayload()}
            onDragOver={(e) => {
              // Required to allow dropping at all — browsers reject drops
              // by default unless dragover explicitly opts in.
              e.preventDefault();
              // dropEffect must match whatever effectAllowed was set to at
              // dragstart (see CardBrowser: 'copy'; DeckSlots itself:
              // 'move') — NOT whether this particular slot is occupied.
              // Setting it based on slot occupancy instead caused a
              // mismatch (e.g. 'move' here vs 'copy' allowed) whenever a
              // Card Browser drag hovered an occupied slot, which the
              // browser treats as a disallowed drop and silently ignores.
              const payload = getDragPayload();
              e.dataTransfer.dropEffect = payload?.source === 'browser' ? 'copy' : 'move';
            }}
            onDragEnter={() => setDragOverIndex(i)}
            onDragLeave={() =>
              setDragOverIndex((current) => (current === i ? null : current))
            }
            onDrop={(e) => {
              e.preventDefault();
              setDragOverIndex(null);
              const payload = getDragPayload();
              clearDragPayload();
              if (!payload) return;
              // Dropped on a card: insert before it (shifts it, and
              // everything after, right by one). Dropped on empty space:
              // null means "snap to the first available slot" — handled
              // by dropCardOnDeck appending to the (always-compact) array.
              onDropCard(payload, card ? i : null);
            }}
            onClick={
              card
                ? (e) => {
                    if (e.ctrlKey) {
                      onDuplicate(i);
                    } else if (e.shiftKey) {
                      onMove(i);
                    } else {
                      onRemove(i);
                    }
                  }
                : undefined
            }
            onMouseEnter={card ? () => onCardHover(card) : undefined}
            onMouseLeave={card ? () => onCardHoverEnd() : undefined}
          >
            {card && (
              <div
                className="DeckBuilder-cardWrapper"
                style={{
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                  transform: `scale(${SCALE})`,
                }}
              >
                <CardImage card={card} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface DeckBuilderProps {
  mainDeck: CardData[];
  extraDeck: CardData[];
  sideDeck: CardData[];
  onRemoveMainCard: (index: number) => void;
  onRemoveExtraCard: (index: number) => void;
  onRemoveSideCard: (index: number) => void;
  onMoveMainCard: (index: number) => void;
  onMoveExtraCard: (index: number) => void;
  onMoveSideCard: (index: number) => void;
  onDuplicateMainCard: (index: number) => void;
  onDuplicateExtraCard: (index: number) => void;
  onDuplicateSideCard: (index: number) => void;
  onDropCard: (payload: DragPayload, deckName: DeckName, targetIndex: number | null) => void;
  onSortMainDeck: () => void;
  onSortExtraDeck: () => void;
  onSortSideDeck: () => void;
  onClearMainDeck: () => void;
  onClearExtraDeck: () => void;
  onClearSideDeck: () => void;
  onCardHover: (card: CardData) => void;
  onCardHoverEnd: () => void;
}

function DeckBuilder({
  mainDeck,
  extraDeck,
  sideDeck,
  onRemoveMainCard,
  onRemoveExtraCard,
  onRemoveSideCard,
  onMoveMainCard,
  onMoveExtraCard,
  onMoveSideCard,
  onDuplicateMainCard,
  onDuplicateExtraCard,
  onDuplicateSideCard,
  onDropCard,
  onSortMainDeck,
  onSortExtraDeck,
  onSortSideDeck,
  onClearMainDeck,
  onClearExtraDeck,
  onClearSideDeck,
  onCardHover,
  onCardHoverEnd,
}: DeckBuilderProps) {
  const mainCounts = countCardsByCategory(mainDeck);
  const extraCounts = countCardsByCategory(extraDeck);

  return (
    <div className="DeckBuilder">
      <div className="DeckBuilder-section">
        <div className="DeckBuilder-sectionHeader">
          <h2 className="DeckBuilder-heading">
            Main Deck ({mainDeck.length}/{MAIN_DECK_SIZE})
          </h2>
          <div className="DeckBuilder-categoryCounters">
            <CategoryCounter icon={normalCountIcon} count={mainCounts.NormalMonster} label="Normal Monsters" />
            <CategoryCounter icon={effectCountIcon} count={mainCounts.EffectMonster} label="Effect Monsters" />
            <CategoryCounter icon={spellCountIcon} count={mainCounts.Spell} label="Spells" />
            <CategoryCounter icon={trapCountIcon} count={mainCounts.Trap} label="Traps" />
          </div>
          <div className="DeckBuilder-sectionActions">
            <button type="button" className="DeckBuilder-sortButton" onClick={onSortMainDeck}>
              Sort
            </button>
            <button type="button" className="DeckBuilder-clearButton" onClick={onClearMainDeck}>
              Clear
            </button>
          </div>
        </div>
        <DeckSlots
          cards={mainDeck}
          totalSlots={MAIN_DECK_SIZE}
          columns={MAIN_DECK_COLUMNS}
          deckName="main"
          onRemove={onRemoveMainCard}
          onMove={onMoveMainCard}
          onDuplicate={onDuplicateMainCard}
          onDropCard={(payload, targetIndex) => onDropCard(payload, 'main', targetIndex)}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>

      <div className="DeckBuilder-section">
        <div className="DeckBuilder-sectionHeader">
          <h2 className="DeckBuilder-heading">
            Extra Deck ({extraDeck.length}/{EXTRA_DECK_SIZE})
          </h2>
          <div className="DeckBuilder-categoryCounters">
            <CategoryCounter icon={fusionCountIcon} count={extraCounts.Fusion} label="Fusion Monsters" />
            <CategoryCounter icon={ritualCountIcon} count={extraCounts.Ritual} label="Ritual Monsters" />
            <CategoryCounter icon={evolutionCountIcon} count={extraCounts.Evolution} label="Evolution Monsters" />
          </div>
          <div className="DeckBuilder-sectionActions">
            <button type="button" className="DeckBuilder-sortButton" onClick={onSortExtraDeck}>
              Sort
            </button>
            <button type="button" className="DeckBuilder-clearButton" onClick={onClearExtraDeck}>
              Clear
            </button>
          </div>
        </div>
        <DeckSlots
          cards={extraDeck}
          totalSlots={EXTRA_DECK_SIZE}
          columns={EXTRA_DECK_COLUMNS}
          deckName="extra"
          onRemove={onRemoveExtraCard}
          onMove={onMoveExtraCard}
          onDuplicate={onDuplicateExtraCard}
          onDropCard={(payload, targetIndex) => onDropCard(payload, 'extra', targetIndex)}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>

      <div className="DeckBuilder-section">
        <div className="DeckBuilder-sectionHeader">
          <h2 className="DeckBuilder-heading">
            Side Deck ({sideDeck.length}/{SIDE_DECK_SIZE})
          </h2>
          <div className="DeckBuilder-sectionActions">
            <button type="button" className="DeckBuilder-sortButton" onClick={onSortSideDeck}>
              Sort
            </button>
            <button type="button" className="DeckBuilder-clearButton" onClick={onClearSideDeck}>
              Clear
            </button>
          </div>
        </div>
        <DeckSlots
          cards={sideDeck}
          totalSlots={SIDE_DECK_SIZE}
          columns={SIDE_DECK_COLUMNS}
          deckName="side"
          onRemove={onRemoveSideCard}
          onMove={onMoveSideCard}
          onDuplicate={onDuplicateSideCard}
          onDropCard={(payload, targetIndex) => onDropCard(payload, 'side', targetIndex)}
          onCardHover={onCardHover}
          onCardHoverEnd={onCardHoverEnd}
        />
      </div>
    </div>
  );
}

export default DeckBuilder;
