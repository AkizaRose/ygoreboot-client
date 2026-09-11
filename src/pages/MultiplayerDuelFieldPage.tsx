import { useCallback, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../auth/AuthContext';
import DuelField from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import LifePointCounter from '../components/DuelField/LifePointCounter';
import PlayerAvatarBox from '../components/Avatar/PlayerAvatarBox';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import cardBackImg from '../assets/card/CardBack.png';
import { getAvatarUrl } from '../components/Avatar/avatars';
import {
  useMultiplayerDuel,
  type PlayerRole,
  type OpponentInfo,
  type MyDuelState,
} from '../components/Matchmaking/useMultiplayerDuel';
import type { CardData } from '../types/Card';
import type { CardInstance, PlacedCard } from '../types/CardInstance';
import { shuffle } from '../utils/shuffle';
import './MultiplayerDuelFieldPage.css';

interface MultiplayerDuelLocationState {
  role?: PlayerRole;
  opponentInfo?: OpponentInfo;
  myDeckId?: string;
}

// Matches solo mode's own zone priority (center, right, left) exactly —
// duplicated rather than imported, since it's a tiny, stable helper and
// solo mode's own copy isn't exported for reuse.
const ZONE_PRIORITY_ORDER = [1, 2, 0];
function findEmptyZoneSlot(zones: (PlacedCard | null)[]): number {
  for (const index of ZONE_PRIORITY_ORDER) {
    if (zones[index] === null) return index;
  }
  return -1;
}

// Mirrors Hand.tsx's own card-cell sizing and overlap constants exactly
// — those aren't exported (module-level, private to that file), same
// reasoning as findEmptyZoneSlot above for duplicating rather than
// importing. Kept identical on purpose: the opponent's hand should read
// as the same physical size and follow the same "start overlapping
// beyond N cards, capped at a fixed total width" behavior as the
// player's own.
const OPPONENT_HAND_CARD_WIDTH = 813 * 0.12;
const OPPONENT_HAND_CARD_HEIGHT = 1185 * 0.12;
const OPPONENT_HAND_GAP = 4;
const OPPONENT_HAND_MAX_VISIBLE_CARDS = 6;
const OPPONENT_HAND_MAX_WIDTH =
  OPPONENT_HAND_MAX_VISIBLE_CARDS * OPPONENT_HAND_CARD_WIDTH +
  (OPPONENT_HAND_MAX_VISIBLE_CARDS - 1) * OPPONENT_HAND_GAP;

// Matches DuelFieldPage's (solo mode) own HOVER_DELAY_MS exactly, for
// the same Card Display behavior across both: a brief delay before
// showing a newly-hovered card (so quickly passing the cursor over
// several cards doesn't flash through all of them), and — see
// handleCardHoverEnd below — no clearing at all when the cursor leaves,
// so whatever's currently shown stays displayed until a different card
// is deliberately hovered next, rather than disappearing.
const HOVER_DELAY_MS = 100;

// Still not wired up in this pass: Fusion/Evolution Summon, and any
// action from the Main Deck/Extra Deck/Grave/Banished viewers (Special
// Summon, or moving a card from one of those piles elsewhere). Hand and
// field actions — summoning, activating, setting, and every way a card
// moves off the field — are what this pass covers.
function notYetImplemented(action: string) {
  console.info(`[MultiplayerDuelFieldPage] "${action}" isn't wired up for multiplayer yet.`);
}

function buildPublicState(me: MyDuelState) {
  return {
    lifePoints: me.lifePoints,
    phase: me.phase,
    handCount: me.hand.length,
    mainDeckCount: me.mainDeck.length,
    extraDeckCount: me.extraDeck.length,
    monsterZones: me.monsterZones,
    spellTrapZones: me.spellTrapZones,
    grave: me.grave,
    banished: me.banished,
    fieldZone: me.fieldZone,
  };
}

function MultiplayerDuelFieldPage() {
  const { duelId } = useParams<{ duelId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const state = (location.state ?? {}) as MultiplayerDuelLocationState;

  const { loading, error, me, opponent } = useMultiplayerDuel(
    duelId,
    state.role,
    state.opponentInfo,
    state.myDeckId,
  );

  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  const hoverTimeoutRef = useRef<number | undefined>(undefined);
  const [viewingOwnPile, setViewingOwnPile] = useState<
    'main' | 'grave' | 'banished' | 'extra' | null
  >(null);
  const [viewingOpponentPile, setViewingOpponentPile] = useState<'grave' | 'banished' | null>(
    null,
  );
  const [viewingOwnStackIndex, setViewingOwnStackIndex] = useState<number | null>(null);
  const [viewingOpponentStackIndex, setViewingOpponentStackIndex] = useState<number | null>(
    null,
  );
  // Tracks a summon awaiting a Battle Position choice — source
  // identifies which pile the card is coming from, since Normal Summon
  // (hand) and Special Summon (Extra Deck/Grave/Banished) are otherwise
  // identical from this point on: same dialog, same "place at the first
  // empty Monster Zone slot" logic, just removing the card from a
  // different pile.
  const [pendingSummon, setPendingSummon] = useState<{
    instanceId: string;
    source: 'hand' | 'main' | 'extra' | 'grave' | 'banished';
  } | null>(null);

  // Fusion Summon material-selection step — mirrors solo mode's
  // pendingFusionSummon exactly (multi-select, ordered by selection
  // sequence, confirmed explicitly rather than completing on a single
  // click). Once confirmed, the selection itself is done and all that's
  // left is choosing a Battle Position — tracked separately below, since
  // by that point this state has nothing further to contribute.
  const [pendingFusionSummon, setPendingFusionSummon] = useState<{
    extraDeckInstance: CardInstance;
    selectedIndices: number[];
  } | null>(null);
  const [pendingFusionPositionChoice, setPendingFusionPositionChoice] = useState<{
    extraDeckInstance: CardInstance;
    selectedIndices: number[];
  } | null>(null);

  // Evolution Summon — single-select, no separate Confirm step (exactly
  // one material is ever needed) and no position choice either (Battle
  // Position is inherited from the material, per this ruleset's own
  // rule for Evolution), so this alone is enough to track the whole
  // flow — no position-choice counterpart needed the way Fusion has one.
  const [pendingEvolutionSummon, setPendingEvolutionSummon] = useState<{
    extraDeckInstance: CardInstance;
  } | null>(null);

  const handleCardHover = useCallback((card: CardData) => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredCard(card);
    }, HOVER_DELAY_MS);
  }, []);

  // Deliberately does NOT reset hoveredCard to null — only cancels a
  // not-yet-fired delayed hover (see handleCardHover above). Whatever's
  // already showing stays showing until a different card is
  // deliberately hovered next, matching Solo Mode/Deck Builder's own
  // Card Display behavior, rather than disappearing the moment the
  // cursor leaves.
  const handleCardHoverEnd = useCallback(() => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);

  // Every real action funnels through here: computes the next full
  // MyDuelState from the current one, then writes both halves of it —
  // hand/deck contents to the private subcollection, everything else to
  // this player's own slot in the shared public document. Declining (an
  // updater returning the exact same `current` it was given, e.g. a
  // guard failing to find the card in question) skips the write
  // entirely rather than sending an unnecessary no-op update.
  //
  // Deliberately omits the per-card entry-animation hints solo mode
  // tracks (fieldZoneEntryRotations, handEntryFlips, deckEntryFlips,
  // etc.) — those are purely cosmetic (which way a card visually
  // unrotates or unfurls as it arrives somewhere), not part of the
  // shared duel state at all in this design, and wiring them up for
  // multiplayer would mean synchronizing local, per-client animation
  // state on top of everything else here. Cards still move correctly,
  // they just don't get that extra polish yet.
  const applyMeUpdate = async (updater: (current: MyDuelState) => MyDuelState) => {
    if (!duelId || !currentUser || !me || !state.role) return;
    const next = updater(me);
    if (next === me) return;

    await setDoc(doc(db, 'duels', duelId, 'private', currentUser.uid), {
      hand: next.hand,
      mainDeck: next.mainDeck,
      extraDeck: next.extraDeck,
    });
    await setDoc(
      doc(db, 'duels', duelId),
      { [state.role]: buildPublicState(next) },
      { merge: true },
    );
  };

  const handleDrawCard = () =>
    applyMeUpdate((current) => {
      if (current.mainDeck.length === 0) return current;
      const [drawnCard, ...restDeck] = current.mainDeck;
      return { ...current, hand: [...current.hand, drawnCard], mainDeck: restDeck };
    });

  const handleLifePointChange = (delta: number) =>
    applyMeUpdate((current) => ({
      ...current,
      lifePoints: Math.max(0, current.lifePoints + delta),
    }));

  // --- Hand actions ---

  const handleNormalSummon = (instanceId: string) => {
    if (!me) return;
    const instance = me.hand.find((i) => i.instanceId === instanceId);
    if (!instance || findEmptyZoneSlot(me.monsterZones) === -1) return;
    setPendingSummon({ instanceId, source: 'hand' });
  };

  const completeSummon = (position: 'attack' | 'defense') => {
    const pending = pendingSummon;
    setPendingSummon(null);
    if (!pending) return;
    applyMeUpdate((current) => {
      const sourcePile =
        pending.source === 'hand'
          ? current.hand
          : pending.source === 'main'
            ? current.mainDeck
            : pending.source === 'extra'
              ? current.extraDeck
              : pending.source === 'grave'
                ? current.grave
                : current.banished;
      const instance = sourcePile.find((i) => i.instanceId === pending.instanceId);
      const emptySlot = findEmptyZoneSlot(current.monsterZones);
      if (!instance || emptySlot === -1) return current;

      const nextZones = [...current.monsterZones];
      nextZones[emptySlot] = {
        instanceId: instance.instanceId,
        card: instance.card,
        faceDown: false,
        position,
      };
      const next: MyDuelState = { ...current, monsterZones: nextZones };
      const withoutInstance = (pile: CardInstance[]) =>
        pile.filter((i) => i.instanceId !== pending.instanceId);
      if (pending.source === 'hand') next.hand = withoutInstance(current.hand);
      else if (pending.source === 'main') next.mainDeck = withoutInstance(current.mainDeck);
      else if (pending.source === 'extra') next.extraDeck = withoutInstance(current.extraDeck);
      else if (pending.source === 'grave') next.grave = withoutInstance(current.grave);
      else next.banished = withoutInstance(current.banished);
      return next;
    });
  };

  // --- Fusion Summon ---

  const handleFusionMaterialToggle = (index: number) => {
    setPendingFusionSummon((prev) => {
      if (!prev) return prev;
      const alreadySelected = prev.selectedIndices.includes(index);
      return {
        ...prev,
        // Selection order is preserved (not re-sorted to slot order) —
        // it's what determines the resulting stack's bottom-to-top
        // order once summoned, same as solo mode.
        selectedIndices: alreadySelected
          ? prev.selectedIndices.filter((i) => i !== index)
          : [...prev.selectedIndices, index],
      };
    });
  };

  const handleFusionSummonCancel = () => setPendingFusionSummon(null);

  // Confirming selection doesn't place anything yet — it just hands off
  // to the Battle Position dialog, mirroring how completeSummon above
  // only fires once a position is actually chosen.
  const handleFusionSummonConfirm = () => {
    if (!pendingFusionSummon || pendingFusionSummon.selectedIndices.length === 0) return;
    setPendingFusionPositionChoice(pendingFusionSummon);
    setPendingFusionSummon(null);
  };

  const completeFusionSummon = (position: 'attack' | 'defense') => {
    const pending = pendingFusionPositionChoice;
    setPendingFusionPositionChoice(null);
    if (!pending) return;
    const { extraDeckInstance, selectedIndices } = pending;

    applyMeUpdate((current) => {
      // The materials themselves are about to be removed as part of
      // this very fusion, so their own slots should count as available
      // too — checking findEmptyZoneSlot against the CURRENT zones
      // (still occupied by the materials) would wrongly report no room
      // in the common case where the selected materials fill every
      // zone. Same fix as solo mode's own Fusion Summon needed.
      const zonesAfterMaterialRemoval = [...current.monsterZones];
      for (const idx of selectedIndices) zonesAfterMaterialRemoval[idx] = null;
      const emptySlot = findEmptyZoneSlot(zonesAfterMaterialRemoval);
      if (emptySlot === -1) return current;

      // Every selected material's WHOLE stack — its own top card plus
      // anything already buried beneath it — becomes buried beneath the
      // newly arriving Fusion Monster, in selection order. Same as solo
      // mode's own materialCards construction.
      const materialCards: CardInstance[] = [];
      for (const idx of selectedIndices) {
        const material = current.monsterZones[idx];
        if (!material) continue;
        materialCards.push(...(material.stackedBelow ?? []));
        materialCards.push({ instanceId: material.instanceId, card: material.card });
      }

      const nextZones = [...current.monsterZones];
      for (const idx of selectedIndices) nextZones[idx] = null;
      nextZones[emptySlot] = {
        instanceId: extraDeckInstance.instanceId,
        card: extraDeckInstance.card,
        faceDown: false,
        position,
        stackedBelow: materialCards,
      };

      return {
        ...current,
        monsterZones: nextZones,
        extraDeck: current.extraDeck.filter((i) => i.instanceId !== extraDeckInstance.instanceId),
      };
    });
  };

  // --- Evolution Summon ---

  const handleEvolutionSummonCancel = () => setPendingEvolutionSummon(null);

  // Completes the moment its one material is clicked — no Confirm step
  // (exactly one material is ever needed) and no position dialog either:
  // Battle Position is inherited directly from the material, per this
  // ruleset's own rule for Evolution.
  const handleEvolutionMaterialClick = (index: number) => {
    if (!pendingEvolutionSummon) return;
    const { extraDeckInstance } = pendingEvolutionSummon;
    setPendingEvolutionSummon(null);

    applyMeUpdate((current) => {
      const material = current.monsterZones[index];
      if (!material) return current;
      const position = material.position ?? 'attack';

      const nextZones = [...current.monsterZones];
      // Same zone the material was already in, not the first available
      // one — an Evolution Monster replaces what it evolved from in
      // place, rather than moving elsewhere.
      nextZones[index] = {
        instanceId: extraDeckInstance.instanceId,
        card: extraDeckInstance.card,
        faceDown: false,
        position,
        stackedBelow: [
          ...(material.stackedBelow ?? []),
          { instanceId: material.instanceId, card: material.card },
        ],
      };

      return {
        ...current,
        monsterZones: nextZones,
        extraDeck: current.extraDeck.filter((i) => i.instanceId !== extraDeckInstance.instanceId),
      };
    });
  };

  // Shared by Activate and Set — both place a card into the first
  // available Spell/Trap Zone, differing only in faceDown. Mirrors solo
  // mode's own placeInSpellTrapZone exactly.
  const placeInSpellTrapZone = (instanceId: string, faceDown: boolean) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      const emptySlot = findEmptyZoneSlot(current.spellTrapZones);
      if (!instance || emptySlot === -1) return current;
      const nextZones = [...current.spellTrapZones];
      nextZones[emptySlot] = { instanceId: instance.instanceId, card: instance.card, faceDown };
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        spellTrapZones: nextZones,
      };
    });

  // Field Spells go to the single Field Zone instead — activating a new
  // one while one's already there sends the old one to Grave first,
  // matching solo mode's placeInFieldZone.
  const placeInFieldZone = (instanceId: string, faceDown: boolean) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      if (!instance) return current;
      const nextGrave = current.fieldZone
        ? [
            ...current.grave,
            { instanceId: current.fieldZone.instanceId, card: current.fieldZone.card },
          ]
        : current.grave;
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        grave: nextGrave,
        fieldZone: { instanceId: instance.instanceId, card: instance.card, faceDown },
      };
    });

  const handleActivateSpell = (instanceId: string) => {
    const instance = me?.hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') placeInFieldZone(instanceId, false);
    else placeInSpellTrapZone(instanceId, false);
  };

  const handleSetSpellOrTrap = (instanceId: string) => {
    const instance = me?.hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') placeInFieldZone(instanceId, true);
    else placeInSpellTrapZone(instanceId, true);
  };

  const handleHandToGrave = (instanceId: string) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      if (!instance) return current;
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        grave: [...current.grave, instance],
      };
    });

  const handleHandBanish = (instanceId: string) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      if (!instance) return current;
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        banished: [...current.banished, instance],
      };
    });

  const handleHandStackTop = (instanceId: string) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      if (!instance) return current;
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        mainDeck: [instance, ...current.mainDeck],
      };
    });

  const handleHandStackBottom = (instanceId: string) =>
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      if (!instance) return current;
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        mainDeck: [...current.mainDeck, instance],
      };
    });

  // --- Field actions ---

  // Mirrors solo mode's handleFieldAction exactly, just operating on one
  // combined MyDuelState object per write instead of several separate
  // setState calls.
  const handleFieldAction = (
    zoneType: 'monster' | 'spellTrap' | 'field',
    index: number,
    actionKey: string,
  ) => {
    if (actionKey === 'attack') return; // no combat system yet, same as solo mode

    if (actionKey === 'view') {
      if (zoneType === 'monster') setViewingOwnStackIndex(index);
      return;
    }

    if (actionKey === 'activate' || actionKey === 'set') {
      const faceDown = actionKey === 'set';
      applyMeUpdate((current) => {
        if (zoneType === 'monster') {
          const slot = current.monsterZones[index];
          if (!slot) return current;
          const next = [...current.monsterZones];
          next[index] = { ...slot, faceDown };
          return { ...current, monsterZones: next };
        }
        if (zoneType === 'spellTrap') {
          const slot = current.spellTrapZones[index];
          if (!slot) return current;
          const next = [...current.spellTrapZones];
          next[index] = { ...slot, faceDown };
          return { ...current, spellTrapZones: next };
        }
        if (!current.fieldZone) return current;
        return { ...current, fieldZone: { ...current.fieldZone, faceDown } };
      });
      return;
    }

    if (actionKey === 'toDefense' || actionKey === 'toAttack') {
      if (zoneType !== 'monster') return;
      const newPosition = actionKey === 'toDefense' ? 'defense' : 'attack';
      applyMeUpdate((current) => {
        const slot = current.monsterZones[index];
        if (!slot) return current;
        const next = [...current.monsterZones];
        next[index] = { ...slot, position: newPosition };
        return { ...current, monsterZones: next };
      });
      return;
    }

    if (
      actionKey !== 'toHand' &&
      actionKey !== 'toExtra' &&
      actionKey !== 'toGrave' &&
      actionKey !== 'banish' &&
      actionKey !== 'stackTop' &&
      actionKey !== 'stackBottom'
    ) {
      notYetImplemented(`field action: ${actionKey}`);
      return;
    }

    applyMeUpdate((current) => {
      const placed =
        zoneType === 'monster'
          ? current.monsterZones[index]
          : zoneType === 'spellTrap'
            ? current.spellTrapZones[index]
            : current.fieldZone;
      if (!placed) return current;

      const next: MyDuelState = { ...current };
      if (zoneType === 'monster') {
        const zones = [...current.monsterZones];
        zones[index] = null;
        next.monsterZones = zones;
      } else if (zoneType === 'spellTrap') {
        const zones = [...current.spellTrapZones];
        zones[index] = null;
        next.spellTrapZones = zones;
      } else {
        next.fieldZone = null;
      }

      // Buried cards always go to Grave, regardless of the top card's
      // own destination — same rule as solo mode.
      if (placed.stackedBelow && placed.stackedBelow.length > 0) {
        next.grave = [...next.grave, ...placed.stackedBelow];
      }

      const asCardInstance: CardInstance = { instanceId: placed.instanceId, card: placed.card };
      switch (actionKey) {
        case 'toHand':
          next.hand = [...next.hand, asCardInstance];
          break;
        case 'toExtra':
          next.extraDeck = [asCardInstance, ...next.extraDeck];
          break;
        case 'toGrave':
          next.grave = [...next.grave, asCardInstance];
          break;
        case 'banish':
          next.banished = [...next.banished, asCardInstance];
          break;
        case 'stackTop':
          next.mainDeck = [asCardInstance, ...next.mainDeck];
          break;
        case 'stackBottom':
          next.mainDeck = [...next.mainDeck, asCardInstance];
          break;
      }
      return next;
    });
  };

  // --- Main Deck pile actions (View/Shuffle/Mill/Banish Top/Reset menu) ---

  const handleMillTopCard = () =>
    applyMeUpdate((current) => {
      if (current.mainDeck.length === 0) return current;
      const [top, ...rest] = current.mainDeck;
      return { ...current, mainDeck: rest, grave: [...current.grave, top] };
    });

  const handleBanishTopCard = () =>
    applyMeUpdate((current) => {
      if (current.mainDeck.length === 0) return current;
      const [top, ...rest] = current.mainDeck;
      return { ...current, mainDeck: rest, banished: [...current.banished, top] };
    });

  const handleShuffleMainDeck = () =>
    applyMeUpdate((current) => ({ ...current, mainDeck: shuffle(current.mainDeck) }));

  // --- Main Deck viewer actions (per card, once View is opened) ---

  const getMainDeckCardActions = (card: CardData) => {
    const actions = [
      { key: 'toHand', label: 'To Hand' },
      { key: 'toGrave', label: 'To Grave' },
      { key: 'banish', label: 'Banish' },
    ];
    if (card.cardClass === 'Monster') {
      actions.push({ key: 'specialSummon', label: 'S. Summon' });
    }
    return actions;
  };

  const handleMainDeckCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.mainDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      if (findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'main' });
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.mainDeck.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restDeck = current.mainDeck.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
        case 'toHand':
          return { ...current, mainDeck: restDeck, hand: [...current.hand, inst] };
        case 'toGrave':
          return { ...current, mainDeck: restDeck, grave: [...current.grave, inst] };
        case 'banish':
          return { ...current, mainDeck: restDeck, banished: [...current.banished, inst] };
        default:
          return current;
      }
    });
  };

  // --- Extra Deck viewer actions ---

  const getExtraDeckCardActions = (card: CardData) => [
    { key: 'toGrave', label: 'To Grave' },
    { key: 'banish', label: 'Banish' },
    card.cardSubclass === 'Fusion'
      ? { key: 'fusionSummon', label: 'Fusion Summon' }
      : card.cardSubclass === 'Evolution'
        ? { key: 'evolutionSummon', label: 'Evolution Summon' }
        : { key: 'specialSummon', label: 'S. Summon' },
  ];

  const handleExtraDeckCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.extraDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'fusionSummon') {
      // Closes the viewer so the field itself is visible for material
      // selection — the rest of this flow (toggling monsters, Confirm,
      // choosing a Battle Position) is handled by
      // handleFusionMaterialToggle/handleFusionSummonConfirm and the
      // banner below, not here.
      setViewingOwnPile(null);
      setPendingFusionSummon({ extraDeckInstance: instance, selectedIndices: [] });
      return;
    }

    if (actionKey === 'evolutionSummon') {
      setViewingOwnPile(null);
      setPendingEvolutionSummon({ extraDeckInstance: instance });
      return;
    }

    if (actionKey === 'specialSummon') {
      if (findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'extra' });
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.extraDeck.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restExtra = current.extraDeck.filter((i) => i.instanceId !== instanceId);
      if (actionKey === 'toGrave') {
        return { ...current, extraDeck: restExtra, grave: [...current.grave, inst] };
      }
      if (actionKey === 'banish') {
        return { ...current, extraDeck: restExtra, banished: [...current.banished, inst] };
      }
      return current;
    });
  };

  // --- Grave viewer actions ---

  const getGraveCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }
    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }
    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }
    return [];
  };

  const handleGraveCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.grave.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      if (findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'grave' });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      applyMeUpdate((current) => {
        const inst = current.grave.find((i) => i.instanceId === instanceId);
        if (!inst) return current;
        const restGrave = current.grave.filter((i) => i.instanceId !== instanceId);
        // Field Spells go to the Field Zone instead — same "replace and
        // send the old one to Grave" behavior as Activating one from
        // hand.
        if (inst.card.cardSubclass === 'Field') {
          const nextGrave = current.fieldZone
            ? [
                ...restGrave,
                { instanceId: current.fieldZone.instanceId, card: current.fieldZone.card },
              ]
            : restGrave;
          return {
            ...current,
            grave: nextGrave,
            fieldZone: { instanceId: inst.instanceId, card: inst.card, faceDown: false },
          };
        }
        const emptySlot = findEmptyZoneSlot(current.spellTrapZones);
        if (emptySlot === -1) return current;
        const nextZones = [...current.spellTrapZones];
        nextZones[emptySlot] = { instanceId: inst.instanceId, card: inst.card, faceDown: false };
        return { ...current, grave: restGrave, spellTrapZones: nextZones };
      });
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.grave.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restGrave = current.grave.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
        case 'toHand':
          return { ...current, grave: restGrave, hand: [...current.hand, inst] };
        case 'toExtra':
          return { ...current, grave: restGrave, extraDeck: [inst, ...current.extraDeck] };
        case 'banish':
          return { ...current, grave: restGrave, banished: [...current.banished, inst] };
        case 'stackTop':
          return { ...current, grave: restGrave, mainDeck: [inst, ...current.mainDeck] };
        case 'stackBottom':
          return { ...current, grave: restGrave, mainDeck: [...current.mainDeck, inst] };
        default:
          return current;
      }
    });
  };

  // --- Banished viewer actions ---
  // Identical to Grave's, except "Banish" is swapped for "To Grave" (a
  // card already in the Banished Zone obviously can't be banished
  // again).

  const getBanishedCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }
    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }
    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }
    return [];
  };

  const handleBanishedCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.banished.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      if (findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'banished' });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      applyMeUpdate((current) => {
        const inst = current.banished.find((i) => i.instanceId === instanceId);
        if (!inst) return current;
        const restBanished = current.banished.filter((i) => i.instanceId !== instanceId);
        if (inst.card.cardSubclass === 'Field') {
          const nextGrave = current.fieldZone
            ? [
                ...current.grave,
                { instanceId: current.fieldZone.instanceId, card: current.fieldZone.card },
              ]
            : current.grave;
          return {
            ...current,
            banished: restBanished,
            grave: nextGrave,
            fieldZone: { instanceId: inst.instanceId, card: inst.card, faceDown: false },
          };
        }
        const emptySlot = findEmptyZoneSlot(current.spellTrapZones);
        if (emptySlot === -1) return current;
        const nextZones = [...current.spellTrapZones];
        nextZones[emptySlot] = { instanceId: inst.instanceId, card: inst.card, faceDown: false };
        return { ...current, banished: restBanished, spellTrapZones: nextZones };
      });
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.banished.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restBanished = current.banished.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
        case 'toHand':
          return { ...current, banished: restBanished, hand: [...current.hand, inst] };
        case 'toExtra':
          return { ...current, banished: restBanished, extraDeck: [inst, ...current.extraDeck] };
        case 'toGrave':
          return { ...current, banished: restBanished, grave: [...current.grave, inst] };
        case 'stackTop':
          return { ...current, banished: restBanished, mainDeck: [inst, ...current.mainDeck] };
        case 'stackBottom':
          return { ...current, banished: restBanished, mainDeck: [...current.mainDeck, inst] };
        default:
          return current;
      }
    });
  };

  if (!state.role || !state.opponentInfo || !state.myDeckId) {
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p>This duel's session info was lost — this can happen after a page refresh.</p>
        <button type="button" onClick={() => navigate('/duel')}>
          Back to Duel Menu
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p>{error}</p>
        <button type="button" onClick={() => navigate('/duel')}>
          Back to Duel Menu
        </button>
      </div>
    );
  }

  if (loading || !me || !opponent) {
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p>Waiting for both players to be ready…</p>
      </div>
    );
  }

  return (
    <div className="MultiplayerDuelFieldPage">
      <div className="MultiplayerDuelFieldPage-sidePanel">
        <CardDisplay card={hoveredCard} />
      </div>

      <div className="MultiplayerDuelFieldPage-content">
        <div className="MultiplayerDuelFieldPage-topActions">
          <button type="button" onClick={() => navigate('/duel')}>
            Exit
          </button>
        </div>

        <div className="MultiplayerDuelFieldPage-fieldArea">
          <DuelField
            playerMainDeck={me.mainDeck.map((c) => c.card)}
            playerExtraDeck={me.extraDeck.map((c) => c.card)}
            playerMonsterZones={me.monsterZones}
            playerSpellTrapZones={me.spellTrapZones}
            playerGrave={me.grave}
            playerBanished={me.banished}
            playerFieldZone={me.fieldZone}
            onDrawCard={handleDrawCard}
            onCardHover={handleCardHover}
            onCardHoverEnd={handleCardHoverEnd}
            onFieldAction={handleFieldAction}
            onMainDeckAction={(actionKey) => {
              if (actionKey === 'view') setViewingOwnPile('main');
              else if (actionKey === 'shuffle') handleShuffleMainDeck();
              else if (actionKey === 'mill') handleMillTopCard();
              else if (actionKey === 'banishTop') handleBanishTopCard();
              else if (actionKey === 'reset') {
                // Solo mode's Reset restarts the whole game from
                // scratch — for two synced players that would mean
                // either resetting only my own side (leaving the duel
                // in a broken, mismatched state) or somehow coordinating
                // both players resetting together, neither of which
                // this covers yet. Flagged rather than silently doing
                // the wrong one.
                notYetImplemented('Reset');
              }
            }}
            onViewExtraDeck={() => setViewingOwnPile('extra')}
            onViewGrave={() => setViewingOwnPile('grave')}
            onViewBanished={() => setViewingOwnPile('banished')}
            opponentMainDeckCount={opponent.mainDeckCount}
            opponentExtraDeckCount={opponent.extraDeckCount}
            opponentMonsterZones={opponent.monsterZones}
            opponentSpellTrapZones={opponent.spellTrapZones}
            opponentGrave={opponent.grave}
            opponentBanished={opponent.banished}
            opponentFieldZone={opponent.fieldZone}
            onViewOpponentGrave={() => setViewingOpponentPile('grave')}
            onViewOpponentBanished={() => setViewingOpponentPile('banished')}
            onViewOpponentStack={(index) => setViewingOpponentStackIndex(index)}
            isSelectingFusionMaterial={pendingFusionSummon !== null}
            selectedMaterialIndices={pendingFusionSummon?.selectedIndices ?? []}
            onToggleMaterialSelection={handleFusionMaterialToggle}
            isSelectingEvolutionMaterial={pendingEvolutionSummon !== null}
            onSelectEvolutionMaterial={handleEvolutionMaterialClick}
          />

          {/* A child of fieldArea specifically (not the page root) so its
              horizontal centering is relative to the actual field, not
              the whole page including the Card Display side panel. */}
          {(() => {
            // Same overlap math as Hand.tsx: normal spacing up to
            // OPPONENT_HAND_MAX_VISIBLE_CARDS, then spacing shrinks so
            // the total width stays capped at OPPONENT_HAND_MAX_WIDTH
            // however many cards there are, rather than growing without
            // bound.
            const n = opponent.handCount;
            const normalAdvance = OPPONENT_HAND_CARD_WIDTH + OPPONENT_HAND_GAP;
            const advance =
              n <= 1 || n <= OPPONENT_HAND_MAX_VISIBLE_CARDS
                ? normalAdvance
                : (OPPONENT_HAND_MAX_WIDTH - OPPONENT_HAND_CARD_WIDTH) / (n - 1);
            const handWidth = n === 0 ? 0 : (n - 1) * advance + OPPONENT_HAND_CARD_WIDTH;

            return (
              <div
                className="MultiplayerDuelFieldPage-opponentHand"
                style={{ width: handWidth, height: OPPONENT_HAND_CARD_HEIGHT }}
              >
                {Array.from({ length: n }).map((_, i) => (
                  <img
                    key={i}
                    src={cardBackImg}
                    alt=""
                    className="MultiplayerDuelFieldPage-opponentHandCard"
                    style={{
                      width: OPPONENT_HAND_CARD_WIDTH,
                      height: OPPONENT_HAND_CARD_HEIGHT,
                      left: i * advance,
                    }}
                  />
                ))}
              </div>
            );
          })()}
        </div>

        <Hand
          cards={me.hand}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          onNormalSummon={handleNormalSummon}
          onActivateSpell={handleActivateSpell}
          onSetSpellOrTrap={handleSetSpellOrTrap}
          onToGrave={handleHandToGrave}
          onBanish={handleHandBanish}
          onStackTop={handleHandStackTop}
          onStackBottom={handleHandStackBottom}
        />
      </div>


      <div className="MultiplayerDuelFieldPage-opponentHud">
        {/* Reuses LifePointCounter-display's own steady-state styling,
            reused directly. A plain, non-interactive div rather than
            LifePointCounter itself: a player can never edit their
            opponent's life points, only see them. */}
        <div className="LifePointCounter-display MultiplayerDuelFieldPage-opponentLpDisplay">
          {opponent.lifePoints}
        </div>
        {/* Reuses PlayerAvatarBox's own CSS classes directly (already
            globally available — this page already imports that
            component elsewhere) rather than a separately-styled
            approximation, so this is genuinely the same size/appearance,
            not just a close match. */}
        <div className="PlayerAvatarBox">
          <img src={getAvatarUrl(opponent.avatarId)} alt="" className="PlayerAvatarBox-image" />
        </div>
        <span className="MultiplayerDuelFieldPage-hudUsername">{opponent.username}</span>
      </div>

      <div className="MultiplayerDuelFieldPage-playerHud">
        {/* Same username styling as the opponent's own, just reused here
            too — currentUser.displayName is already established
            elsewhere in the app (e.g. AccountPage) as where a user's own
            username lives. */}
        <span className="MultiplayerDuelFieldPage-hudUsername">
          {currentUser?.displayName}
        </span>
        <PlayerAvatarBox />
        <LifePointCounter
          value={me.lifePoints}
          onAdd={(amount) => handleLifePointChange(amount)}
          onSubtract={(amount) => handleLifePointChange(-amount)}
        />
      </div>

      {pendingSummon && (
        <SummonPositionDialog
          onSelectAttack={() => completeSummon('attack')}
          onSelectDefense={() => completeSummon('defense')}
        />
      )}

      {pendingFusionPositionChoice && (
        <SummonPositionDialog
          onSelectAttack={() => completeFusionSummon('attack')}
          onSelectDefense={() => completeFusionSummon('defense')}
        />
      )}

      {pendingFusionSummon && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>
            Select monsters to use as Fusion Material (
            {pendingFusionSummon.selectedIndices.length} selected)
          </span>
          <button
            type="button"
            onClick={handleFusionSummonConfirm}
            disabled={pendingFusionSummon.selectedIndices.length === 0}
          >
            Confirm
          </button>
          <button type="button" onClick={handleFusionSummonCancel}>
            Cancel
          </button>
        </div>
      )}

      {pendingEvolutionSummon && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>Select a monster to Evolve from</span>
          <button type="button" onClick={handleEvolutionSummonCancel}>
            Cancel
          </button>
        </div>
      )}

      {viewingOwnPile && (
        <DeckViewer
          cards={
            viewingOwnPile === 'main'
              ? me.mainDeck
              : viewingOwnPile === 'grave'
                ? me.grave
                : viewingOwnPile === 'banished'
                  ? me.banished
                  : me.extraDeck
          }
          onClose={() => setViewingOwnPile(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          getCardActions={
            viewingOwnPile === 'main'
              ? getMainDeckCardActions
              : viewingOwnPile === 'grave'
                ? getGraveCardActions
                : viewingOwnPile === 'banished'
                  ? getBanishedCardActions
                  : getExtraDeckCardActions
          }
          onCardAction={
            viewingOwnPile === 'main'
              ? handleMainDeckCardAction
              : viewingOwnPile === 'grave'
                ? handleGraveCardAction
                : viewingOwnPile === 'banished'
                  ? handleBanishedCardAction
                  : handleExtraDeckCardAction
          }
        />
      )}

      {viewingOpponentPile && (
        <DeckViewer
          cards={viewingOpponentPile === 'grave' ? opponent.grave : opponent.banished}
          onClose={() => setViewingOpponentPile(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />
      )}

      {viewingOwnStackIndex !== null && (
        <DeckViewer
          cards={(() => {
            const placed = me.monsterZones[viewingOwnStackIndex];
            if (!placed) return [];
            return [
              { instanceId: placed.instanceId, card: placed.card },
              ...[...(placed.stackedBelow ?? [])].reverse(),
            ];
          })()}
          onClose={() => setViewingOwnStackIndex(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />
      )}

      {viewingOpponentStackIndex !== null && (
        <DeckViewer
          cards={(() => {
            const placed = opponent.monsterZones[viewingOpponentStackIndex];
            if (!placed) return [];
            return [
              { instanceId: placed.instanceId, card: placed.card },
              ...[...(placed.stackedBelow ?? [])].reverse(),
            ];
          })()}
          onClose={() => setViewingOpponentStackIndex(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />
      )}
    </div>
  );
}

export default MultiplayerDuelFieldPage;
