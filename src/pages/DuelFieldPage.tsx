import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DuelField, { type PlacedCard } from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import { shuffle } from '../utils/shuffle';
import cardData from '../data/carddata.json';
import type { CardData } from '../types/Card';
import './DuelFieldPage.css';

// Same debounce behavior as the Deck Builder page's Card Display: the
// cursor has to rest on a card for this long before it updates what's
// shown, and leaving a card early cancels that pending update entirely
// rather than showing it late regardless.
const HOVER_DELAY_MS = 400;

const EMPTY_ZONES: (PlacedCard | null)[] = [null, null, null];

function DuelFieldPage() {
  const navigate = useNavigate();
  const { deckId } = useParams<{ deckId: string }>();
  const { getSavedDeck } = useSavedDecks();
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

  const handleCardHoverEnd = useCallback(() => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);

  // Real mutable state now, not a derived useMemo — drawing needs to
  // actually move a card from mainDeck into hand over the course of the
  // duel, not just compute a fixed snapshot once.
  const [mainDeck, setMainDeck] = useState<CardData[]>([]);
  const [extraDeck, setExtraDeck] = useState<CardData[]>([]);
  const [hand, setHand] = useState<CardData[]>([]);
  const [playerMonsterZones, setPlayerMonsterZones] = useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerSpellTrapZones, setPlayerSpellTrapZones] =
    useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerGrave, setPlayerGrave] = useState<CardData[]>([]);
  const [playerBanished, setPlayerBanished] = useState<CardData[]>([]);
  const [playerFieldZone, setPlayerFieldZone] = useState<PlacedCard | null>(null);
  const [viewingDeck, setViewingDeck] = useState<'main' | 'extra' | 'grave' | 'banished' | null>(
    null,
  );
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // Shared by every summon action (Normal Summon, and Special Summon from
  // each of the four viewers) — rather than duplicating dialog logic at
  // each call site, a handler just calls requestSummonPosition with the
  // card and a callback describing how to actually complete the
  // placement; the callback only runs once a position is chosen.
  const [pendingSummon, setPendingSummon] = useState<{
    card: CardData;
    onSelectPosition: (position: 'attack' | 'defense') => void;
  } | null>(null);

  const requestSummonPosition = (
    card: CardData,
    onSelectPosition: (position: 'attack' | 'defense') => void,
  ) => {
    setPendingSummon({ card, onSelectPosition });
  };

  // Resolves the currently-selected saved deck into real card data,
  // shuffles the Main Deck, and clears every other piece of game state
  // back to a fresh starting point. Extracted as its own function (rather
  // than being inline in the effect below) so the Reset action can call
  // it directly on demand, not just on initial load/deckId change.
  const loadDeck = () => {
    if (!deckId) {
      setMainDeck([]);
      setExtraDeck([]);
      setHand([]);
      setPlayerMonsterZones(EMPTY_ZONES);
      setPlayerSpellTrapZones(EMPTY_ZONES);
      setPlayerGrave([]);
      setPlayerBanished([]);
      setPlayerFieldZone(null);
      return;
    }

    const saved = getSavedDeck(deckId);
    if (!saved) {
      setMainDeck([]);
      setExtraDeck([]);
      setHand([]);
      setPlayerMonsterZones(EMPTY_ZONES);
      setPlayerSpellTrapZones(EMPTY_ZONES);
      setPlayerGrave([]);
      setPlayerBanished([]);
      setPlayerFieldZone(null);
      return;
    }

    const cardsById = new Map(cards.map((c) => [c.id, c]));
    const resolve = (ids: number[]): CardData[] =>
      ids
        .map((id) => {
          const found = cardsById.get(id);
          if (!found) console.warn(`[DuelFieldPage] Saved card id ${id} not found — skipped.`);
          return found;
        })
        .filter((c): c is CardData => !!c);

    // Main Deck: randomized order, per real deck-building rules — then
    // the top 5 are dealt straight into the opening hand. slice() handles
    // a deck with fewer than 5 cards gracefully (just deals what's there,
    // leaving the Main Deck empty rather than throwing).
    const shuffledMain = shuffle(resolve(saved.main));
    const openingHand = shuffledMain.slice(0, 5);
    const remainingMain = shuffledMain.slice(5);

    setMainDeck(remainingMain);
    // Extra Deck: kept in the same order as the Deck Builder — not
    // shuffled, since Extra Deck monsters are chosen deliberately during
    // a duel rather than drawn at random.
    setExtraDeck(resolve(saved.extra));
    setHand(openingHand);
    setPlayerMonsterZones(EMPTY_ZONES);
    setPlayerSpellTrapZones(EMPTY_ZONES);
    setPlayerGrave([]);
    setPlayerBanished([]);
    setPlayerFieldZone(null);
  };

  // (Re)loads whenever deckId changes — e.g. navigating here for a
  // different deck. Runs once per deckId, not on every render.
  useEffect(() => {
    loadDeck();
    // Deliberately depends only on deckId — this should only reload (and
    // re-shuffle) when navigating to a genuinely different deck, not if
    // the saved-decks list happens to change for an unrelated reason
    // while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  const handleDrawCard = () => {
    if (mainDeck.length === 0) return;
    const [top, ...rest] = mainDeck;
    setMainDeck(rest);
    setHand((prev) => [...prev, top]);
  };

  const handleNormalSummon = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;

    const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
    if (emptySlot === -1) return; // no available Monster Zone

    requestSummonPosition(card, (position) => {
      setHand((prev) => prev.filter((_, i) => i !== handIndex));
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { card, faceDown: false, position };
        return next;
      });
    });
  };

  // Shared by Activate and Set — both place a card into the first
  // available Spell/Trap Zone, differing only in faceDown.
  const placeInSpellTrapZone = (handIndex: number, faceDown: boolean) => {
    const card = hand[handIndex];
    if (!card) return;

    const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
    if (emptySlot === -1) return; // no available Spell/Trap Zone

    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    setPlayerSpellTrapZones((prev) => {
      const next = [...prev];
      next[emptySlot] = { card, faceDown };
      return next;
    });
  };

  // Field Spells go to the single Field Zone instead of a Spell/Trap
  // Zone. Unlike those, there's only one slot — activating a new Field
  // Spell while one's already there sends the old one to the Grave first
  // (matching real Yu-Gi-Oh rules), rather than being blocked.
  const placeInFieldZone = (handIndex: number, faceDown: boolean) => {
    const card = hand[handIndex];
    if (!card) return;

    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    if (playerFieldZone) {
      setPlayerGrave((prev) => [...prev, playerFieldZone.card]);
    }
    setPlayerFieldZone({ card, faceDown });
  };

  const handleActivateSpell = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    if (card.cardSubclass === 'Field') {
      placeInFieldZone(handIndex, false);
    } else {
      placeInSpellTrapZone(handIndex, false);
    }
  };

  const handleSetSpellOrTrap = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    if (card.cardSubclass === 'Field') {
      placeInFieldZone(handIndex, true);
    } else {
      placeInSpellTrapZone(handIndex, true);
    }
  };

  const handleToGrave = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    setPlayerGrave((prev) => [...prev, card]);
  };

  const handleBanish = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    setPlayerBanished((prev) => [...prev, card]);
  };

  const handleStackTop = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    setMainDeck((prev) => [card, ...prev]);
  };

  const handleStackBottom = (handIndex: number) => {
    const card = hand[handIndex];
    if (!card) return;
    setHand((prev) => prev.filter((_, i) => i !== handIndex));
    setMainDeck((prev) => [...prev, card]);
  };

  // Same 5 actions apply to a card in any of the three field zones —
  // reads whichever zone/slot the click came from, clears it, then
  // routes the card the same way the equivalent hand actions already do.
  const handleFieldAction = (
    zoneType: 'monster' | 'spellTrap' | 'field',
    index: number,
    actionKey: string,
  ) => {
    // Activate (flip a face-down card face-up) is fundamentally different
    // from the other actions: it stays in the same slot rather than
    // moving/being removed, so it's handled entirely separately before
    // the shared "read card, clear slot, then route it elsewhere" logic
    // below.
    if (actionKey === 'activate') {
      if (zoneType === 'monster') {
        setPlayerMonsterZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, faceDown: false };
          return next;
        });
      } else if (zoneType === 'spellTrap') {
        setPlayerSpellTrapZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, faceDown: false };
          return next;
        });
      } else {
        setPlayerFieldZone((prev) => (prev ? { ...prev, faceDown: false } : prev));
      }
      return;
    }

    // Same "toggle in place" shape as Activate above — only ever applies
    // to Monster Zone cards (the menu only offers this action there).
    if (actionKey === 'toDefense' || actionKey === 'toAttack') {
      const newPosition = actionKey === 'toDefense' ? 'defense' : 'attack';
      if (zoneType === 'monster') {
        setPlayerMonsterZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, position: newPosition };
          return next;
        });
      }
      return;
    }

    const card =
      zoneType === 'monster'
        ? playerMonsterZones[index]?.card
        : zoneType === 'spellTrap'
          ? playerSpellTrapZones[index]?.card
          : playerFieldZone?.card;
    if (!card) return;

    if (zoneType === 'monster') {
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    } else if (zoneType === 'spellTrap') {
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    } else {
      setPlayerFieldZone(null);
    }

    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, card]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, card]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, card]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, card]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [card, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, card]);
        break;
    }
  };

  // Main Deck viewer-specific actions — every card gets To Hand/To Grave/
  // Banish; Monsters additionally get Special Summon. Extra Deck/Grave/
  // Banished viewers don't pass this in at all, so they stay plain.
  const getMainDeckCardActions = (card: CardData) => {
    const actions = [
      { key: 'toHand', label: 'To Hand' },
      { key: 'toGrave', label: 'To Grave' },
      { key: 'banish', label: 'Banish' },
    ];
    if (card.cardClass === 'Monster') {
      actions.push({ key: 'specialSummon', label: 'Special Summon' });
    }
    return actions;
  };

  const handleMainDeckCardAction = (index: number, actionKey: string) => {
    const card = mainDeck[index];
    if (!card) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(card, (position) => {
        setMainDeck((prev) => prev.filter((_, i) => i !== index));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { card, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    setMainDeck((prev) => prev.filter((_, i) => i !== index));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, card]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, card]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, card]);
        break;
    }
  };

  // Extra Deck viewer-specific actions — every card here is already
  // guaranteed to be a Monster (Fusion/Ritual/Evolution routing), so
  // unlike Main Deck's actions there's no per-card-class branching.
  // Deliberately no "To Hand" — Extra Deck monsters go to the field or
  // the Grave/Banished Zone, not back to hand.
  const getExtraDeckCardActions = () => [
    { key: 'toGrave', label: 'To Grave' },
    { key: 'banish', label: 'Banish' },
    { key: 'specialSummon', label: 'Special Summon' },
  ];

  const handleExtraDeckCardAction = (index: number, actionKey: string) => {
    const card = extraDeck[index];
    if (!card) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(card, (position) => {
        setExtraDeck((prev) => prev.filter((_, i) => i !== index));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { card, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    setExtraDeck((prev) => prev.filter((_, i) => i !== index));
    switch (actionKey) {
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, card]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, card]);
        break;
    }
  };

  // Grave viewer-specific actions — different per card type.
  const getGraveCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'specialSummon', label: 'Special Summon' },
      ];
    }

    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'specialSummon', label: 'Special Summon' },
      ];
    }

    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }

    return [];
  };

  const handleGraveCardAction = (index: number, actionKey: string) => {
    const card = playerGrave[index];
    if (!card) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(card, (position) => {
        setPlayerGrave((prev) => prev.filter((_, i) => i !== index));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { card, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (card.cardSubclass === 'Field') {
        setPlayerGrave((prev) => {
          const withoutThisCard = prev.filter((_, i) => i !== index);
          return playerFieldZone ? [...withoutThisCard, playerFieldZone.card] : withoutThisCard;
        });
        setPlayerFieldZone({ card, faceDown: false });
        return;
      }

      const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerGrave((prev) => prev.filter((_, i) => i !== index));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { card, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerGrave((prev) => prev.filter((_, i) => i !== index));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, card]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, card]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, card]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [card, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, card]);
        break;
    }
  };

  // Banished Zone viewer-specific actions — identical to Grave's, except
  // "Banish" is swapped for "To Grave" (a card already in the Banished
  // Zone obviously can't be banished again).
  const getBanishedCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'specialSummon', label: 'Special Summon' },
      ];
    }

    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'specialSummon', label: 'Special Summon' },
      ];
    }

    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'Stack (to top)' },
        { key: 'stackBottom', label: 'Stack (to bottom)' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }

    return [];
  };

  const handleBanishedCardAction = (index: number, actionKey: string) => {
    const card = playerBanished[index];
    if (!card) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(card, (position) => {
        setPlayerBanished((prev) => prev.filter((_, i) => i !== index));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { card, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (card.cardSubclass === 'Field') {
        setPlayerBanished((prev) => prev.filter((_, i) => i !== index));
        if (playerFieldZone) {
          setPlayerGrave((prev) => [...prev, playerFieldZone.card]);
        }
        setPlayerFieldZone({ card, faceDown: false });
        return;
      }

      const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerBanished((prev) => prev.filter((_, i) => i !== index));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { card, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerBanished((prev) => prev.filter((_, i) => i !== index));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, card]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, card]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, card]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [card, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, card]);
        break;
    }
  };

  return (
    <div className="DuelFieldPage">
      <div className="DuelFieldPage-sidePanel">
        <CardDisplay card={hoveredCard} />
      </div>

      <div className="DuelFieldPage-content">
        <div className="DuelFieldPage-topActions">
          <button
            type="button"
            className="DuelFieldPage-exitButton"
            onClick={() => navigate('/duel')}
          >
            Exit
          </button>
        </div>
        <div className="DuelFieldPage-fieldArea">
          <DuelField
            playerMainDeck={mainDeck}
            playerExtraDeck={extraDeck}
            playerMonsterZones={playerMonsterZones}
            playerSpellTrapZones={playerSpellTrapZones}
            playerGrave={playerGrave}
            playerBanished={playerBanished}
            playerFieldZone={playerFieldZone}
            onDrawCard={handleDrawCard}
            onCardHover={handleCardHover}
            onCardHoverEnd={handleCardHoverEnd}
            onFieldAction={handleFieldAction}
            onMainDeckAction={(actionKey) => {
              if (actionKey === 'view') {
                setViewingDeck('main');
              } else if (actionKey === 'shuffle') {
                setMainDeck((prev) => shuffle(prev));
              } else if (actionKey === 'reset') {
                setIsResetConfirmOpen(true);
              }
            }}
            onViewExtraDeck={() => setViewingDeck('extra')}
            onViewGrave={() => setViewingDeck('grave')}
            onViewBanished={() => setViewingDeck('banished')}
          />
        </div>
        <Hand
          cards={hand}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          onNormalSummon={handleNormalSummon}
          onActivateSpell={handleActivateSpell}
          onSetSpellOrTrap={handleSetSpellOrTrap}
          onToGrave={handleToGrave}
          onBanish={handleBanish}
          onStackTop={handleStackTop}
          onStackBottom={handleStackBottom}
        />
      </div>

      {viewingDeck && (
        <DeckViewer
          cards={
            viewingDeck === 'main'
              ? mainDeck
              : viewingDeck === 'extra'
                ? extraDeck
                : viewingDeck === 'grave'
                  ? playerGrave
                  : playerBanished
          }
          onClose={() => {
            if (viewingDeck === 'main') {
              setMainDeck((prev) => shuffle(prev));
            }
            setViewingDeck(null);
          }}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          getCardActions={
            viewingDeck === 'main'
              ? getMainDeckCardActions
              : viewingDeck === 'extra'
                ? getExtraDeckCardActions
                : viewingDeck === 'grave'
                  ? getGraveCardActions
                  : viewingDeck === 'banished'
                    ? getBanishedCardActions
                    : undefined
          }
          onCardAction={
            viewingDeck === 'main'
              ? handleMainDeckCardAction
              : viewingDeck === 'extra'
                ? handleExtraDeckCardAction
                : viewingDeck === 'grave'
                  ? handleGraveCardAction
                  : viewingDeck === 'banished'
                    ? handleBanishedCardAction
                    : undefined
          }
        />
      )}

      {isResetConfirmOpen && (
        <ConfirmDialog
          message="Reset the game? All cards will return to the Main/Extra Deck, and the Main Deck will be reshuffled."
          onConfirm={() => {
            loadDeck();
            setIsResetConfirmOpen(false);
          }}
          onCancel={() => setIsResetConfirmOpen(false)}
        />
      )}

      {pendingSummon && (
        <SummonPositionDialog
          onSelectAttack={() => {
            pendingSummon.onSelectPosition('attack');
            setPendingSummon(null);
          }}
          onSelectDefense={() => {
            pendingSummon.onSelectPosition('defense');
            setPendingSummon(null);
          }}
        />
      )}
    </div>
  );
}

export default DuelFieldPage;
