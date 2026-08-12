import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DuelField from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import { shuffle } from '../utils/shuffle';
import cardData from '../data/carddata.json';
import type { CardData } from '../types/Card';
import { type CardInstance, type PlacedCard, createCardInstance } from '../types/CardInstance';
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

  // Every card that has ever entered play carries a stable instanceId
  // (see src/types/CardInstance.ts) that persists across every move for
  // the rest of the duel — that's what all the arrays below now hold,
  // rather than plain CardData.
  const [mainDeck, setMainDeck] = useState<CardInstance[]>([]);
  const [extraDeck, setExtraDeck] = useState<CardInstance[]>([]);
  const [hand, setHand] = useState<CardInstance[]>([]);
  const [playerMonsterZones, setPlayerMonsterZones] = useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerSpellTrapZones, setPlayerSpellTrapZones] =
    useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerGrave, setPlayerGrave] = useState<CardInstance[]>([]);
  const [playerBanished, setPlayerBanished] = useState<CardInstance[]>([]);
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

  // Per-instanceId starting rotation for a card's very first frame after
  // arriving in Hand — populated only when a card leaves a Monster Zone,
  // so Hand knows whether to visually start it at -90° (if it was in
  // Defense Position) or upright (if not) and animate from there, rather
  // than the rotation just snapping the instant it appears (mirrors the
  // same "no previous frame to animate from" issue the Defense Position
  // summon animation had). Every write is explicit about both cases
  // (-90 or 0) rather than only writing the Defense case and relying on
  // a default for Attack — a card that was once in Defense Position,
  // then switched back to Attack, then later sent to hand, would
  // otherwise still read its old (now-incorrect) -90 entry.
  const [handEntryRotations, setHandEntryRotations] = useState<Record<string, number>>({});
  // Same idea as handEntryRotations, for the flip-reveal effect instead
  // — true means a card leaving a field zone was showing face-down, so
  // Hand should start it "edge-on" and unfurl into its face rather than
  // popping straight in. Always written explicitly (never only for the
  // true case) for the same reason as handEntryRotations: a card that
  // was once face-down, then flipped face-up via Activate, then later
  // sent to hand, must not read a stale "true" from its earlier stint
  // face-down.
  const [handEntryFlips, setHandEntryFlips] = useState<Record<string, boolean>>({});

  // Resolves the currently-selected saved deck into real card instances
  // (each getting a brand-new instanceId here — this is the ONLY place
  // new ones are ever created), shuffles the Main Deck, deals the
  // opening hand, and clears every other piece of game state back to a
  // fresh starting point. Extracted as its own function (rather than
  // being inline in the effect below) so the Reset action can call it
  // directly on demand, not just on initial load/deckId change.
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
      setHandEntryRotations({});
      setHandEntryFlips({});
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
      setHandEntryRotations({});
      setHandEntryFlips({});
      return;
    }

    const cardsById = new Map(cards.map((c) => [c.id, c]));
    const resolve = (ids: number[]): CardInstance[] =>
      ids
        .map((id) => {
          const found = cardsById.get(id);
          if (!found) console.warn(`[DuelFieldPage] Saved card id ${id} not found — skipped.`);
          return found;
        })
        .filter((c): c is CardData => !!c)
        .map((c) => createCardInstance(c));

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
    setHandEntryRotations({});
    setHandEntryFlips({});
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
    setHandEntryFlips((prev) => ({ ...prev, [top.instanceId]: true }));
    setHand((prev) => [...prev, top]);
  };

  const handleNormalSummon = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
    if (emptySlot === -1) return; // no available Monster Zone

    requestSummonPosition(instance.card, (position) => {
      setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false, position };
        return next;
      });
    });
  };

  // Shared by Activate and Set — both place a card into the first
  // available Spell/Trap Zone, differing only in faceDown.
  const placeInSpellTrapZone = (instanceId: string, faceDown: boolean) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
    if (emptySlot === -1) return; // no available Spell/Trap Zone

    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerSpellTrapZones((prev) => {
      const next = [...prev];
      next[emptySlot] = { ...instance, faceDown };
      return next;
    });
  };

  // Field Spells go to the single Field Zone instead of a Spell/Trap
  // Zone. Unlike those, there's only one slot — activating a new Field
  // Spell while one's already there sends the old one to the Grave first
  // (matching real Yu-Gi-Oh rules), rather than being blocked.
  const placeInFieldZone = (instanceId: string, faceDown: boolean) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    if (playerFieldZone) {
      setPlayerGrave((prev) => [...prev, playerFieldZone]);
    }
    setPlayerFieldZone({ ...instance, faceDown });
  };

  const handleActivateSpell = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') {
      placeInFieldZone(instanceId, false);
    } else {
      placeInSpellTrapZone(instanceId, false);
    }
  };

  const handleSetSpellOrTrap = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') {
      placeInFieldZone(instanceId, true);
    } else {
      placeInSpellTrapZone(instanceId, true);
    }
  };

  const handleToGrave = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerGrave((prev) => [...prev, instance]);
  };

  const handleBanish = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerBanished((prev) => [...prev, instance]);
  };

  const handleStackTop = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setMainDeck((prev) => [instance, ...prev]);
  };

  const handleStackBottom = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setMainDeck((prev) => [...prev, instance]);
  };

  // Same 5 actions apply to a card in any of the three field zones —
  // reads whichever zone/slot the click came from (slot index — zones
  // are a fixed-size array, not a dynamic list, so this is stable and
  // doesn't need instanceId), clears it, then routes the card the same
  // way the equivalent hand actions already do.
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

    const placed =
      zoneType === 'monster'
        ? playerMonsterZones[index]
        : zoneType === 'spellTrap'
          ? playerSpellTrapZones[index]
          : playerFieldZone;
    if (!placed) return;

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
        setHandEntryFlips((prev) => ({ ...prev, [placed.instanceId]: placed.faceDown }));
        if (zoneType === 'monster') {
          setHandEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        setHand((prev) => [...prev, placed]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, placed]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, placed]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, placed]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [placed, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, placed]);
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

  const handleMainDeckCardAction = (instanceId: string, actionKey: string) => {
    const instance = mainDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setMainDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    setMainDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, instance]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, instance]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, instance]);
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

  const handleExtraDeckCardAction = (instanceId: string, actionKey: string) => {
    const instance = extraDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setExtraDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    setExtraDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, instance]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, instance]);
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

  const handleGraveCardAction = (instanceId: string, actionKey: string) => {
    const instance = playerGrave.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (instance.card.cardSubclass === 'Field') {
        setPlayerGrave((prev) => {
          const withoutThisCard = prev.filter((i) => i.instanceId !== instanceId);
          return playerFieldZone ? [...withoutThisCard, playerFieldZone] : withoutThisCard;
        });
        setPlayerFieldZone({ ...instance, faceDown: false });
        return;
      }

      const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, instance]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, instance]);
        break;
      case 'banish':
        setPlayerBanished((prev) => [...prev, instance]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [instance, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, instance]);
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

  const handleBanishedCardAction = (instanceId: string, actionKey: string) => {
    const instance = playerBanished.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = playerMonsterZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (instance.card.cardSubclass === 'Field') {
        setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
        if (playerFieldZone) {
          setPlayerGrave((prev) => [...prev, playerFieldZone]);
        }
        setPlayerFieldZone({ ...instance, faceDown: false });
        return;
      }

      const emptySlot = playerSpellTrapZones.findIndex((slot) => slot === null);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHand((prev) => [...prev, instance]);
        break;
      case 'toExtra':
        setExtraDeck((prev) => [...prev, instance]);
        break;
      case 'toGrave':
        setPlayerGrave((prev) => [...prev, instance]);
        break;
      case 'stackTop':
        setMainDeck((prev) => [instance, ...prev]);
        break;
      case 'stackBottom':
        setMainDeck((prev) => [...prev, instance]);
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
            playerMainDeck={mainDeck.map((i) => i.card)}
            playerExtraDeck={extraDeck.map((i) => i.card)}
            playerMainDeckTopCardId={mainDeck[0]?.instanceId}
            playerMonsterZones={playerMonsterZones}
            playerSpellTrapZones={playerSpellTrapZones}
            playerGrave={playerGrave.map((i) => i.card)}
            playerBanished={playerBanished.map((i) => i.card)}
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
          entryRotations={handEntryRotations}
          entryFlips={handEntryFlips}
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
