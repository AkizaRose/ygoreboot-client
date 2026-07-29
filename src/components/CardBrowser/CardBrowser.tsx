import { useEffect, useMemo, useState } from 'react';
import Card from '../CardView/Card';
import type { CardData } from '../../types/Card';
import './CardBrowser.css';

// Card is rendered at its native 813x1185 size and then scaled down visually;
// these stay in one place so the grid cell size and the transform always
// agree with each other.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;
const SCALE = 0.08;

const COLUMNS = 5;
const ROWS_PER_PAGE = 5;
const CARDS_PER_PAGE = COLUMNS * ROWS_PER_PAGE;

interface CardBrowserProps {
  cards: CardData[];
}

function CardBrowser({ cards }: CardBrowserProps) {
  const [nameQuery, setNameQuery] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [page, setPage] = useState(1);

  const filteredCards = useMemo(() => {
    const name = nameQuery.trim().toLowerCase();
    const text = textQuery.trim().toLowerCase();

    return cards.filter((card) => {
      if (name && !card.name.toLowerCase().includes(name)) return false;
      if (text) {
        const haystack = `${card.effectText ?? ''} ${card.flavourText ?? ''}`.toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
  }, [cards, nameQuery, textQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARDS_PER_PAGE));

  // Whenever the search terms change, the previous page number may no
  // longer make sense (or may no longer exist) against the new result set,
  // so jump back to page 1.
  useEffect(() => {
    setPage(1);
  }, [nameQuery, textQuery]);

  // Safety net for any other future changes to the card list (e.g. more
  // filters) that might shrink totalPages out from under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const startIndex = (page - 1) * CARDS_PER_PAGE;
  const pageCards = filteredCards.slice(startIndex, startIndex + CARDS_PER_PAGE);
  const placeholderCount = CARDS_PER_PAGE - pageCards.length;

  const goToPreviousPage = () => setPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <div className="CardBrowser">
      <div className="CardBrowser-filters">
        <label className="CardBrowser-filterLabel" htmlFor="card-browser-name-search">
          Name:
        </label>
        <input
          id="card-browser-name-search"
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search by card name..."
        />

        <label className="CardBrowser-filterLabel" htmlFor="card-browser-text-search">
          Text:
        </label>
        <input
          id="card-browser-text-search"
          type="text"
          value={textQuery}
          onChange={(e) => setTextQuery(e.target.value)}
          placeholder="Search by effect / flavor text..."
        />
      </div>

      <div className="CardBrowser-grid">
        {pageCards.map((card) => (
          <div
            key={card.id}
            className="CardBrowser-cell"
            style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
          >
            <div
              className="CardBrowser-cardWrapper"
              style={{
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                transform: `scale(${SCALE})`,
              }}
            >
              <Card card={card} />
            </div>
          </div>
        ))}
        {Array.from({ length: placeholderCount }, (_, i) => (
          <div
            key={`placeholder-${i}`}
            className="CardBrowser-cell CardBrowser-cell--placeholder"
            style={{ width: CARD_WIDTH * SCALE, height: CARD_HEIGHT * SCALE }}
          />
        ))}
      </div>

      <div className="CardBrowser-pagination">
        <button
          type="button"
          onClick={goToPreviousPage}
          disabled={page <= 1}
        >
          Previous
        </button>
        <span className="CardBrowser-pageDisplay">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={goToNextPage}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default CardBrowser;
