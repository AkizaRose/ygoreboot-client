import { useEffect, useMemo, useState } from 'react';
import Card from '../CardView/Card';
import FilterMenu from './FilterMenu';
import IconButton from './IconButton';
import type { CardData } from '../../types/Card';
import filterIcon from '../../assets/ui/cardbrowser/searchfilters/filter.png';
import filterHoverIcon from '../../assets/ui/cardbrowser/searchfilters/filter_hover.png';
import filterClickIcon from '../../assets/ui/cardbrowser/searchfilters/filter_click.png';
import previousIcon from '../../assets/ui/cardbrowser/searchfilters/previous.png';
import previousHoverIcon from '../../assets/ui/cardbrowser/searchfilters/previous_hover.png';
import previousClickIcon from '../../assets/ui/cardbrowser/searchfilters/previous_click.png';
import previousUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/previous_unselectable.png';
import nextIcon from '../../assets/ui/cardbrowser/searchfilters/next.png';
import nextHoverIcon from '../../assets/ui/cardbrowser/searchfilters/next_hover.png';
import nextClickIcon from '../../assets/ui/cardbrowser/searchfilters/next_click.png';
import nextUnselectableIcon from '../../assets/ui/cardbrowser/searchfilters/next_unselectable.png';
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
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);

  // Card Class filter selection. null means "no filter" (show everything);
  // otherwise show only cards of that one class. Clicking the already-
  // selected option clears it back to null.
  const [selectedCardClass, setSelectedCardClass] = useState<string | null>(null);

  const selectCardClass = (value: string) => {
    setSelectedCardClass((prev) => (prev === value ? null : value));
  };

  // Card Subclass filter selection — depends on Card Class, since the valid
  // options differ per class (Monster subtypes vs Spell/Trap subtypes).
  const [selectedCardSubclass, setSelectedCardSubclass] = useState<string | null>(null);

  const selectCardSubclass = (value: string) => {
    setSelectedCardSubclass((prev) => (prev === value ? null : value));
  };

  // Whenever Card Class changes (including being cleared), any previously
  // selected Card Subclass may no longer be valid for the new class, so
  // clear it.
  useEffect(() => {
    setSelectedCardSubclass(null);
  }, [selectedCardClass]);

  // Attribute filter selection (Monster-only, like Card Subclass and the
  // other stat filters). Cleared whenever Card Class stops being Monster.
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);

  const selectAttribute = (value: string) => {
    setSelectedAttribute((prev) => (prev === value ? null : value));
  };

  useEffect(() => {
    if (selectedCardClass !== 'Monster') {
      setSelectedAttribute(null);
    }
  }, [selectedCardClass]);

  // Monster Type filter selection (Monster-only, same pattern as Attribute).
  const [selectedMonsterType, setSelectedMonsterType] = useState<string | null>(null);

  const selectMonsterType = (value: string) => {
    setSelectedMonsterType((prev) => (prev === value ? null : value));
  };

  useEffect(() => {
    if (selectedCardClass !== 'Monster') {
      setSelectedMonsterType(null);
    }
  }, [selectedCardClass]);

  // Level range filter (Monster-only). 1 and 5 are the full range, i.e. "no
  // filter" — matches the current min/max possible Level values.
  const [levelMin, setLevelMin] = useState(1);
  const [levelMax, setLevelMax] = useState(5);

  // Keep min <= max: moving one past the other drags the other along with
  // it, rather than allowing an inverted (and meaningless) range.
  const changeLevelMin = (value: number) => {
    setLevelMin(value);
    setLevelMax((prevMax) => Math.max(prevMax, value));
  };

  const changeLevelMax = (value: number) => {
    setLevelMax(value);
    setLevelMin((prevMin) => Math.min(prevMin, value));
  };

  useEffect(() => {
    if (selectedCardClass !== 'Monster') {
      setLevelMin(1);
      setLevelMax(5);
    }
  }, [selectedCardClass]);

  // ATK/DEF range filters (Monster-only). Empty string means "no bound" on
  // that side — unlike Level, ATK/DEF has no fixed upper end in this
  // format, so there's no sentinel "full range" pair to reset back to;
  // clearing both fields is what "no filter" looks like.
  const [atkMin, setAtkMin] = useState('');
  const [atkMax, setAtkMax] = useState('');
  const [defMin, setDefMin] = useState('');
  const [defMax, setDefMax] = useState('');

  useEffect(() => {
    if (selectedCardClass !== 'Monster') {
      setAtkMin('');
      setAtkMax('');
      setDefMin('');
      setDefMax('');
    }
  }, [selectedCardClass]);

  // Returns false if `raw` (a card's atk/def string, which may be a
  // non-numeric placeholder like "?") doesn't fall within [min, max] —
  // where an empty min/max string means that side is unbounded.
  const isWithinStatRange = (raw: string | undefined, min: string, max: string) => {
    if (!min && !max) return true;
    const value = Number(raw);
    if (raw == null || !Number.isFinite(value)) return false;
    if (min && value < Number(min)) return false;
    if (max && value > Number(max)) return false;
    return true;
  };

  // Limit filter selection. Unlike every other filter added so far, this
  // one isn't Monster-only — it applies to any card class — so there's no
  // corresponding "reset when Card Class isn't Monster" effect here.
  const [selectedLimit, setSelectedLimit] = useState<string | null>(null);

  const selectLimit = (value: string) => {
    setSelectedLimit((prev) => (prev === value ? null : value));
  };

  const filteredCards = useMemo(() => {
    const name = nameQuery.trim().toLowerCase();
    const text = textQuery.trim().toLowerCase();

    return cards.filter((card) => {
      if (name && !card.name.toLowerCase().includes(name)) return false;
      if (text) {
        const haystack = `${card.effectText ?? ''} ${card.flavourText ?? ''}`.toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      if (selectedCardClass && card.cardClass !== selectedCardClass) {
        return false;
      }
      if (selectedCardSubclass && card.cardSubclass !== selectedCardSubclass) {
        return false;
      }
      if (selectedAttribute && card.attribute !== selectedAttribute) {
        return false;
      }
      if (selectedMonsterType && card.monsterType !== selectedMonsterType) {
        return false;
      }
      if (levelMin !== 1 || levelMax !== 5) {
        if (card.level == null || card.level < levelMin || card.level > levelMax) {
          return false;
        }
      }
      if (!isWithinStatRange(card.atk, atkMin, atkMax)) return false;
      if (!isWithinStatRange(card.def, defMin, defMax)) return false;
      if (selectedLimit && card.limit !== Number(selectedLimit)) return false;
      return true;
    });
  }, [
    cards,
    nameQuery,
    textQuery,
    selectedCardClass,
    selectedCardSubclass,
    selectedAttribute,
    selectedMonsterType,
    levelMin,
    levelMax,
    atkMin,
    atkMax,
    defMin,
    defMax,
    selectedLimit,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARDS_PER_PAGE));

  // Whenever the search terms or filters change, the previous page number
  // may no longer make sense (or may no longer exist) against the new
  // result set, so jump back to page 1.
  useEffect(() => {
    setPage(1);
  }, [
    nameQuery,
    textQuery,
    selectedCardClass,
    selectedCardSubclass,
    selectedAttribute,
    selectedMonsterType,
    levelMin,
    levelMax,
    atkMin,
    atkMax,
    defMin,
    defMax,
    selectedLimit,
  ]);

  // Safety net for any other future changes to the card list that might
  // shrink totalPages out from under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const startIndex = (page - 1) * CARDS_PER_PAGE;
  const pageCards = filteredCards.slice(startIndex, startIndex + CARDS_PER_PAGE);
  const placeholderCount = CARDS_PER_PAGE - pageCards.length;

  const goToPreviousPage = () => setPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setPage((p) => Math.min(totalPages, p + 1));

  // Selections already apply live (see filteredCards above), so Apply just
  // closes the menu and returns to the browser to see the results.
  const handleApplyFilters = () => setIsFilterMenuOpen(false);

  // Clears every filter's selections without closing the menu.
  const handleResetFilters = () => {
    setSelectedCardClass(null);
    // selectedCardSubclass, selectedAttribute, selectedMonsterType, and the
    // Level/ATK/DEF ranges are all cleared automatically by their own
    // "reset when Card Class isn't Monster" effects above. Limit isn't
    // Monster-only, so it needs clearing explicitly here.
    setSelectedLimit(null);
  };

  return (
    <div className="CardBrowser">
      {isFilterMenuOpen ? (
        <FilterMenu
          onApply={handleApplyFilters}
          onReset={handleResetFilters}
          selectedCardClass={selectedCardClass}
          onSelectCardClass={selectCardClass}
          selectedCardSubclass={selectedCardSubclass}
          onSelectCardSubclass={selectCardSubclass}
          selectedAttribute={selectedAttribute}
          onSelectAttribute={selectAttribute}
          selectedMonsterType={selectedMonsterType}
          onSelectMonsterType={selectMonsterType}
          levelMin={levelMin}
          levelMax={levelMax}
          onChangeLevelMin={changeLevelMin}
          onChangeLevelMax={changeLevelMax}
          atkMin={atkMin}
          atkMax={atkMax}
          onChangeAtkMin={setAtkMin}
          onChangeAtkMax={setAtkMax}
          defMin={defMin}
          defMax={defMax}
          onChangeDefMin={setDefMin}
          onChangeDefMax={setDefMax}
          selectedLimit={selectedLimit}
          onSelectLimit={selectLimit}
        />
      ) : (
        <>
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

            <IconButton
              icon={filterIcon}
              hoverIcon={filterHoverIcon}
              clickIcon={filterClickIcon}
              alt="Filters"
              className="CardBrowser-filtersButton"
              onClick={() => setIsFilterMenuOpen(true)}
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
            <IconButton
              icon={previousIcon}
              hoverIcon={previousHoverIcon}
              clickIcon={previousClickIcon}
              disabledIcon={previousUnselectableIcon}
              alt="Previous"
              className="CardBrowser-pageButton"
              onClick={goToPreviousPage}
              disabled={page <= 1}
            />
            <span className="CardBrowser-pageDisplay">
              {page} / {totalPages}
            </span>
            <IconButton
              icon={nextIcon}
              hoverIcon={nextHoverIcon}
              clickIcon={nextClickIcon}
              disabledIcon={nextUnselectableIcon}
              alt="Next"
              className="CardBrowser-pageButton"
              onClick={goToNextPage}
              disabled={page >= totalPages}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default CardBrowser;
