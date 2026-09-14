import { useCallback, useEffect, useRef, useState } from 'react';
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
import CardLayer from '../duel/CardLayer';
import { computeCardPositions } from '../duel/cardPositions';
import { BOARD_WIDTH, STAGE_HEIGHT } from '../duel/cardGeometry';
import { getAvatarUrl } from '../components/Avatar/avatars';
import {
  useMultiplayerDuel,
  TURN_PHASES,
  type PlayerRole,
  type OpponentInfo,
  type MyDuelState,
  type TurnPhase,
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

// Center zone first, then right, then left — the natural order a player
// scans a 3-slot row in.
const ZONE_PRIORITY_ORDER = [1, 2, 0];
function findEmptyZoneSlot(zones: (PlacedCard | null)[]): number {
  for (const index of ZONE_PRIORITY_ORDER) {
    if (zones[index] === null) return index;
  }
  return -1;
}


// A brief delay before showing a newly-hovered card (so quickly passing
// the cursor over several cards doesn't flash through all of them), and
// — see handleCardHoverEnd below — no clearing at all when the cursor
// leaves, so whatever's currently shown stays displayed until a
// different card is deliberately hovered next, rather than disappearing.
const HOVER_DELAY_MS = 100;

// Still not wired up in this pass: Fusion/Evolution Summon, and any
// action from the Main Deck/Extra Deck/Grave/Banished viewers (Special
// Summon, or moving a card from one of those piles elsewhere). Hand and
// field actions — summoning, activating, setting, and every way a card
// moves off the field — are what this pass covers.
function notYetImplemented(action: string) {
  console.info(`[MultiplayerDuelFieldPage] "${action}" isn't wired up for multiplayer yet.`);
}

function duelStatesEqual(a: MyDuelState, b: MyDuelState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
    lastHandDepartureIndex: me.lastHandDepartureIndex,
    handShuffleVersion: me.handShuffleVersion,
  };
}

