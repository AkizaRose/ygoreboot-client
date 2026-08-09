import { useCallback, useRef, useState } from 'react';
import CardBrowser from './components/CardBrowser/CardBrowser';
import DeckBuilder from './components/DeckBuilder/DeckBuilder';
import CardDisplay from './components/CardDisplay/CardDisplay';
import { useDeck } from './components/DeckBuilder/useDeck';
import cardData from './data/carddata.json';
import type { CardData } from './types/Card';
import './App.css';

// How long the cursor has to stay on a card before the Card Display
// updates to show it — long enough that briefly passing over other cards
// (moving toward a button, dragging, etc.) doesn't change what's shown,
// short enough that intentionally checking a card still feels responsive.
const HOVER_DELAY_MS = 100;

function App() {
  const cards = cardData as CardData[];
  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  const hoverTimeoutRef = useRef<number | undefined>(undefined);

  const handleCardHover = useCallback((card: CardData) => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredCard(card);
    }, HOVER_DELAY_MS);
  }, []);

  // Mouse left a card before the delay finished — cancel the pending
  // timer so it never fires. Deliberately does NOT touch hoveredCard
  // itself, since the currently-displayed card should stay put until a
  // different card is hovered for the full delay, not clear the moment
  // the cursor leaves.
  const handleCardHoverEnd = useCallback(() => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);
  const {
    mainDeck,
    extraDeck,
    sideDeck,
    addCard,
    addCardToSide,
    removeMainCardAt,
    removeExtraCardAt,
    removeSideCardAt,
    moveMainCardToSide,
    moveExtraCardToSide,
    moveSideCardToMainOrExtra,
    duplicateMainCardAt,
    duplicateExtraCardAt,
    duplicateSideCardAt,
    dropCardOnDeck,
    sortMainDeck,
    sortExtraDeck,
    sortSideDeck,
    clearMainDeck,
    clearExtraDeck,
    clearSideDeck,
  } = useDeck();

  return (
    <div className="PageContent">
      <CardDisplay card={hoveredCard} />
      <DeckBuilder
        mainDeck={mainDeck}
        extraDeck={extraDeck}
        sideDeck={sideDeck}
        onRemoveMainCard={removeMainCardAt}
        onRemoveExtraCard={removeExtraCardAt}
        onRemoveSideCard={removeSideCardAt}
        onMoveMainCard={moveMainCardToSide}
        onMoveExtraCard={moveExtraCardToSide}
        onMoveSideCard={moveSideCardToMainOrExtra}
        onDuplicateMainCard={duplicateMainCardAt}
        onDuplicateExtraCard={duplicateExtraCardAt}
        onDuplicateSideCard={duplicateSideCardAt}
        onDropCard={dropCardOnDeck}
        onSortMainDeck={sortMainDeck}
        onSortExtraDeck={sortExtraDeck}
        onSortSideDeck={sortSideDeck}
        onClearMainDeck={clearMainDeck}
        onClearExtraDeck={clearExtraDeck}
        onClearSideDeck={clearSideDeck}
        onCardHover={handleCardHover}
        onCardHoverEnd={handleCardHoverEnd}
      />
      <CardBrowser
        cards={cards}
        onCardClick={addCard}
        onCardShiftClick={addCardToSide}
        onCardHover={handleCardHover}
        onCardHoverEnd={handleCardHoverEnd}
      />
    </div>
  );
}

export default App;