function MultiplayerDuelFieldPage() {
  const { duelId } = useParams<{ duelId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const state = (location.state ?? {}) as MultiplayerDuelLocationState;

  const {
    loading,
    error,
    me,
    opponent,
    turnPlayer,
    currentPhase,
    turnEnding,
    turnNumber,
    isMyTurn,
  } = useMultiplayerDuel(duelId, state.role, state.opponentInfo, state.myDeckId);

  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  // Shown once, briefly, before the actual field ever renders — see the
  // render guard further down. Starts true on every mount rather than
  // being tied to turnNumber === 1 specifically, since a fresh page load
  // re-runs useMultiplayerDuel's own initialization effect the same way
  // it currently re-shuffles a fresh starting hand on refresh — this
  // banner reappearing on refresh is consistent with that existing
  // behavior, not a new one introduced here.
  const [showFirstPlayerBanner, setShowFirstPlayerBanner] = useState(true);
  const hoverTimeoutRef = useRef<number | undefined>(undefined);
  // Tracks the most recently INTENDED state, updated synchronously by
  // applyMeUpdate the instant it computes a new `next` — well before
  // either of its two writes has gone out, let alone come back. Read by
  // applyMeUpdate itself (so a second rapid action builds on this one's
  // change instead of a stale value), and is where renderMeState below
  // eventually gets its value from too — just not synchronously; see
  // that state's own comment for why. This ref existing at all is what
  // fixes the "card briefly vanishes" bug: `me` is assembled from TWO
  // independently arriving Firestore snapshots (the private hand/deck
  // subcollection, and the public duel document) — a move like Summon
  // touches both (hand is private, monsterZones is public), and those
  // two documents' own listeners don't arrive atomically together. In
  // the gap between them, `me` can genuinely, correctly reflect a card
  // removed from hand but not yet added to monsterZones — nowhere at
  // all, for real, not a rendering bug. latestMeRef never has that
  // problem, since it's computed as one atomic local transform, not
  // assembled from two separate documents.
  const latestMeRef = useRef<MyDuelState | null>(null);
  // Holds the most recent local state that we optimistically rendered while
  // Firestore catches up. Incoming snapshots that do not yet match this
  // state are intermediate halves of the same write (private/public data
  // arriving separately), so rendering them would make the visible board
  // disagree with CardLayer for a frame or remove the moving card entirely.
  const pendingLocalStateRef = useRef<MyDuelState | null>(null);
  // Deliberately a SEPARATE piece of state from latestMeRef, updated one
  // animation frame later (see applyMeUpdate below) rather than in the
  // same synchronous batch as the click itself. latestMeRef alone
  // fixed the "card genuinely vanishes" bug, but introduced a new,
  // more subtle one: the click handler's OWN synchronous state update
  // (e.g. FieldZone's setShowMenu(false)) triggers a batched re-render
  // that picks up latestMeRef's new value immediately — meaning the
  // very first render after the click already shows the FINAL
  // position, with no separate frame ever painted at the old one in
  // between. CSS transitions need two genuinely distinct painted
  // frames to interpolate between, not just two different values
  // computed within the same commit. Deferring this one frame is what
  // gives the browser that gap back, without reintroducing the
  // original bug (this is still always internally consistent — it's
  // set FROM `next`, the same atomic local computation, just applied a
  // moment later).
  const [renderMeState, setRenderMeState] = useState<MyDuelState | null>(null);

  // Keep the visual state in lock-step with the most recent complete `me`
  // snapshot, while ignoring intermediate Firestore snapshots during one of
  // our own local moves. Once Firestore has caught up to the exact optimistic
  // state we asked it to persist, control returns to the live hook state.
  useEffect(() => {
    if (!me) return;

    const pending = pendingLocalStateRef.current;
    if (pending) {
      if (!duelStatesEqual(me, pending)) return;
      pendingLocalStateRef.current = null;
    }

    latestMeRef.current = me;
    setRenderMeState(me);
  }, [me]);

  // Auto-dismisses the "will go first" banner a couple of seconds after
  // turnPlayer first becomes known — before that, there's nothing to
  // announce yet (still waiting on the duel doc's first snapshot), so
  // the timer deliberately doesn't start until turnPlayer is non-null.
  useEffect(() => {
    if (!turnPlayer) return;
    const timeoutId = window.setTimeout(() => setShowFirstPlayerBanner(false), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [turnPlayer]);
  // TEMPORARY DIAGNOSTIC ref — see its use further down, near
  // cardPositionEntries. Remove alongside that code once the animation
  // bug is confirmed fixed.
  const previousEntryIdsRef = useRef<Set<string> | null>(null);
  // TEMPORARY DIAGNOSTIC refs — see their use further down, near
  // cardPositionEntries. Remove alongside that code once the animation
  // bug is confirmed fixed.
  const previousMeRef = useRef<typeof me>(null);
  const previousOpponentRef = useRef<typeof opponent>(null);

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

  // Fusion Summon material-selection step: multi-select, ordered by
  // selection sequence, confirmed explicitly rather than completing on a
  // single click. Once confirmed, the selection itself is done and all
  // that's left is choosing a Battle Position — tracked separately
  // below, since by that point this state has nothing further to
  // contribute.
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
  // deliberately hovered next, matching Deck Builder's own Card Display
  // behavior, rather than disappearing the moment the cursor leaves.
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
  // Card animations (entry rotations, flip-reveals, and all the rest)
  // have been removed from the app entirely for now — see FieldZone.tsx
  // and Hand.tsx for where that used to live — so there's nothing left
  // here to synchronize local, per-client animation state for.
  const applyMeUpdate = async (
    updater: (current: MyDuelState) => MyDuelState,
    options: { shuffleHand?: boolean } = {},
  ) => {
    if (!duelId || !currentUser || !state.role) return;
    const current = latestMeRef.current ?? me;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;

    // Detect a card leaving the hand as part of THIS update, regardless
    // of which action caused it, and record which slot it was at. This
    // is deliberately centralized here rather than in each individual
    // handler — every action that touches hand goes through this one
    // function, so nothing can forget to set this the way a per-handler
    // approach could. Only ever looks at the FIRST departure found if
    // somehow more than one card left in a single update (e.g. a
    // multi-material Fusion Summon drawing more than one from hand) —
    // a reasonable simplification given the common case is exactly one.
    const departedFromHand = current.hand.find(
      (c) => !next.hand.some((n) => n.instanceId === c.instanceId),
    );
    if (departedFromHand) {
      next.lastHandDepartureIndex = current.hand.findIndex(
        (c) => c.instanceId === departedFromHand.instanceId,
      );
    }

    // A card being added to the hand normally triggers the same automatic
    // reshuffle that this project has used since hand-shuffle animation was
    // introduced. Specific actions can opt out — drawing from the Main Deck
    // does this because a normal draw should simply enter the hand without
    // rearranging every other card around it.
    if (options.shuffleHand !== false && next.hand.length > current.hand.length) {
      next.hand = shuffle(next.hand);
      next.handShuffleVersion = current.handShuffleVersion + 1;
    }

    // Synchronous, immediate — before either write below has even been
    // issued, let alone come back. This is what a second action
    // triggered right after this one actually builds on, rather than
    // the stale `me` closure value (which won't reflect this change
    // until its own snapshot round-trips back).
    latestMeRef.current = next;
    pendingLocalStateRef.current = next;

    // Deliberately NOT setRenderMeState(next) here, synchronously — see
    // renderMeState's own comment for why that specifically breaks CSS
    // transitions. One frame later is enough for the browser to have
    // already painted the pre-move position on its own, separate frame
    // (from whatever synchronous state update the click handler itself
    // made, e.g. FieldZone's setShowMenu(false)) before this applies the
    // new one.
    requestAnimationFrame(() => setRenderMeState(next));

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
    }, { shuffleHand: false });

  const handleLifePointChange = (delta: number) =>
    applyMeUpdate((current) => ({
      ...current,
      lifePoints: Math.max(0, current.lifePoints + delta),
    }));

  // A deliberate, player-triggered shuffle — separate from the automatic
  // reshuffle that can happen when a card is added to the hand, but using
  // the exact same handShuffleVersion mechanism for the animation.
  // No length check needed here, unlike applyMeUpdate's own automatic
  // version — this always counts as a shuffle regardless of whether
  // the hand's size happens to have changed.
  const handleShuffleHand = () =>
    applyMeUpdate((current) => ({
      ...current,
      hand: shuffle(current.hand),
      handShuffleVersion: current.handShuffleVersion + 1,
    }));

  // --- Turn / Phase actions ---

  // Writes to the shared, top-level turn/phase fields — unlike
  // applyMeUpdate, this isn't "my own" state to own exclusively: which
  // client is ever allowed to call this for a given transition is
  // enforced entirely by the handlers below (only the turn player
  // advances phases; only the non-turn-player starts their own turn),
  // not by anything at this level.
  const applyTurnUpdate = (
    patch: Partial<{
      turnPlayer: PlayerRole;
      currentPhase: TurnPhase;
      turnEnding: boolean;
      turnNumber: number;
    }>,
  ) => {
    if (!duelId) return;
    setDoc(doc(db, 'duels', duelId), patch, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to update turn state:', err);
    });
  };

  // Turn-player-only, same guard duplicated in PhaseTracker itself (which
  // disables the arrows) — kept here too since PhaseTracker only
  // controls what's clickABLE, not what's possible to call directly.
  const handlePrevPhase = () => {
    if (!isMyTurn || turnEnding || !currentPhase) return;
    const index = TURN_PHASES.indexOf(currentPhase);
    if (index <= 0) return;
    applyTurnUpdate({ currentPhase: TURN_PHASES[index - 1] });
  };

  const handleNextPhase = () => {
    if (!isMyTurn || turnEnding || !currentPhase) return;
    const index = TURN_PHASES.indexOf(currentPhase);
    if (index < TURN_PHASES.length - 1) {
      applyTurnUpdate({ currentPhase: TURN_PHASES[index + 1] });
    } else {
      // Already at End Phase — there's no sixth phase to advance to, so
      // this signals ending the turn instead, handed off via turnEnding
      // rather than a further currentPhase change.
      applyTurnUpdate({ turnEnding: true });
    }
  };

  // Only the player NOT currently turnPlayer can ever call this — the
  // one exception to "only the turn player can interact" (see
  // PhaseTracker's own comment on the same thing), since ending your
  // turn doesn't itself start the other player's; they have to
  // separately claim it.
  const handleStartTurn = () => {
    if (isMyTurn || !turnEnding || !turnPlayer) return;
    const nextTurnPlayer: PlayerRole = turnPlayer === 'player1' ? 'player2' : 'player1';
    applyTurnUpdate({
      turnPlayer: nextTurnPlayer,
      currentPhase: 'draw',
      turnEnding: false,
      turnNumber: turnNumber + 1,
    });
  };

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
    // TEMPORARY DIAGNOSTIC — remove once the animation bug is confirmed
    // fixed. Confirms/denies whether summoning (hand/deck/grave/banished
    // -> field) is what's actually correlated with the "missing card"
    // flicker, rather than the later move to Grave/Banished itself.
    console.log(
      `[completeSummon] summoning instanceId=${pending.instanceId} from source=${pending.source} position=${position}`,
    );
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
        // order once summoned.
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
      // zone.
      const zonesAfterMaterialRemoval = [...current.monsterZones];
      for (const idx of selectedIndices) zonesAfterMaterialRemoval[idx] = null;
      const emptySlot = findEmptyZoneSlot(zonesAfterMaterialRemoval);
      if (emptySlot === -1) return current;

      // Every selected material's WHOLE stack — its own top card plus
      // anything already buried beneath it — becomes buried beneath the
      // newly arriving Fusion Monster, in selection order.
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
  // available Spell/Trap Zone, differing only in faceDown.
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
  // one while one's already there sends the old one to Grave first.
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

  // Every card-departure/state-change action for Monster/Spell-Trap/
  // Field Zone cards, all funneled through one combined MyDuelState
  // write per action rather than several separate setState calls.
  const handleFieldAction = (
    zoneType: 'monster' | 'spellTrap' | 'field',
    index: number,
    actionKey: string,
  ) => {
    // TEMPORARY DIAGNOSTIC — remove once the animation bug is confirmed
    // fixed. Logs exactly what was clicked and which card (if any) was
    // actually at that slot right now, in `me` — so this can be
    // directly compared against whatever instanceId the "MISSING"
    // diagnostic reports, to confirm or rule out whether that event is
    // even caused by this specific click.
    const clickedPlaced =
      zoneType === 'monster'
        ? me?.monsterZones[index]
        : zoneType === 'spellTrap'
          ? me?.spellTrapZones[index]
          : me?.fieldZone;
    console.log(
      `[handleFieldAction] clicked zoneType=${zoneType} index=${index} actionKey=${actionKey} instanceId=${clickedPlaced?.instanceId ?? '(none)'}`,
    );

    if (actionKey === 'attack') return; // no combat system yet

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
      // own destination.
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

  // Shown once, before the field itself ever mounts — turnPlayer is
  // always known by this point (set as part of the same initial write
  // as everything else loading has already waited on above), so this is
  // just "has the timeout in the effect above fired yet."
  if (showFirstPlayerBanner && turnPlayer) {
    const firstPlayerName = turnPlayer === state.role ? currentUser?.displayName : opponent.username;
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p className="MultiplayerDuelFieldPage-firstPlayerAnnouncement">
          {firstPlayerName} will go first
        </p>
      </div>
    );
  }

  // The actual fix for the "card briefly vanishes" bug, combined with
  // renderMeState's own one-frame deferral fix for the "snaps instantly,
  // no transition" bug that fixing the first one introduced — see both
  // renderMeState's and latestMeRef's own declarations above for the
  // full reasoning. Falls back to `me` only before the very first action
  // this session (before renderMeState has ever been set); after that,
  // this is always what rendering uses, never the raw `me`.
  const renderMe = renderMeState ?? me;

  // The opponent's hand now has real geometry (getOpponentHandSlot, in
  // cardGeometry.ts) and renders through CardLayer like every other
  // card — no filtering needed anymore. It used to be excluded here and
  // rendered via a separate, static block below instead, back when its
  // coordinates were only placeholders — which is also why the
  // hand-shuffle animation had no visible effect on the opponent's
  // side: CardLayer's own animated elements existed but weren't the
  // actual visible cards.
  const cardPositionEntries = computeCardPositions(renderMe, opponent);

  // TEMPORARY DIAGNOSTIC — remove once the animation bug is confirmed
  // fixed. Whether me/opponent are literally the SAME object reference
  // as last render — if they're unchanged but cardPositionEntries still
  // differs, that points at non-determinism inside computeCardPositions
  // itself (or something else feeding it) rather than at me/opponent's
  // actual data.
  const meChangedThisRender = previousMeRef.current !== me;
  const opponentChangedThisRender = previousOpponentRef.current !== opponent;
  if (!meChangedThisRender && !opponentChangedThisRender) {
    console.log('[MultiplayerDuelFieldPage] re-rendered with the SAME me/opponent references');
  }
  previousMeRef.current = me;
  previousOpponentRef.current = opponent;

  // TEMPORARY DIAGNOSTIC — remove once the animation bug is confirmed
  // fixed. Two things the mount/unmount log alone can't show: whether
  // the SAME instanceId appears twice in one render's array (a genuine
  // key collision — React would only keep one, and could reasonably
  // treat the "other" occurrence as a fresh mount), or whether an
  // instanceId present in one render is simply absent from the very
  // next one (computeCardPositions momentarily not producing an entry
  // for a card that still exists somewhere in `me`/`opponent`).
  const seenThisRender = new Set<string>();
  for (const entry of cardPositionEntries) {
    if (seenThisRender.has(entry.instanceId)) {
      console.warn(`[CardLayer] DUPLICATE instanceId in one render: ${entry.instanceId}`);
    }
    seenThisRender.add(entry.instanceId);
  }
  if (previousEntryIdsRef.current) {
    for (const id of previousEntryIdsRef.current) {
      if (!seenThisRender.has(id)) {
        console.warn(`[CardLayer] instanceId present last render, MISSING this render: ${id}`);
        // TEMPORARY DIAGNOSTIC — searches `me`/`opponent` directly for
        // this exact instanceId, so we can see whether it's genuinely
        // absent from the underlying state (a real data-level gap) or
        // still present somewhere that computeCardPositions simply
        // isn't producing an entry for (a bug in that function itself,
        // not in the state).
        const locations: string[] = [];
        const checkPlaced = (label: string, placed: PlacedCard | null | undefined) => {
          if (placed?.instanceId === id) locations.push(label);
          if (placed?.stackedBelow?.some((c) => c.instanceId === id)) {
            locations.push(`${label} (buried in stack)`);
          }
        };
        const checkPile = (label: string, pile: CardInstance[] | undefined) => {
          if (pile?.some((c) => c.instanceId === id)) locations.push(label);
        };
        if (renderMe) {
          checkPile('me.hand', renderMe.hand);
          checkPile('me.mainDeck', renderMe.mainDeck);
          checkPile('me.extraDeck', renderMe.extraDeck);
          renderMe.monsterZones.forEach((p, i) => checkPlaced(`me.monsterZones[${i}]`, p));
          renderMe.spellTrapZones.forEach((p, i) => checkPlaced(`me.spellTrapZones[${i}]`, p));
          checkPlaced('me.fieldZone', renderMe.fieldZone);
          checkPile('me.grave', renderMe.grave);
          checkPile('me.banished', renderMe.banished);
        }
        if (opponent) {
          opponent.monsterZones.forEach((p, i) => checkPlaced(`opponent.monsterZones[${i}]`, p));
          opponent.spellTrapZones.forEach((p, i) => checkPlaced(`opponent.spellTrapZones[${i}]`, p));
          checkPlaced('opponent.fieldZone', opponent.fieldZone);
          checkPile('opponent.grave', opponent.grave);
          checkPile('opponent.banished', opponent.banished);
        }
        console.warn(
          `[CardLayer] ${id} actually found in:`,
          locations.length > 0 ? locations : '(nowhere — genuinely absent from me/opponent)',
        );
      }
    }
  }
  previousEntryIdsRef.current = seenThisRender;

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
          {/* The shared coordinate origin DuelField's zones, Hand's
              cells, and CardLayer's rendered cards all agree on — see
              cardGeometry.ts's own module comment for why this needs to
              exist as one real container rather than three
              independently-centered page elements. Explicit
              width/height (from BOARD_WIDTH/STAGE_HEIGHT) rather than
              sizing to content, since content here is either absolutely
              positioned (DuelField's own grid still lays out normally
              inside it, unaffected) or pointer-events:none
              (CardLayer) — nothing here would give this box a natural
              size of its own otherwise. */}
          <div
            className="MultiplayerDuelFieldPage-boardStage"
            style={{ position: 'relative', width: BOARD_WIDTH, height: STAGE_HEIGHT }}
          >
            <DuelField
              playerMainDeck={renderMe.mainDeck.map((c) => c.card)}
              playerExtraDeck={renderMe.extraDeck.map((c) => c.card)}
              playerMonsterZones={renderMe.monsterZones}
              playerSpellTrapZones={renderMe.spellTrapZones}
              playerGrave={renderMe.grave}
              playerBanished={renderMe.banished}
              playerFieldZone={renderMe.fieldZone}
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
                  // A full "restart the game from scratch" Reset makes
                  // sense for a single player, but for two synced players
                  // that would mean either resetting only my own side
                  // (leaving the duel in a broken, mismatched state) or
                  // somehow coordinating both players resetting together,
                  // neither of which this covers yet. Flagged rather than
                  // silently doing the wrong one.
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
              currentPhase={currentPhase}
              turnEnding={turnEnding}
              isMyTurn={isMyTurn}
              onPrevPhase={handlePrevPhase}
              onNextPhase={handleNextPhase}
              onStartTurn={handleStartTurn}
            />

            <Hand
              cards={renderMe.hand}
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

            {/* Renders every card in cardPositionEntries on top of
                everything above — DOM order alone (this is the last
                child) is enough to put it above DuelField's own zone
                chrome and Hand's own cells, without needing an explicit
                z-index war with FieldZone-rotatedOverlay or anything
                else in there. */}
            <CardLayer entries={cardPositionEntries} me={renderMe} opponent={opponent} />
          </div>
        </div>

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
        {/* A row, not stacked with the rest of this column — the button
            sits to the LEFT of the LP counter specifically, at a fixed
            spot relative to it, rather than being just another item in
            the overall vertical stack above. */}
        <div className="MultiplayerDuelFieldPage-lpRow">
          <button
            type="button"
            className="MultiplayerDuelFieldPage-shuffleHandButton"
            onClick={handleShuffleHand}
          >
            Shuffle Hand
          </button>
          <LifePointCounter
            value={renderMe.lifePoints}
            onAdd={(amount) => handleLifePointChange(amount)}
            onSubtract={(amount) => handleLifePointChange(-amount)}
          />
        </div>
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
              ? renderMe.mainDeck
              : viewingOwnPile === 'grave'
                ? renderMe.grave
                : viewingOwnPile === 'banished'
                  ? renderMe.banished
                  : renderMe.extraDeck
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
            const placed = renderMe.monsterZones[viewingOwnStackIndex];
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