import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../auth/AuthContext';
import DuelField from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import LifePointCounter from '../components/DuelField/LifePointCounter';
import useAnimatedCount from '../components/DuelField/useAnimatedCount';
import PlayerAvatarBox from '../components/Avatar/PlayerAvatarBox';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import StatAdjustDialog from '../components/DuelField/StatAdjustDialog';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import CardLayer, { type CardLayerHandle } from '../duel/CardLayer';
import { computeCardPositions } from '../duel/cardPositions';
import { BOARD_WIDTH, STAGE_HEIGHT } from '../duel/cardGeometry';
import { getAvatarUrl } from '../components/Avatar/avatars';
import {
  useMultiplayerDuel,
  TURN_PHASES,
  encodeHandSelection,
  decodeHandSelection,
  OPENING_HAND_SIZE,
  type PlayerRole,
  type OpponentInfo,
  type MyDuelState,
  type TurnPhase,
  type SharedCardVisualPosition,
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

// Requested placement order for the 5-slot row, zones numbered 1-5
// left to right: 3, 4, 2, 5, 1. Expressed here as 0-based array indices
// (zone N is index N-1), so this reads as [2, 3, 1, 4, 0].
const ZONE_PRIORITY_ORDER = [2, 3, 1, 4, 0];
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

function buildPublicState(me: MyDuelState, handRevealed: boolean) {
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
    mainDeckShuffleVersion: me.mainDeckShuffleVersion,
    openingHandDealt: me.openingHandDealt,
    revealedCard: me.revealedCard,
    lastMainDeckReturnSide: me.lastMainDeckReturnSide,
    // Recomputed from the CURRENT hand on every single write, for as
    // long as handRevealed stays true — see PublicPlayerState's own
    // comment on revealedHand for why this needs to be live, not a
    // stale snapshot from the moment "Reveal Hand" was first pressed.
    revealedHand: handRevealed ? me.hand : null,
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
    mySelection,
    opponentSelection,
    pendingControlTransfers,
    pendingCardReturns,
    pendingPileRequests,
    handRevealExitedBy,
    matchConclusion,
    matchWins,
    duelNumber,
    duelStartingRole,
    matchOutcome,
    startNextDuel,
  } = useMultiplayerDuel(duelId, state.role, state.opponentInfo, state.myDeckId);

  // Called unconditionally (hooks can't be conditional), with a
  // fallback for the brief window before the first snapshot arrives and
  // opponent is still null — see the opponent LP display below, which
  // is a plain, non-interactive div (not LifePointCounter itself, which
  // also carries the edit popover this player should never see for
  // their opponent's own life points).
  const opponentDisplayLifePoints = useAnimatedCount(opponent?.lifePoints ?? 0);

  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  // Lets a control-transfer/card-return be animated immediately, locally,
  // the moment it's initiated — rather than only ever discovered via
  // pendingControlTransfers/pendingCardReturns updating, which requires
  // a full round trip to Firestore and back. See CardLayerHandle's own
  // comment for the full reasoning.
  const cardLayerRef = useRef<CardLayerHandle>(null);
  // Which of the player's OWN hand cards, if any, the cursor is
  // currently over — detected by Hand.tsx (see its own
  // onHoveredInstanceChange), consumed by CardLayer purely for the
  // visual hover-lift effect (see that component's own comment on why
  // the detection and the display live in two different places).
  const [hoveredHandInstanceId, setHoveredHandInstanceId] = useState<string | null>(null);
  // Same idea as hoveredHandInstanceId above, but for Monster/Spell-Trap
  // Zone cards on EITHER side (see DuelField's own
  // onFieldInstanceHoverChange) — currently only consumed by CardLayer,
  // to resolve and render the Equip Spell hover-overlay (see that
  // component's own equipOverlayInstanceId).
  const [hoveredFieldInstanceId, setHoveredFieldInstanceId] = useState<string | null>(null);
  // The local toggle behind "Reveal Hand" — see buildPublicState's own
  // revealedHand parameter for what this actually drives. Purely local:
  // only this player's own client needs the raw toggle, since the
  // opponent only ever sees its effect (their own read of
  // opponent.revealedHand being present or absent), not the flag
  // itself.
  const [handRevealed, setHandRevealed] = useState(false);
  // Mirrors handRevealed above, synchronously — applyMeUpdate reads
  // THIS, not the state variable directly, since a toggle needs to
  // trigger a write using the brand-new value immediately, within the
  // same event handler, well before React has re-rendered with
  // setHandRevealed's own update applied. Same reasoning as this file's
  // own latestMeRef/renderMeState split elsewhere.
  const handRevealedRef = useRef(false);
  // Lets the VIEWING player locally dismiss their own view of an active
  // reveal (see the viewer's own onClose below) without needing to
  // affect — or being able to affect — the revealing player's own
  // opponent.revealedHand at all. Reset below whenever a genuinely NEW
  // reveal begins, so dismissing one doesn't silently suppress the
  // next.
  const [handRevealDismissed, setHandRevealDismissed] = useState(false);
  const previousOpponentHandRevealedRef = useRef(false);
  useEffect(() => {
    const isRevealed = opponent?.revealedHand !== null && opponent?.revealedHand !== undefined;
    if (isRevealed && !previousOpponentHandRevealedRef.current) {
      setHandRevealDismissed(false);
    }
    previousOpponentHandRevealedRef.current = isRevealed;
  }, [opponent?.revealedHand]);

  // The initial "are you sure?" prompts — purely local, shown before
  // either action actually writes anything to matchConclusion at all.
  const [showAdmitDefeatConfirm, setShowAdmitDefeatConfirm] = useState(false);
  const [showOfferDrawConfirm, setShowOfferDrawConfirm] = useState(false);
  // Tracks which matchConclusion this client has already clicked OK on
  // (see handleAcknowledgeDrawDeclined), as a stable, derived key rather
  // than the raw object itself — duelDoc is rebuilt fresh from every
  // Firestore snapshot regardless of which field actually changed, so
  // comparing object references directly would treat an unrelated
  // update (e.g. a life point change) as a "new" conclusion to show
  // again. Only drawDeclined uses this now — the other two per-duel
  // outcomes (defeatAdmitted, drawAccepted) no longer show a dialog at
  // all when the match isn't over (see autoAdvancedForDuelNumberRef's
  // own effect further down), and don't need one when it is, since the match
  // outcome dialog covers that.
  const [dismissedMatchConclusionKey, setDismissedMatchConclusionKey] = useState<string | null>(
    null,
  );
  // duelNumber folded into the key so an identical-looking outcome
  // (e.g. the same loserRole admits defeat again in a later duel) is
  // never mistaken for one already dismissed.
  const matchConclusionKey = matchConclusion ? `${duelNumber}:${JSON.stringify(matchConclusion)}` : null;
  // Same idea as dismissedMatchConclusionKey above, for the WHOLE
  // MATCH's own final outcome (see matchOutcomeKey's own use further
  // down) — matchOutcome is permanent once set, so this is what lets
  // "OK" on that dialog actually dismiss it.
  const [dismissedMatchOutcomeKey, setDismissedMatchOutcomeKey] = useState<string | null>(null);
  const matchOutcomeKey = matchOutcome ? JSON.stringify(matchOutcome) : null;
  // The whole MATCH being over (a player has won 2 duels, or both reach
  // 2 via a draw) — not merely the current duel having ended, since an
  // undecided duel result is followed automatically by a fresh duel
  // (see autoAdvancedForDuelNumberRef's own effect below).
  const isMatchOver = matchOutcome !== null;
  // Shown once, briefly, before the actual field ever renders — see the
  // render guard further down. Starts true on every mount rather than
  // being tied to turnNumber === 1 specifically, since a fresh page load
  // re-runs useMultiplayerDuel's own initialization effect the same way
  // it currently re-shuffles a fresh starting hand on refresh — this
  // banner reappearing on refresh is consistent with that existing
  // behavior, not a new one introduced here. Also reused at the start of
  // duel 2/3 (see resetLocalStateForNewDuel below).
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
  // it's actually showing — before turnPlayer is known there's nothing
  // to announce yet (still waiting on the duel doc's first snapshot), so
  // the timer deliberately doesn't start until turnPlayer is non-null.
  // Keyed on showFirstPlayerBanner itself (not just turnPlayer/
  // duelNumber): resetLocalStateForNewDuel flips this back to true when
  // a player clicks OK on the end-of-duel dialog, and by then
  // turnPlayer/duelNumber may already have settled to their new-duel
  // values well before that click happens (matchConclusion, duelNumber
  // and duelStartingRole are all written up front, as soon as the duel
  // ends — not gated on either player acknowledging it). Keying only on
  // turnPlayer/duelNumber meant that once-per-value-change effect had
  // already fired and cleared itself before the banner was ever shown
  // again, so re-showing it later left nothing scheduled to dismiss it —
  // this is what got duel 2/3 permanently stuck on the "will go first"
  // screen. Depending on showFirstPlayerBanner directly guarantees a
  // fresh timer every time the banner turns on, regardless of when the
  // underlying duel-state fields happened to change.
  useEffect(() => {
    if (!turnPlayer || !showFirstPlayerBanner) return;
    const timeoutId = window.setTimeout(() => setShowFirstPlayerBanner(false), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [turnPlayer, duelNumber, showFirstPlayerBanner]);

  // Deals the opening hand one card at a time (both start at 0 — see
  // buildInitialState's own comment) rather than it just being there
  // from the very first snapshot. Re-fires on every hand.length change,
  // which is what naturally chains it into a full sequence: each draw's
  // own state update (via handleDrawCard, the same function every other
  // draw in the game uses, so it animates identically) triggers this
  // effect again, which schedules the next one, until the hand reaches
  // OPENING_HAND_SIZE, at which point openingHandDealt is set instead —
  // see that field's own comment on why this flag, not a live
  // hand.length comparison, is what actually gates this effect: once
  // set, it stays true for the rest of the duel, so this effect can
  // never misfire again later just because hand size happens to dip
  // back below OPENING_HAND_SIZE during normal play (playing a card,
  // discarding, etc.) — a live length check alone can't tell "still
  // dealing the opening hand" apart from that. renderMeState (not the
  // later-declared renderMe) since this runs well before that alias
  // exists in the component body — same underlying value either way. A
  // brief delay between each draw is what actually makes this look
  // like cards arriving one at a time rather than all at once;
  // mainDeck.length === 0 guards a pathologically small deck from
  // looping forever trying to draw cards that don't exist. Gated on
  // !showFirstPlayerBanner because DuelField (and CardLayer, which is
  // what actually animates each draw) doesn't mount at all while that
  // banner is up — without this gate, the whole opening hand would be
  // dealt invisibly before the player ever sees the field, defeating
  // the entire point of dealing it one card at a time in the first
  // place. This also naturally re-fires for duel 2/3: startNextDuel's
  // own fresh publicState resets openingHandDealt to false and hand to
  // [], so once that snapshot arrives this effect picks the deal back
  // up on its own, with no extra plumbing needed.
  useEffect(() => {
    if (showFirstPlayerBanner) return;
    const current = renderMeState ?? me;
    if (!current || current.openingHandDealt) return;
    if (current.hand.length >= OPENING_HAND_SIZE) {
      applyMeUpdate((c) => ({ ...c, openingHandDealt: true }));
      return;
    }
    if (current.mainDeck.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      handleDrawCard();
    }, 450);
    return () => window.clearTimeout(timeoutId);
    // handleDrawCard/applyMeUpdate intentionally not dependencies — same
    // reasoning as the turn-start draw effect just below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showFirstPlayerBanner,
    renderMeState?.hand.length,
    renderMeState?.openingHandDealt,
    me?.hand.length,
    me?.mainDeck.length,
    me?.openingHandDealt,
  ]);

  // Draws exactly one card at the start of the turn player's own turn —
  // including turn 1 for whoever goes first, not just turns claimed via
  // "Start Turn". Keyed on turnNumber (via this ref) rather than firing
  // whenever currentPhase === 'draw', so navigating back to Draw Phase
  // later in the same turn doesn't draw again — this only ever fires
  // once per genuinely NEW turnNumber this client has seen. Gated on
  // !showFirstPlayerBanner so even turn 1's own draw happens once the
  // field is actually visible and CardLayer is mounted to animate it,
  // rather than invisibly while the announcement banner is still up.
  // Also gated on BOTH players' own openingHandDealt — opponent's own
  // is public, so this client can see whether the opponent has finished
  // their opening draw even though it can't see the cards themselves.
  // Without this, turn 1's own draw could interleave with the opening
  // hand still being dealt (e.g. arriving as an out-of-place 6th card
  // partway through), rather than opening hands finishing cleanly
  // before any turn-based drawing begins. Checked via this flag, not a
  // live hand.length/handCount comparison, for the same reason the
  // opening-hand-draw effect above uses it instead of one too: a normal
  // draw later in the game must never be blocked just because either
  // player's hand size happens to be under OPENING_HAND_SIZE at that
  // moment (e.g. after playing several cards) — only whether the
  // ONE-TIME opening deal has ever completed matters here.
  const lastAutoDrawnTurnRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isMyTurn || showFirstPlayerBanner) return;
    if (!me?.openingHandDealt || !opponent?.openingHandDealt) return;
    if (lastAutoDrawnTurnRef.current === turnNumber) return;
    lastAutoDrawnTurnRef.current = turnNumber;
    handleDrawCard();
    // handleDrawCard is intentionally not a dependency — it's redefined
    // every render (not memoized), and the ref-based guard above already
    // makes this effect idempotent per turnNumber regardless of exactly
    // when within that render cycle it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, turnNumber, showFirstPlayerBanner, me?.openingHandDealt, opponent?.openingHandDealt]);
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
  // different pile. 'opponentGrave'/'opponentBanished' are different in
  // one respect — completeSummon branches early for these two, since
  // the card isn't in MY OWN state at all, so there's no pile to remove
  // it from locally; see completeSummon's own comment.
  const [pendingSummon, setPendingSummon] = useState<{
    instanceId: string;
    source: 'hand' | 'main' | 'extra' | 'grave' | 'banished' | 'opponentGrave' | 'opponentBanished';
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

  // Ritual Summon — multi-select like Fusion (a separate Confirm step,
  // then a Battle Position choice), but materials can be tributed from
  // BOTH Monster Zones and hand at once, hence two index lists rather
  // than Fusion's one. Same two-step shape as Fusion's own pair of
  // states above, for the same reason: selecting materials doesn't
  // place anything yet, only choosing a position (completeRitualSummon)
  // actually does.
  const [pendingRitualSummon, setPendingRitualSummon] = useState<{
    extraDeckInstance: CardInstance;
    selectedZoneIndices: number[];
    selectedHandIndices: number[];
  } | null>(null);
  const [pendingRitualPositionChoice, setPendingRitualPositionChoice] = useState<{
    extraDeckInstance: CardInstance;
    selectedZoneIndices: number[];
    selectedHandIndices: number[];
  } | null>(null);

  // Which of the player's own Monster Zone slots (0-2) currently has
  // StatAdjustDialog open, if any — never the opponent's, since
  // onStatsAdjust is only ever wired up for the player's own side (see
  // DuelField.tsx).
  const [pendingStatAdjustIndex, setPendingStatAdjustIndex] = useState<number | null>(null);

  // The origin of a card currently waiting to be relocated — set by
  // "Move" in the hover menu (see handleFieldAction's own 'move' case),
  // cleared once a valid destination is clicked (handleMoveTarget) or
  // the player cancels (handleMoveCancel).
  const [pendingMove, setPendingMove] = useState<{
    zoneType: 'monster' | 'spellTrap';
    index: number;
  } | null>(null);
  // The instanceId of a hand Equip Spell currently waiting on its
  // target monster — set by handleActivateSpell, cleared once a target
  // is confirmed (handleEquipTarget) or the player cancels
  // (handleEquipCancel). Unlike pendingMove above, this only ever needs
  // a single instanceId: the card hasn't been placed anywhere yet, so
  // there's no zone/index of its own to track until a target is chosen.
  const [pendingEquip, setPendingEquip] = useState<string | null>(null);

  // The attacking monster's own zone index while waiting on a target
  // (the "aiming" phase) — set by handleFieldAction's own 'attack'
  // case, cleared once a target is confirmed
  // (handleAttackTargetClick) or the player cancels
  // (handleAttackCancel). Purely local: the opponent has no reason to
  // see a targeting reticle before an attack is actually committed —
  // see PublicPlayerState's own activeAttack, which is what they DO
  // see, once resolved.
  const [pendingAttack, setPendingAttack] = useState<{ index: number } | null>(null);
  // Raw viewport mouse coordinates, tracked only while pendingAttack is
  // active — drives the attack overlay's own rotation in CardLayer (see
  // that component's own pendingAttackMouse prop). null the rest of the
  // time, both so CardLayer doesn't render the aiming overlay at all
  // when there's nothing to aim, and so a stale position from a
  // previous attack never briefly flashes at the start of a new one.
  const [attackMousePosition, setAttackMousePosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    if (!pendingAttack) {
      setAttackMousePosition(null);
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      setAttackMousePosition({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pendingAttack]);

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
    options: {
      shuffleHand?: boolean;
      // Merged into the SAME setDoc call as the public state write
      // below, not a separate one — this is what lets a caller combine
      // this update with a shared, top-level field write (e.g.
      // pendingControlTransfers/pendingCardReturns) as a single atomic
      // commit. Two separate setDoc calls for what's conceptually one
      // action (e.g. "remove this card from my field AND signal the
      // other player to receive it") aren't guaranteed to arrive
      // together or in either particular order — a receiving client
      // could observe the removal before ever seeing the signal it
      // depends on, a real gap where the card exists nowhere at all,
      // not just a rendering glitch.
      //
      // Accepts a function, not just a static value, for callers that
      // don't know what (if anything) needs including until AFTER the
      // updater itself has run — e.g. the generic leave-zone handler,
      // which only learns whether a card needs to return to its true
      // owner by reading its `owner` field from inside the updater.
      // Called after the updater, so any closure-captured values it
      // reads are already populated by then.
      extraFields?: Record<string, unknown> | (() => Record<string, unknown> | undefined);
    } = {},
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
      {
        [state.role]: buildPublicState(next, handRevealedRef.current),
        // Any real action clears BOTH players' selections — selecting a
        // card is deliberately its own separate write (handleSelectCard
        // below) that never goes through applyMeUpdate at all, which is
        // the actual mechanism that keeps selecting itself exempt from
        // this clearing behavior, not a special case here.
        player1Selection: null,
        player2Selection: null,
        ...(typeof options.extraFields === 'function'
          ? options.extraFields()
          : options.extraFields),
      },
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

  // Ends an active "Reveal Hand" — shared by BOTH ways it can end: the
  // revealing player's own "Hide Hand" click, and the viewing player's
  // own "Exit" on the Hand Viewer (see the effect below watching
  // handRevealExitedBy for that second path). Always shuffles the hand
  // and always clears handRevealExitedBy back to null, regardless of
  // which path triggered it — leaving it stale after the SELF path
  // would mean a later, genuinely new signal from the opponent (even
  // reusing the exact same role value) would look unchanged to the
  // effect's own dependency comparison, and be silently missed.
  const endHandReveal = () => {
    handRevealedRef.current = false;
    setHandRevealed(false);
    applyMeUpdate(
      (current) => ({
        ...current,
        hand: shuffle(current.hand),
        handShuffleVersion: current.handShuffleVersion + 1,
      }),
      { extraFields: { handRevealExitedBy: null } },
    );
  };

  // Turns "Reveal Hand" ON specifically — turning it off goes through
  // endHandReveal above instead, since that path additionally needs to
  // shuffle the hand and clear handRevealExitedBy.
  const handleToggleHandReveal = () => {
    if (handRevealedRef.current) {
      endHandReveal();
      return;
    }
    handRevealedRef.current = true;
    setHandRevealed(true);
    // A shallow copy, not the same reference passed straight back —
    // applyMeUpdate treats an updater returning THE SAME object as "no
    // real change, skip the write entirely" (see its own `next ===
    // current` guard), which would otherwise silently skip this write
    // altogether, including the one thing it actually needs to do:
    // recompute revealedHand from the new handRevealedRef value.
    // handRevealExitedBy is cleared defensively here too, in case a
    // previous cycle's signal somehow never made it through
    // endHandReveal's own clear.
    applyMeUpdate((current) => ({ ...current }), { extraFields: { handRevealExitedBy: null } });
  };

  // The revealing player's own side of the opponent-exits-the-viewer
  // handoff — see DuelDoc's own handRevealExitedBy for the full
  // reasoning on why this needs to be a signal at all (the revealing
  // player's own client is the only one that can turn off their own
  // reveal). Only acts when a reveal is genuinely active AND the signal
  // specifically names THIS client's own opponent — a signal from an
  // earlier, already-ended cycle is never left around to misfire here,
  // since endHandReveal always clears it back to null.
  useEffect(() => {
    if (!state.role || !handRevealExitedBy || !handRevealedRef.current) return;
    const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    if (handRevealExitedBy === opponentRole) {
      endHandReveal();
    }
  }, [handRevealExitedBy]);

  // --- Turn / Phase actions ---

  // Battle Phase and Main 2 don't exist for whoever goes first, on
  // their very first turn only. turnNumber === 1 alone is enough to
  // identify that turn specifically — it only ever increments via
  // handleStartTurn below, so the SECOND player's own first turn is
  // already turnNumber 2, never 1. Same 'draw'/'main1'/'end' order as
  // the full list, just with the two skipped phases actually removed
  // rather than merely hidden, so index-based navigation below still
  // works the same way against whichever list applies.
  const FIRST_TURN_PHASES: TurnPhase[] = ['draw', 'main1', 'end'];

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
    setDoc(
      doc(db, 'duels', duelId),
      { ...patch, player1Selection: null, player2Selection: null },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to update turn state:', err);
    });
  };

  // --- Card selection (purely visual — no gameplay effect of its own) ---

  // Deliberately its own setDoc, never routed through applyMeUpdate or
  // applyTurnUpdate — both of those clear BOTH players' selections as
  // part of every write they make (see their own comments), and
  // selecting a card needs to be exempt from that: it only ever touches
  // the CLICKING player's own field, leaving whatever the opponent
  // currently has selected completely untouched. Toggles off if the
  // same target is clicked again — a deliberate, if unstated, piece of
  // reasonable UX (click to select, click again to deselect) alongside
  // "only one card at a time," which the single field itself already
  // guarantees (a new selection simply overwrites the old one).
  const handleSelectCard = (target: string) => {
    if (!duelId || !state.role) return;
    const next = mySelection === target ? null : target;
    setDoc(doc(db, 'duels', duelId), { [`${state.role}Selection`]: next }, { merge: true }).catch(
      (err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to update selection:', err);
      },
    );
  };

  // Clicking a card in the opponent's own revealed-hand viewer — reuses
  // the exact same select-card mechanism as everywhere else (see
  // handleSelectCard above), so it drives the same outline this app
  // already shows on any other selected card. The viewer only ever
  // shows opponent.revealedHand, so the index found here always refers
  // to a card in the OPPONENT's own hand, never this player's own.
  const handleRevealedHandCardClick = (instanceId: string) => {
    if (!opponent?.revealedHand || !state.role) return;
    const index = opponent.revealedHand.findIndex((c) => c.instanceId === instanceId);
    if (index === -1) return;
    const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    handleSelectCard(encodeHandSelection(opponentRole, index));
  };

  // Exiting the opponent's own revealed-hand viewer — dismisses THIS
  // client's own view of it immediately, and separately signals the
  // REVEALING player's own client (via handRevealExitedBy) to actually
  // end their reveal, since only their own client can turn it off (see
  // DuelDoc's own comment on that field for the full reasoning).
  const handleExitOpponentHandView = () => {
    setHandRevealDismissed(true);
    if (!duelId || !state.role) return;
    setDoc(doc(db, 'duels', duelId), { handRevealExitedBy: state.role }, { merge: true }).catch(
      (err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to signal hand reveal exit:', err);
      },
    );
  };

  // --- Admit Defeat / Offer Draw ---

  const handleAdmitDefeatClick = () => setShowAdmitDefeatConfirm(true);
  const handleAdmitDefeatCancel = () => setShowAdmitDefeatConfirm(false);

  const handleAdmitDefeatConfirm = () => {
    setShowAdmitDefeatConfirm(false);
    if (!duelId || !state.role) return;
    const loserRole = state.role;
    const winnerRole: PlayerRole = loserRole === 'player1' ? 'player2' : 'player1';
    const nextWins = { ...matchWins, [winnerRole]: matchWins[winnerRole] + 1 };
    const matchDecided = nextWins[winnerRole] >= 2;
    setDoc(
      doc(db, 'duels', duelId),
      {
        matchConclusion: { type: 'defeatAdmitted', loserRole },
        matchWins: nextWins,
        matchOutcome: matchDecided
          ? { type: winnerRole === 'player1' ? 'player1WinsMatch' : 'player2WinsMatch' }
          : null,
        // The loser of a decisive duel goes first next.
        ...(matchDecided ? {} : { duelNumber: duelNumber + 1, duelStartingRole: loserRole }),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to admit defeat:', err);
    });
  };

  const handleOfferDrawClick = () => setShowOfferDrawConfirm(true);
  const handleOfferDrawCancel = () => setShowOfferDrawConfirm(false);

  const handleOfferDrawConfirm = () => {
    setShowOfferDrawConfirm(false);
    if (!duelId || !state.role) return;
    setDoc(
      doc(db, 'duels', duelId),
      { matchConclusion: { type: 'drawOffered', offererRole: state.role } },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to offer draw:', err);
    });
  };

  // Only ever shown to (and callable by) the player who was OFFERED the
  // draw — see the dialog's own gating further down.
  const handleAcceptDraw = () => {
    if (!duelId || !duelStartingRole) return;
    const nextWins = { player1: matchWins.player1 + 1, player2: matchWins.player2 + 1 };
    const matchOutcomeUpdate =
      nextWins.player1 >= 2 && nextWins.player2 >= 2
        ? ({ type: 'matchDraw' } as const)
        : nextWins.player1 >= 2
          ? ({ type: 'player1WinsMatch' } as const)
          : nextWins.player2 >= 2
            ? ({ type: 'player2WinsMatch' } as const)
            : null;
    // The player who went SECOND in the just-finished duel goes first
    // in the next one.
    const nextStartingRole: PlayerRole = duelStartingRole === 'player1' ? 'player2' : 'player1';
    setDoc(
      doc(db, 'duels', duelId),
      {
        matchConclusion: { type: 'drawAccepted' },
        matchWins: nextWins,
        matchOutcome: matchOutcomeUpdate,
        ...(matchOutcomeUpdate ? {} : { duelNumber: duelNumber + 1, duelStartingRole: nextStartingRole }),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to accept draw:', err);
    });
  };

  const handleDeclineDraw = () => {
    if (!duelId || matchConclusion?.type !== 'drawOffered') return;
    setDoc(
      doc(db, 'duels', duelId),
      { matchConclusion: { type: 'drawDeclined', offererRole: matchConclusion.offererRole } },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to decline draw:', err);
    });
  };

  // Resets purely local, per-duel UI state for a fresh duel — everything
  // server-driven (hand, field, life points, etc.) resets on its own once
  // startNextDuel's own fresh state arrives, but these are local-only and
  // would otherwise carry over stale from the duel that just ended.
  const resetLocalStateForNewDuel = () => {
    // latestMeRef/pendingLocalStateRef/renderMeState (see their own
    // comments above) exist to bridge the gap between an optimistic
    // local move and Firestore catching up — the render-side effect
    // only ever adopts a fresh `me` snapshot once it matches whatever
    // pendingLocalStateRef is still holding. startNextDuel's fresh duel
    // state is never going to match a PREVIOUS duel's pending optimistic
    // move (they're unrelated states entirely), so leaving that ref set
    // meant that effect kept silently rejecting every snapshot of the
    // new duel forever — the player's own board just stayed frozen on
    // duel 1's final state. Clearing all three here (rather than only
    // pendingLocalStateRef) also drops renderMeState back to null so the
    // very next real snapshot is adopted directly, with nothing stale
    // left to render in the meantime.
    latestMeRef.current = null;
    pendingLocalStateRef.current = null;
    setRenderMeState(null);
    setShowFirstPlayerBanner(true);
    lastAutoDrawnTurnRef.current = null;
    setHoveredCard(null);
    setHoveredHandInstanceId(null);
    setHoveredFieldInstanceId(null);
    setHandRevealed(false);
    handRevealedRef.current = false;
    setHandRevealDismissed(false);
    setViewingOwnPile(null);
    setViewingOpponentPile(null);
    setViewingOwnStackIndex(null);
    setViewingOpponentStackIndex(null);
    setPendingAttack(null);
    setAttackMousePosition(null);
    setPendingSummon(null);
    setPendingFusionSummon(null);
    setPendingFusionPositionChoice(null);
    setPendingEvolutionSummon(null);
    setPendingRitualSummon(null);
    setPendingMove(null);
    setPendingEquip(null);
  };

  // Auto-advances straight into the next duel once one has just ended
  // (defeatAdmitted/drawAccepted) and the MATCH itself isn't over yet —
  // no confirmation dialog for this, on either client: a mid-match duel
  // outcome doesn't need a player to click OK before the next duel can
  // start, only the match's own final outcome does (see the matchOutcome
  // dialog further down).
  //
  // autoAdvancedForDuelNumberRef guards against calling startNextDuel
  // more than once for the same transition. duelNumber is already
  // incremented (to the UPCOMING duel) in the very same write that sets
  // matchConclusion, so it's a stable, meaningful key here — unlike
  // matchConclusion itself, which is rebuilt fresh (a new object
  // reference) on every single Firestore snapshot regardless of which
  // field actually changed, including ones THIS effect's own writes
  // cause (starting the next duel touches turnPlayer/currentPhase/etc.,
  // each producing its own snapshot). Without this guard, every one of
  // those self-caused snapshots would re-run the effect and call
  // startNextDuel again before matchConclusion's own clearing write (see
  // below) had a chance to land — a duelNumber-keyed guard is what
  // actually stops that, not the clearing alone.
  //
  // Clearing matchConclusion back to null (both clients do — safe,
  // idempotent, same reasoning as other multi-writer fields elsewhere in
  // this file) matters for a DIFFERENT reason: matchConclusion is
  // otherwise never cleared for defeatAdmitted/drawAccepted at all, so
  // without this it would still read as THIS duel's outcome all the way
  // through the next one too — harmless today since nothing else reads
  // it once matchOutcome is still null, but a landmine for anything that
  // later checks matchConclusion for the CURRENT duel specifically.
  const autoAdvancedForDuelNumberRef = useRef<number | null>(null);
  useEffect(() => {
    if (matchConclusion?.type !== 'defeatAdmitted' && matchConclusion?.type !== 'drawAccepted') return;
    if (matchOutcome) return;
    if (!duelId) return;
    if (autoAdvancedForDuelNumberRef.current === duelNumber) return;
    autoAdvancedForDuelNumberRef.current = duelNumber;
    resetLocalStateForNewDuel();
    startNextDuel();
    setDoc(doc(db, 'duels', duelId), { matchConclusion: null }, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to clear matchConclusion after starting next duel:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchConclusion, matchOutcome, duelId, duelNumber]);

  // Only for the OFFERER's own "declined" dialog — unlike the permanent
  // outcomes above, a decline needs to actually clear matchConclusion
  // back to null so the match resumes normally (buttons re-enabled, a
  // fresh offer possible again). Dismisses locally too, in the same
  // call, so the dialog disappears immediately rather than waiting on
  // this write's own round trip back from Firestore.
  const handleAcknowledgeDrawDeclined = () => {
    setDismissedMatchConclusionKey(matchConclusionKey);
    if (!duelId) return;
    setDoc(doc(db, 'duels', duelId), { matchConclusion: null }, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to acknowledge declined draw:', err);
    });
  };

  // Turn-player-only, same guard duplicated in PhaseTracker itself (which
  // disables the arrows) — kept here too since PhaseTracker only
  // controls what's clickABLE, not what's possible to call directly.
  const handlePrevPhase = () => {
    if (!isMyTurn || turnEnding || !currentPhase) return;
    const phases = turnNumber === 1 ? FIRST_TURN_PHASES : TURN_PHASES;
    const index = phases.indexOf(currentPhase);
    if (index <= 0) return;
    applyTurnUpdate({ currentPhase: phases[index - 1] });
  };

  const handleNextPhase = () => {
    if (!isMyTurn || turnEnding || !currentPhase) return;
    const phases = turnNumber === 1 ? FIRST_TURN_PHASES : TURN_PHASES;
    const index = phases.indexOf(currentPhase);
    if (index < phases.length - 1) {
      applyTurnUpdate({ currentPhase: phases[index + 1] });
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

    if (pending.source === 'opponentGrave' || pending.source === 'opponentBanished') {
      if (!duelId || !state.role) return;
      const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
      // No local state to touch at all here — the card lives entirely
      // in the OPPONENT's own public state, which only their own client
      // can ever write to. This just asks them to act on it; see
      // pendingPileRequests' own comment for the full reasoning, and
      // the receiving effect below for the target-side half of this.
      setDoc(
        doc(db, 'duels', duelId),
        {
          pendingPileRequests: arrayUnion({
            id: crypto.randomUUID(),
            targetRole: opponentRole,
            instanceId: pending.instanceId,
            pile: pending.source === 'opponentGrave' ? 'grave' : 'banished',
            action: 'specialSummon',
            position,
          }),
        },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to request Special Summon:', err);
      });
      return;
    }

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
        // Conditionally spread owner in, rather than always including the
        // key — `owner: material.owner` would write an EXPLICIT
        // `owner: undefined` for the ordinary case of a material that's
        // never changed control, and Firestore's SDK rejects any write
        // containing an explicit undefined value outright (not a silent
        // no-op — the whole write fails).
        materialCards.push({
          instanceId: material.instanceId,
          card: material.card,
          ...(material.owner ? { owner: material.owner } : {}),
        });
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
          {
            instanceId: material.instanceId,
            card: material.card,
            ...(material.owner ? { owner: material.owner } : {}),
          },
        ],
      };

      return {
        ...current,
        monsterZones: nextZones,
        extraDeck: current.extraDeck.filter((i) => i.instanceId !== extraDeckInstance.instanceId),
      };
    });
  };

  // --- Ritual Summon ---
  // Multi-select from both Monster Zones and hand at once (see
  // pendingRitualSummon's own comment for why two index lists), same
  // Confirm-then-Battle-Position two-step shape as Fusion. The one
  // genuine difference from Fusion, beyond the two material sources:
  // every tributed material — zone or hand alike — goes to the Grave
  // outright, never buried beneath the summoned monster (see
  // completeRitualSummon below).

  const handleRitualZoneMaterialToggle = (index: number) => {
    setPendingRitualSummon((prev) => {
      if (!prev) return prev;
      const alreadySelected = prev.selectedZoneIndices.includes(index);
      return {
        ...prev,
        selectedZoneIndices: alreadySelected
          ? prev.selectedZoneIndices.filter((i) => i !== index)
          : [...prev.selectedZoneIndices, index],
      };
    });
  };

  const handleRitualHandMaterialToggle = (index: number) => {
    setPendingRitualSummon((prev) => {
      if (!prev) return prev;
      const alreadySelected = prev.selectedHandIndices.includes(index);
      return {
        ...prev,
        selectedHandIndices: alreadySelected
          ? prev.selectedHandIndices.filter((i) => i !== index)
          : [...prev.selectedHandIndices, index],
      };
    });
  };

  const handleRitualSummonCancel = () => setPendingRitualSummon(null);

  // Confirming selection doesn't place anything yet — it just hands off
  // to the Battle Position dialog, mirroring Fusion's own
  // handleFusionSummonConfirm. At least one material, from either
  // source, is required — unlike Fusion, which only ever draws from one.
  const handleRitualSummonConfirm = () => {
    if (
      !pendingRitualSummon ||
      (pendingRitualSummon.selectedZoneIndices.length === 0 &&
        pendingRitualSummon.selectedHandIndices.length === 0)
    ) {
      return;
    }
    setPendingRitualPositionChoice(pendingRitualSummon);
    setPendingRitualSummon(null);
  };

  const completeRitualSummon = (position: 'attack' | 'defense') => {
    const pending = pendingRitualPositionChoice;
    setPendingRitualPositionChoice(null);
    if (!pending) return;
    const { extraDeckInstance, selectedZoneIndices, selectedHandIndices } = pending;

    applyMeUpdate((current) => {
      // Same reasoning as Fusion's own completeFusionSummon: the
      // tributed zone materials are about to be removed as part of this
      // very summon, so their own slots should count as available too —
      // checking findEmptyZoneSlot against the CURRENT zones (still
      // occupied by the materials) would wrongly report no room in the
      // common case where the selected materials fill every zone.
      const zonesAfterMaterialRemoval = [...current.monsterZones];
      for (const idx of selectedZoneIndices) zonesAfterMaterialRemoval[idx] = null;
      const emptySlot = findEmptyZoneSlot(zonesAfterMaterialRemoval);
      if (emptySlot === -1) return current;

      // Unlike Fusion, tributed materials go straight to the Grave, not
      // buried beneath the summoned monster — but a zone material's
      // WHOLE stack (its own top card plus anything already buried
      // beneath IT) still comes along, same as how Fusion absorbs a
      // material's own buried cards, just to a different destination.
      const graveAdditions: CardInstance[] = [];
      for (const idx of selectedZoneIndices) {
        const material = current.monsterZones[idx];
        if (!material) continue;
        graveAdditions.push(...(material.stackedBelow ?? []));
        // Conditionally spread owner in, rather than always including
        // the key — see Fusion's own identical comment on why.
        graveAdditions.push({
          instanceId: material.instanceId,
          card: material.card,
          ...(material.owner ? { owner: material.owner } : {}),
        });
      }

      // Hand materials are selected by INDEX, so removed high-to-low —
      // splicing out a lower index first would shift every later one
      // out from under its own, still-pending removal.
      const nextHand = [...current.hand];
      const sortedHandIndices = [...selectedHandIndices].sort((a, b) => b - a);
      const handMaterials: CardInstance[] = [];
      for (const idx of sortedHandIndices) {
        const [removed] = nextHand.splice(idx, 1);
        // Rebuilds the original left-to-right hand order in
        // graveAdditions, despite removing highest-index-first above.
        if (removed) handMaterials.unshift(removed);
      }
      graveAdditions.push(...handMaterials);

      const nextZones = [...current.monsterZones];
      for (const idx of selectedZoneIndices) nextZones[idx] = null;
      nextZones[emptySlot] = {
        instanceId: extraDeckInstance.instanceId,
        card: extraDeckInstance.card,
        faceDown: false,
        position,
      };

      return {
        ...current,
        monsterZones: nextZones,
        hand: nextHand,
        grave: [...current.grave, ...graveAdditions],
        extraDeck: current.extraDeck.filter((i) => i.instanceId !== extraDeckInstance.instanceId),
      };
    });
  };

  // --- Stat adjustment ---

  const handleStatsAdjust = (index: number) => setPendingStatAdjustIndex(index);

  const handleStatAdjustCancel = () => setPendingStatAdjustIndex(null);

  const handleStatAdjustConfirm = (atk: number, def: number) => {
    const index = pendingStatAdjustIndex;
    setPendingStatAdjustIndex(null);
    if (index === null) return;
    applyMeUpdate((current) => {
      const slot = current.monsterZones[index];
      if (!slot) return current;
      const nextZones = [...current.monsterZones];
      nextZones[index] = { ...slot, atkOverride: atk, defOverride: def };
      return { ...current, monsterZones: nextZones };
    });
  };

  // Resets to base AND closes the dialog, in one step — no separate
  // confirmation, matching how Cancel also closes immediately rather
  // than asking "are you sure."
  const handleStatAdjustReset = () => {
    const index = pendingStatAdjustIndex;
    setPendingStatAdjustIndex(null);
    if (index === null) return;
    applyMeUpdate((current) => {
      const slot = current.monsterZones[index];
      if (!slot) return current;
      const nextZones = [...current.monsterZones];
      nextZones[index] = { ...slot, atkOverride: null, defOverride: null };
      return { ...current, monsterZones: nextZones };
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
    // Equip Spells specifically need a target monster before they can
    // actually be placed — see pendingEquip's own comment. Every other
    // Spell (including Set Equip Spells, which aren't resolving yet)
    // places immediately, same as before.
    if (instance.card.cardSubclass === 'Equip') {
      setPendingEquip(instanceId);
      return;
    }
    if (instance.card.cardSubclass === 'Field') placeInFieldZone(instanceId, false);
    else placeInSpellTrapZone(instanceId, false);
  };

  const handleSetSpellOrTrap = (instanceId: string) => {
    const instance = me?.hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') placeInFieldZone(instanceId, true);
    else placeInSpellTrapZone(instanceId, true);
  };

  // --- Equip Spell target selection ---

  const handleEquipCancel = () => setPendingEquip(null);

  // Confirms the equip target — targetRole is resolved by the caller
  // (see DuelField.tsx's own onEquipTarget wiring) from which of the
  // two PlayerField instances (flipped or not) was actually clicked, so
  // this doesn't need to work that out itself. Same "nothing is placed
  // until Confirm" approach as placeInSpellTrapZone above — the card
  // stays in hand, completely untouched, for as long as pendingEquip is
  // set.
  const handleEquipTarget = (targetRole: PlayerRole, index: number) => {
    if (!pendingEquip || !state.role) return;
    const instanceId = pendingEquip;
    setPendingEquip(null);
    // Resolved once, outside the updater, when the target is on the
    // OPPONENT's side — their own state isn't touched by this update at
    // all, so there's no "current" equivalent to read it from fresh the
    // way this player's own side is read inside the updater below.
    const opponentTargetInstanceId =
      targetRole !== state.role ? (opponent?.monsterZones[index]?.instanceId ?? null) : null;
    applyMeUpdate((current) => {
      const instance = current.hand.find((i) => i.instanceId === instanceId);
      const emptySlot = findEmptyZoneSlot(current.spellTrapZones);
      if (!instance || emptySlot === -1) return current;
      // Stores the target MONSTER's own instanceId, not its (role,
      // index) — see PlacedCard's own equippedTo comment for why: this
      // way it keeps following the actual monster even if it's later
      // moved to a different zone slot or changes control, rather than
      // staying pinned to whatever ends up in the original slot.
      const targetInstanceId =
        targetRole === state.role
          ? (current.monsterZones[index]?.instanceId ?? null)
          : opponentTargetInstanceId;
      const nextZones = [...current.spellTrapZones];
      nextZones[emptySlot] = {
        instanceId: instance.instanceId,
        card: instance.card,
        faceDown: false,
        equippedTo: targetInstanceId,
      };
      return {
        ...current,
        hand: current.hand.filter((i) => i.instanceId !== instanceId),
        spellTrapZones: nextZones,
      };
    });
  };

  // DuelField's own onEquipTarget only ever reports WHICH SIDE was
  // clicked (flipped: true for the opponent's field) — this resolves
  // that into an actual PlayerRole before calling handleEquipTarget
  // above, the same "flipped -> role" resolution this file already does
  // inline in several other handlers (see e.g.
  // handleRevealedHandCardClick).
  const handleEquipTargetClick = (flipped: boolean, index: number) => {
    if (!state.role) return;
    const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    handleEquipTarget(flipped ? opponentRole : state.role, index);
  };

  // Resolves an attack onto a clicked opponent monster — DuelField's own
  // onAttackTarget only ever fires for the opponent's (flipped) side to
  // begin with (see PlayerFieldProps' own comment on why), so this
  // needs no flipped/role resolution the way handleEquipTargetClick
  // above does.
  const handleAttackTargetClick = (targetIndex: number) => {
    if (!pendingAttack) return;
    const fromIndex = pendingAttack.index;
    setPendingAttack(null);
    applyMeUpdate((current) => ({
      ...current,
      activeAttack: { id: crypto.randomUUID(), fromIndex, toIndex: targetIndex },
    }));
  };

  const handleAttackCancel = () => setPendingAttack(null);

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
        lastMainDeckReturnSide: 'top',
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
        lastMainDeckReturnSide: 'bottom',
      };
    });

  // Where a card can land once it's done passing through (or being
  // shown in) the reveal zone.
  type RevealDestination = 'hand' | 'extraDeck' | 'mainDeckTop' | 'mainDeckBottom';

  const placeAtRevealDestination = (
    current: MyDuelState,
    instance: CardInstance,
    destination: RevealDestination,
  ): MyDuelState => {
    switch (destination) {
      case 'hand':
        return { ...current, hand: [...current.hand, instance] };
      case 'extraDeck':
        return { ...current, extraDeck: [instance, ...current.extraDeck] };
      case 'mainDeckTop':
        return { ...current, mainDeck: [instance, ...current.mainDeck], lastMainDeckReturnSide: 'top' };
      case 'mainDeckBottom':
        return { ...current, mainDeck: [...current.mainDeck, instance], lastMainDeckReturnSide: 'bottom' };
    }
  };

  // Moves a card through the shared, neutral reveal zone (see
  // PublicPlayerState's own revealedCard, and cardGeometry.ts's own
  // getRevealZoneSlot) before it reaches its actual destination — holds
  // it there for holdMs so the opponent has a chance to see what's
  // moving, then continues on. Both the initial move to the reveal zone
  // and the later move onward are ordinary applyMeUpdate writes, no
  // different from any other card action — revealedCard is PUBLIC, so
  // the opponent already sees it the moment it's written, the same way
  // they'd see any other change to this player's own public state. No
  // separate cross-player handoff needed at all, and the card animates
  // via the exact same entries-based mechanism as any other card moving
  // between two of a player's own zones (see cardPositions.ts's own
  // revealZoneEntry) — including the return trip to hand specifically,
  // which additionally gets a real, animated transition on the
  // OPPONENT's own side via containsOpponentInstance/returningCards
  // (see those comments), since revealedCard counts as one of the
  // "known public positions" a card can be seen leaving.
  //
  // removeFromSource both finds the instance AND returns the state with
  // it already removed, so each call site only has to describe ITS OWN
  // source (which pile, and what filtering it needs) — everything about
  // timing, the reveal itself, and the eventual placement lives here,
  // in exactly one place, rather than being duplicated per source.
  const moveCardViaRevealZone = (
    removeFromSource: (current: MyDuelState) => { instance: CardInstance; next: MyDuelState } | null,
    destination: RevealDestination,
    holdMs: number,
  ) => {
    applyMeUpdate((current) => {
      const result = removeFromSource(current);
      if (!result) return current;
      const { instance, next } = result;
      return {
        ...next,
        revealedCard: {
          instanceId: instance.instanceId,
          card: instance.card,
          faceDown: false,
          ...(instance.owner ? { owner: instance.owner } : {}),
        },
      };
    });

    window.setTimeout(() => {
      applyMeUpdate(
        (current) => {
          if (!current.revealedCard) return current;
          const instance: CardInstance = {
            instanceId: current.revealedCard.instanceId,
            card: current.revealedCard.card,
            ...(current.revealedCard.owner ? { owner: current.revealedCard.owner } : {}),
          };
          return placeAtRevealDestination({ ...current, revealedCard: null }, instance, destination);
        },
        // Without this, applyMeUpdate's own automatic reshuffle-on-add
        // (see its own comment on shuffleHand) would fire the instant a
        // hand-destined card lands — immediately, not after the delay
        // below — defeating the entire point of deferring it. Harmless
        // for every other destination, which never grows hand.length at
        // all.
        { shuffleHand: false },
      );

      // Deliberately a SEPARATE write, delayed past the return-to-hand
      // animation itself, rather than bundled into the write above —
      // shuffling bumps handShuffleVersion, which triggers the hand's
      // own fan-out shuffle animation immediately. Doing that in the
      // SAME write as the card leaving the reveal zone meant the two
      // animations visibly overlapped: the card was still animating
      // back into place (see renderReturningCard's own 0.45s duration,
      // the longer of the two — the revealing player's own side uses
      // AnimatedCard's default 0.3s instead) while the shuffle was
      // already fanning the whole hand out from under it. 500ms
      // comfortably covers both, with a little room to spare. Only
      // relevant when the card actually lands in hand — every other
      // destination has no shuffle to delay in the first place.
      if (destination === 'hand') {
        window.setTimeout(() => {
          applyMeUpdate((current) => ({
            ...current,
            hand: shuffle(current.hand),
            handShuffleVersion: current.handShuffleVersion + 1,
          }));
        }, 500);
      }
    }, holdMs);
  };

  // The hand's own "Reveal" action — a 2-second hold, always back to
  // hand. See moveCardViaRevealZone's own comment for the full
  // reasoning; this is now just that function with the hand's own
  // instanceId-based removal described.
  const handleHandReveal = (instanceId: string) => {
    moveCardViaRevealZone(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        if (!instance) return null;
        return {
          instance,
          next: { ...current, hand: current.hand.filter((i) => i.instanceId !== instanceId) },
        };
      },
      'hand',
      2000,
    );
  };

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

    if (actionKey === 'attack') {
      // Skips the whole aiming/targeting flow entirely when there's
      // nothing to target — resolves straight to a direct attack (see
      // PublicPlayerState's own activeAttack, toIndex: null) rather than
      // showing a targeting reticle with nowhere valid to click.
      const opponentHasMonsters = opponent?.monsterZones.some((zone) => zone !== null) ?? false;
      if (!opponentHasMonsters) {
        applyMeUpdate((current) => ({
          ...current,
          activeAttack: { id: crypto.randomUUID(), fromIndex: index, toIndex: null },
        }));
      } else {
        setPendingAttack({ index });
      }
      return;
    }

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

    if (actionKey === 'move') {
      // Never offered for Field Zone (see getPlacedCardActions' own
      // includeMove parameter), so this should be unreachable with
      // zoneType 'field' in practice — the check narrows the type
      // regardless, since pendingMove itself only ever describes a
      // Monster or Spell/Trap Zone slot.
      if (zoneType === 'field') return;
      setPendingMove({ zoneType, index });
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

    // Captured from inside the updater below (which runs synchronously,
    // well before applyMeUpdate's own writes are awaited) — every card
    // from this single action that needs to return to the opponent
    // rather than into my own collections: the top card itself, and/or
    // any individually-owned buried materials (see CardInstance's own
    // `owner` field). Always a single opponent regardless of how many
    // items end up here, since there are only two players in a duel.
    let returnItems: {
      destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
      card: CardInstance;
      from: SharedCardVisualPosition;
    }[] = [];
    let returnToRole: PlayerRole | null = null;

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

      // Buried materials go to Grave regardless of the top card's own
      // destination — but each one individually to its OWN true owner's
      // Grave, not automatically the controller's. A single stack can
      // easily mix materials originally owned by either player.
      if (placed.stackedBelow && placed.stackedBelow.length > 0) {
        const myMaterials: CardInstance[] = [];
        for (const material of placed.stackedBelow) {
          if (material.owner && material.owner !== state.role) {
            // Buried materials get their own rendered entry too (see
            // cardPositions.ts's own stackEntries, which gives every
            // card in a stack its own slightly-offset position, not
            // just the top one) — so this lookup finds a real, distinct
            // entry per material, not a fallback to the top card's own.
            const materialEntry = cardPositionEntries.find(
              (e) => e.instanceId === material.instanceId,
            );
            if (materialEntry) {
              returnItems.push({
                destination: 'grave',
                card: material,
                from: {
                  x: materialEntry.x,
                  y: materialEntry.y,
                  scale: materialEntry.scale,
                  rotation: materialEntry.rotation,
                  faceDown: materialEntry.faceDown,
                },
              });
              returnToRole = material.owner;
            } else {
              // No known rendered position for this material — nothing
              // honest to animate from, so it's returned without one
              // (CardLayer just lets it appear once the real entry
              // does, same as any card with no prior position at all).
              myMaterials.push(material);
            }
          } else {
            myMaterials.push(material);
          }
        }
        if (myMaterials.length > 0) {
          next.grave = [...next.grave, ...myMaterials];
        }
      }

      const asCardInstance: CardInstance = {
        instanceId: placed.instanceId,
        card: placed.card,
        ...(placed.owner ? { owner: placed.owner } : {}),
      };

      // Unset owner, or an owner matching me, both mean I'm the true
      // owner — the ordinary case for a card that's never changed
      // control, handled exactly as before. Only a DIFFERENT owner
      // means this card needs to go back to them instead of into my
      // own collections.
      if (placed.owner && placed.owner !== state.role) {
        const destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck' =
          actionKey === 'toHand'
            ? 'hand'
            : actionKey === 'toExtra'
              ? 'extraDeck'
              : actionKey === 'toGrave'
                ? 'grave'
                : actionKey === 'banish'
                  ? 'banished'
                  : actionKey === 'stackTop'
                    ? 'mainDeckTop'
                    : 'mainDeckBottom';
        const topEntry = cardPositionEntries.find((e) => e.instanceId === placed.instanceId);
        if (topEntry) {
          returnItems.push({
            destination,
            card: asCardInstance,
            from: {
              x: topEntry.x,
              y: topEntry.y,
              scale: topEntry.scale,
              rotation: topEntry.rotation,
              faceDown: topEntry.faceDown,
            },
          });
          returnToRole = placed.owner;
        }
        return next;
      }

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
          next.lastMainDeckReturnSide = 'top';
          break;
        case 'stackBottom':
          next.mainDeck = [...next.mainDeck, asCardInstance];
          next.lastMainDeckReturnSide = 'bottom';
          break;
      }
      return next;
    }, {
      extraFields: () => {
        if (returnItems.length === 0 || !returnToRole) return undefined;
        const batch = {
          // Same reasoning as handleMoveToOpponentTarget's own transfer
          // id — a genuinely unique value per batch, not derived from
          // anything that could repeat across a card's later returns.
          id: crypto.randomUUID(),
          toRole: returnToRole,
          items: returnItems,
        };
        // Queued locally, immediately — same reasoning as
        // handleMoveToOpponentTarget's own queueControlTransfer call.
        // This is the earliest point returnItems/returnToRole are
        // actually known (only populated once the updater above has
        // run), but it's still synchronous — applyMeUpdate calls this
        // function before any of its own writes are awaited.
        cardLayerRef.current?.queueCardReturn(batch);
        return {
          // arrayUnion, not a plain field write — same reasoning as
          // pendingControlTransfers' own fix: a plain merge write here
          // would overwrite (and lose) any OTHER return batch still
          // waiting to be picked up, rather than adding alongside it.
          // Combined into the SAME write as the removal above (via
          // extraFields), not a separate setDoc call — same race this
          // closes as pendingControlTransfers' own fix: a receiving
          // client could otherwise see the card gone from the
          // controller's field before ever seeing this signal telling
          // them where it actually went.
          pendingCardReturns: arrayUnion(batch),
        };
      },
    });
  };

  // --- Move (relocate a card to a different, empty zone on the same field) ---

  const handleMoveCancel = () => setPendingMove(null);

  const handleMoveTarget = (destZoneType: 'monster' | 'spellTrap', destIndex: number) => {
    if (!pendingMove) return;
    // Clicking the origin's own slot again — a no-op "move," not
    // actually a cancel, but treated the same way (just close move
    // mode) since there's nothing meaningful to relocate.
    if (pendingMove.zoneType === destZoneType && pendingMove.index === destIndex) {
      setPendingMove(null);
      return;
    }
    const { zoneType: originZoneType, index: originIndex } = pendingMove;
    setPendingMove(null);
    applyMeUpdate((current) => {
      const originZones = originZoneType === 'monster' ? current.monsterZones : current.spellTrapZones;
      const destZones = destZoneType === 'monster' ? current.monsterZones : current.spellTrapZones;
      const card = originZones[originIndex];
      // Guards against the origin having emptied out from under this
      // (e.g. sent to Grave by some other means) or the destination
      // having filled up since it was clicked — neither should happen
      // given the menu/click gating in DuelField.tsx, but this is the
      // authoritative check that actually matters.
      if (!card || destZones[destIndex]) return current;

      const nextMonsterZones = [...current.monsterZones];
      const nextSpellTrapZones = [...current.spellTrapZones];
      if (originZoneType === 'monster') nextMonsterZones[originIndex] = null;
      else nextSpellTrapZones[originIndex] = null;
      if (destZoneType === 'monster') nextMonsterZones[destIndex] = card;
      else nextSpellTrapZones[destIndex] = card;

      return { ...current, monsterZones: nextMonsterZones, spellTrapZones: nextSpellTrapZones };
    });
  };

  // Cross-field counterpart to handleMoveTarget above — only ever
  // reachable when pendingMove.zoneType is 'monster' (see DuelField.tsx,
  // which only offers this destination in that case). A client can only
  // ever write its OWN public state slice, never the opponent's
  // directly, so this can't just move the card the way handleMoveTarget
  // does — it removes the card from my own monsterZones as usual, but
  // leaves the actual placement for the RECEIVING player's own client to
  // do, via the pendingControlTransfers handoff (see the effect watching
  // it further down, and DuelDoc's own comment on this field).
  const handleMoveToOpponentTarget = (destIndex: number) => {
    if (!pendingMove || pendingMove.zoneType !== 'monster' || !duelId || !state.role) return;
    const { index: originIndex } = pendingMove;
    const card = renderMe.monsterZones[originIndex];
    if (!card) {
      setPendingMove(null);
      return;
    }
    const toRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    // Preserves an existing owner if this card has already changed
    // control before — ownership is set once and never changes again
    // after that, however many more times control itself does. Only
    // ever defaults to MY OWN role here, since that's only reached when
    // card.owner was unset, meaning I was both the controller and the
    // (implicit) owner up to this point.
    const cardWithOwner: PlacedCard = { ...card, owner: card.owner ?? state.role };
    const transferRecord = {
      // A genuinely unique id per transfer — see DuelDoc's own comment
      // on pendingControlTransfers for why toRole/toIndex/instanceId
      // alone aren't safe to key on: this same card revisiting the same
      // slot on a later transfer would otherwise reuse an identical
      // key, and the processed-Sets that guard against double-handling
      // persist for the whole duel.
      id: crypto.randomUUID(),
      toRole,
      toIndex: destIndex,
      card: cardWithOwner,
      // Plain, known values — see DuelDoc's own comment on
      // pendingControlTransfers' fromRole/fromZone for why these
      // replace what used to be a captured raw coordinate.
      fromRole: state.role,
      fromZone: { kind: 'monster' as const, index: originIndex },
    };
    setPendingMove(null);
    // Queued locally, immediately — this is what lets the SENDING
    // client see its own animation start the instant it clicks, rather
    // than only once pendingControlTransfers has round-tripped back
    // from Firestore. See CardLayerHandle's own comment for why this
    // matters: the local, optimistic state update below (via
    // applyMeUpdate) removes the card from view almost immediately,
    // well before that round trip would otherwise complete.
    cardLayerRef.current?.queueControlTransfer(transferRecord);
    applyMeUpdate(
      (current) => {
        const slot = current.monsterZones[originIndex];
        if (!slot) return current;
        const next = [...current.monsterZones];
        next[originIndex] = null;
        return { ...current, monsterZones: next };
      },
      {
        extraFields: {
          // arrayUnion, not a plain field write — this is what actually
          // fixes the "monster disappears" bug: a plain merge write
          // would overwrite (and lose) any OTHER transfer still waiting
          // to be picked up by its own recipient, rather than adding
          // alongside it. See DuelDoc's own comment on
          // pendingControlTransfers for the full reasoning. Combined
          // into the SAME write as the removal above (via extraFields),
          // not a separate setDoc call, which is what closes the race
          // where a receiving client could see the card gone from its
          // origin before ever seeing this signal telling them where it
          // went — a real gap where the card existed nowhere at all.
          pendingControlTransfers: arrayUnion(transferRecord),
        },
      },
    );
  };

  // Completes every control transfer targeting THIS client (toRole ===
  // my own role) — not just the most recent one, since
  // pendingControlTransfers is now an array and can genuinely hold
  // several at once (see DuelDoc's own comment on why). The moving
  // player's own client sees the same array but isn't the one meant to
  // act on entries targeting someone else. processedTransfersRef is a
  // Set now, not a single key, for the same reason — guards against
  // double-processing any individual entry: removing it from the array
  // is itself an async write, so this effect could otherwise fire again
  // on some unrelated re-render before that removal has round-tripped
  // back through the snapshot listener.
  const processedTransfersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!duelId || !state.role) return;
    const myTransfers = pendingControlTransfers.filter((t) => t.toRole === state.role);
    const newTransfers = myTransfers.filter((t) => !processedTransfersRef.current.has(t.id));
    if (newTransfers.length === 0) return;
    for (const t of newTransfers) {
      processedTransfersRef.current.add(t.id);
    }

    // Every transfer accumulates onto the SAME next object — one atomic
    // update covering however many arrived together, not a separate
    // write per transfer.
    applyMeUpdate((current) => {
      let next: MyDuelState = { ...current };
      for (const { toIndex, card } of newTransfers) {
        if (next.monsterZones[toIndex]) continue;
        const zones = [...next.monsterZones];
        zones[toIndex] = card;
        next = { ...next, monsterZones: zones };
      }
      return next;
    });
    setDoc(
      doc(db, 'duels', duelId),
      { pendingControlTransfers: arrayRemove(...newTransfers) },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to clear control transfer:', err);
    });
    // applyMeUpdate is intentionally not a dependency — same reasoning
    // as the auto-draw effect above: it's redefined every render, and
    // processedTransfersRef's own guard is what actually makes this
    // effect idempotent, not the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingControlTransfers, duelId, state.role]);

  // Completes every card-return batch targeting THIS client (toRole ===
  // my own role) — not just the most recent one, since pendingCardReturns
  // is now an array and can genuinely hold several batches at once (see
  // DuelDoc's own comment on why). Same structure as the
  // pendingControlTransfers effect just above, just dispatching each
  // batch's own items to whichever MyDuelState collection their
  // destination names instead of always monsterZones.
  const processedReturnsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!duelId || !state.role) return;
    const myReturns = pendingCardReturns.filter((r) => r.toRole === state.role);
    const newReturns = myReturns.filter((r) => !processedReturnsRef.current.has(r.id));
    if (newReturns.length === 0) return;
    for (const r of newReturns) {
      processedReturnsRef.current.add(r.id);
    }

    // Every item, from every new batch, accumulates onto the SAME next
    // object — one atomic update covering however many batches arrived
    // together, not a separate write per batch.
    applyMeUpdate((current) => {
      let next: MyDuelState = { ...current };
      for (const { items } of newReturns) {
        for (const { destination, card } of items) {
          switch (destination) {
            case 'hand':
              next = { ...next, hand: [...next.hand, card] };
              break;
            case 'grave':
              next = { ...next, grave: [...next.grave, card] };
              break;
            case 'banished':
              next = { ...next, banished: [...next.banished, card] };
              break;
            case 'mainDeckTop':
              next = { ...next, mainDeck: [card, ...next.mainDeck] };
              break;
            case 'mainDeckBottom':
              next = { ...next, mainDeck: [...next.mainDeck, card] };
              break;
            case 'extraDeck':
              next = { ...next, extraDeck: [card, ...next.extraDeck] };
              break;
          }
        }
      }
      return next;
    });
    setDoc(
      doc(db, 'duels', duelId),
      { pendingCardReturns: arrayRemove(...newReturns) },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to clear card return:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCardReturns, duelId, state.role]);

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
    applyMeUpdate((current) => ({
      ...current,
      mainDeck: shuffle(current.mainDeck),
      mainDeckShuffleVersion: current.mainDeckShuffleVersion + 1,
    }));

  // Closing the Main Deck viewer always shuffles afterward — matches
  // the real-world convention that looking through your deck requires
  // a shuffle once you're done, regardless of what else was done (any
  // card actions taken) while it was open. Only the Main Deck viewer
  // does this — Grave/Banished/Extra Deck order is either public
  // knowledge already or, for Extra Deck, deliberately NOT randomized
  // (see MAIN_DECK_ACTIONS' own comment on why Extra Deck never gets a
  // Shuffle option at all).
  const handleCloseOwnPile = () => {
    const wasViewingMain = viewingOwnPile === 'main';
    setViewingOwnPile(null);
    if (wasViewingMain) {
      handleShuffleMainDeck();
    }
  };

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

    if (actionKey === 'toHand') {
      moveCardViaRevealZone(
        (current) => {
          const inst = current.mainDeck.find((i) => i.instanceId === instanceId);
          if (!inst) return null;
          return {
            instance: inst,
            next: { ...current, mainDeck: current.mainDeck.filter((i) => i.instanceId !== instanceId) },
          };
        },
        'hand',
        1000,
      );
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.mainDeck.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restDeck = current.mainDeck.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
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
        : card.cardSubclass === 'Ritual'
          ? { key: 'ritualSummon', label: 'Ritual Summon' }
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

    if (actionKey === 'ritualSummon') {
      // Closes the viewer so the field AND hand are both visible for
      // material selection — the rest of this flow (toggling zones and
      // hand cards, Confirm, choosing a Battle Position) is handled by
      // handleRitualZoneMaterialToggle/handleRitualHandMaterialToggle/
      // handleRitualSummonConfirm and the banner below, not here.
      setViewingOwnPile(null);
      setPendingRitualSummon({ extraDeckInstance: instance, selectedZoneIndices: [], selectedHandIndices: [] });
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

    const removeFromGrave = (current: MyDuelState) => {
      const inst = current.grave.find((i) => i.instanceId === instanceId);
      if (!inst) return null;
      return {
        instance: inst,
        next: { ...current, grave: current.grave.filter((i) => i.instanceId !== instanceId) },
      };
    };

    if (actionKey === 'toHand') {
      moveCardViaRevealZone(removeFromGrave, 'hand', 1000);
      return;
    }
    if (actionKey === 'toExtra') {
      moveCardViaRevealZone(removeFromGrave, 'extraDeck', 1000);
      return;
    }
    if (actionKey === 'stackTop') {
      moveCardViaRevealZone(removeFromGrave, 'mainDeckTop', 1000);
      return;
    }
    if (actionKey === 'stackBottom') {
      moveCardViaRevealZone(removeFromGrave, 'mainDeckBottom', 1000);
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.grave.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restGrave = current.grave.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
        case 'banish':
          return { ...current, grave: restGrave, banished: [...current.banished, inst] };
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

    const removeFromBanished = (current: MyDuelState) => {
      const inst = current.banished.find((i) => i.instanceId === instanceId);
      if (!inst) return null;
      return {
        instance: inst,
        next: { ...current, banished: current.banished.filter((i) => i.instanceId !== instanceId) },
      };
    };

    if (actionKey === 'toHand') {
      moveCardViaRevealZone(removeFromBanished, 'hand', 1000);
      return;
    }
    if (actionKey === 'toExtra') {
      moveCardViaRevealZone(removeFromBanished, 'extraDeck', 1000);
      return;
    }
    if (actionKey === 'stackTop') {
      moveCardViaRevealZone(removeFromBanished, 'mainDeckTop', 1000);
      return;
    }
    if (actionKey === 'stackBottom') {
      moveCardViaRevealZone(removeFromBanished, 'mainDeckBottom', 1000);
      return;
    }

    applyMeUpdate((current) => {
      const inst = current.banished.find((i) => i.instanceId === instanceId);
      if (!inst) return current;
      const restBanished = current.banished.filter((i) => i.instanceId !== instanceId);
      switch (actionKey) {
        case 'toGrave':
          return { ...current, banished: restBanished, grave: [...current.grave, inst] };
        default:
          return current;
      }
    });
  };

  // --- Opponent Grave/Banished viewer actions ---
  // The card lives entirely in the OPPONENT's own public state here, so
  // neither handler below ever calls applyMeUpdate directly — only the
  // opponent's own client can act on their own Grave/Banished. Both
  // just write a request instead (see pendingPileRequests' own comment)
  // and let the opponent's own client — running the exact same
  // component, just on their side — pick it up via the receiving effect
  // below.

  const requestOpponentPileAction = (
    pile: 'grave' | 'banished',
    instanceId: string,
    action: 'toOtherPile',
  ) => {
    if (!duelId || !state.role) return;
    const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    setDoc(
      doc(db, 'duels', duelId),
      {
        pendingPileRequests: arrayUnion({
          id: crypto.randomUUID(),
          targetRole: opponentRole,
          instanceId,
          pile,
          action,
        }),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to request pile action:', err);
    });
  };

  const getOpponentGraveCardActions = (card: CardData) => {
    const actions = [{ key: 'banish', label: 'Banish' }];
    if (card.cardClass === 'Monster') {
      actions.push({ key: 'specialSummon', label: 'S. Summon' });
    }
    return actions;
  };

  const handleOpponentGraveCardAction = (instanceId: string, actionKey: string) => {
    if (actionKey === 'specialSummon') {
      // Checked against MY OWN field, same as every other Special
      // Summon source — this card is about to land there, regardless
      // of which pile of the opponent's it's coming from.
      if (!me || findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'opponentGrave' });
      return;
    }
    if (actionKey === 'banish') {
      requestOpponentPileAction('grave', instanceId, 'toOtherPile');
    }
  };

  // --- Opponent Banished viewer actions ---
  // Identical to the Grave viewer's own actions above, except "To
  // Grave" swaps in for "Banish" (a card already in the Banished Zone
  // obviously can't be banished again) — same reasoning as the
  // existing own-pile getBanishedCardActions' own comment.

  const getOpponentBanishedCardActions = (card: CardData) => {
    const actions = [{ key: 'toGrave', label: 'To Grave' }];
    if (card.cardClass === 'Monster') {
      actions.push({ key: 'specialSummon', label: 'S. Summon' });
    }
    return actions;
  };

  const handleOpponentBanishedCardAction = (instanceId: string, actionKey: string) => {
    if (actionKey === 'specialSummon') {
      if (!me || findEmptyZoneSlot(me.monsterZones) === -1) return;
      setPendingSummon({ instanceId, source: 'opponentBanished' });
      return;
    }
    if (actionKey === 'toGrave') {
      requestOpponentPileAction('banished', instanceId, 'toOtherPile');
    }
  };

  // Completes every pile request targeting THIS client (targetRole ===
  // my own role) — not just the most recent one, same batching/Set-
  // guard reasoning as the pendingControlTransfers/pendingCardReturns
  // effects above. This is the target-side half of the opponent-pile
  // actions above: only this client can actually remove a card from its
  // own Grave/Banished, which is exactly why those actions could only
  // ever request this rather than do it directly.
  const processedPileRequestsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!duelId || !state.role || !me) return;
    const myRequests = pendingPileRequests.filter((r) => r.targetRole === state.role);
    const newRequests = myRequests.filter((r) => !processedPileRequestsRef.current.has(r.id));
    if (newRequests.length === 0) return;
    for (const r of newRequests) {
      processedPileRequestsRef.current.add(r.id);
    }

    const opponentRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
    // Resolved up front, from this render's own closure values, for the
    // same reason handleMoveToOpponentTarget's own `from` is captured
    // before anything is touched — cardPositionEntries reflects MY OWN
    // pile's current rendered layout (the card sits in MY state from
    // this client's own point of view, even though it was the OTHER
    // player who asked for it), and won't still be there once this
    // client's own local, optimistic removal below takes effect.
    // findEmptyZoneSlot is checked against `opponent` (the requester's
    // own field, from this client's point of view) — same approximation
    // tolerance as everywhere else that trusts the synced snapshot
    // rather than re-verifying after a round trip: if the requester's
    // field has genuinely filled up since they asked, this request is
    // simply dropped rather than risking placing a card nowhere at all.
    const newTransfers: {
      id: string;
      toRole: PlayerRole;
      toIndex: number;
      card: PlacedCard;
      fromRole: PlayerRole;
      fromZone: { kind: 'monster'; index: number } | { kind: 'grave' } | { kind: 'banished' };
    }[] = [];
    const resolvedRequests: {
      request: (typeof newRequests)[number];
      transfer: (typeof newTransfers)[number] | null;
    }[] = [];
    for (const request of newRequests) {
      if (request.action !== 'specialSummon') {
        resolvedRequests.push({ request, transfer: null });
        continue;
      }
      const sourcePile = request.pile === 'grave' ? me.grave : me.banished;
      const instance = sourcePile.find((i) => i.instanceId === request.instanceId);
      const destIndex = opponent ? findEmptyZoneSlot(opponent.monsterZones) : -1;
      if (!instance || destIndex === -1) {
        // Nothing safe to do — the card is already gone, or the
        // requester's field has no room anymore. Dropped silently, same
        // convention as every other "the target isn't valid anymore"
        // case elsewhere in this file.
        resolvedRequests.push({ request, transfer: null });
        continue;
      }
      const transfer = {
        id: crypto.randomUUID(),
        toRole: opponentRole,
        toIndex: destIndex,
        card: {
          instanceId: instance.instanceId,
          card: instance.card,
          faceDown: false,
          position: request.position ?? 'attack',
          // Preserves an existing owner if this card had already
          // changed control before landing in my Grave/Banished — same
          // reasoning as every other control-transfer-initiating action.
          // Only ever defaults to MY OWN role here, since an unset
          // owner means I was both the controller and the (implicit)
          // owner up to this point.
          owner: instance.owner ?? state.role,
        },
        // Plain, known values — see DuelDoc's own comment on
        // pendingControlTransfers' fromRole/fromZone for why these
        // replace what used to be a captured raw coordinate: that raw
        // coordinate was captured from THIS client's (the target's) own
        // perspective on their own Grave/Banished, but was being reused
        // verbatim by the REQUESTER's client — where the same numeric
        // coordinates land somewhere on the requester's OWN side of the
        // board instead, since "flipped=false" always means "whoever's
        // rendering this' own side," not a fixed physical location. That
        // mismatch was the actual cause of the card visibly appearing at
        // the requester's own Grave/Banished before snapping to its real
        // destination.
        fromRole: state.role,
        fromZone: { kind: request.pile } as const,
      };
      newTransfers.push(transfer);
      resolvedRequests.push({ request, transfer });
    }

    // Queued locally, immediately — same reasoning as every other
    // control-transfer-initiating action: this client is the one whose
    // own local, optimistic state update is about to remove the card
    // from view, well before pendingControlTransfers could ever
    // round-trip back to confirm it.
    for (const transfer of newTransfers) {
      cardLayerRef.current?.queueControlTransfer(transfer);
    }

    applyMeUpdate(
      (current) => {
        let next: MyDuelState = { ...current };
        for (const { request, transfer } of resolvedRequests) {
          const sourcePile = request.pile === 'grave' ? next.grave : next.banished;
          const inst = sourcePile.find((i) => i.instanceId === request.instanceId);
          if (!inst) continue;
          const restSource = sourcePile.filter((i) => i.instanceId !== request.instanceId);

          if (request.action === 'toOtherPile') {
            next =
              request.pile === 'grave'
                ? { ...next, grave: restSource, banished: [...next.banished, inst] }
                : { ...next, banished: restSource, grave: [...next.grave, inst] };
          } else if (transfer) {
            next = request.pile === 'grave' ? { ...next, grave: restSource } : { ...next, banished: restSource };
          }
        }
        return next;
      },
      {
        extraFields: {
          pendingPileRequests: arrayRemove(...newRequests),
          ...(newTransfers.length > 0
            ? { pendingControlTransfers: arrayUnion(...newTransfers) }
            : {}),
        },
      },
    );
    // applyMeUpdate/cardPositionEntries/opponent are intentionally not
    // listed — same reasoning as every other effect in this file that
    // omits them: processedPileRequestsRef's own guard is what actually
    // makes this effect idempotent, not the dependency array, and these
    // three are read only for their CURRENT closure values at the
    // moment a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPileRequests, duelId, state.role]);

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
  // just "has the timeout in the effect above fired yet." Also shown
  // again at the start of duel 2/3 (see resetLocalStateForNewDuel).
  if (showFirstPlayerBanner && turnPlayer) {
    const firstPlayerName = turnPlayer === state.role ? currentUser?.displayName : opponent.username;
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p className="MultiplayerDuelFieldPage-firstPlayerAnnouncement">
          {firstPlayerName} will go first
        </p>
        <p className="MultiplayerDuelFieldPage-duelAnnouncementSubtext">Duel {duelNumber} of 3</p>
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

      <div className="MultiplayerDuelFieldPage-topActions">
        <button type="button" onClick={() => navigate('/duel')}>
          Exit
        </button>
      </div>

      {/* Positioned via CSS (absolute, bottom-left of .content) — same
      column as Exit above, at the bottom of the screen instead of
      the top. */}
      <div className="MultiplayerDuelFieldPage-matchActionsRow">
        <button
          type="button"
          className="MultiplayerDuelFieldPage-matchActionButton"
          disabled={isMatchOver}
          onClick={handleAdmitDefeatClick}
        >
          Admit Defeat
        </button>
        <button
          type="button"
          className="MultiplayerDuelFieldPage-matchActionButton"
          disabled={isMatchOver}
          onClick={handleOfferDrawClick}
        >
          Offer Draw
        </button>
      </div>

      <div className="MultiplayerDuelFieldPage-matchStatus">
        Duel {duelNumber} of 3 — Wins: You{' '}
        {state.role === 'player1' ? matchWins.player1 : matchWins.player2} · Opponent{' '}
        {state.role === 'player1' ? matchWins.player2 : matchWins.player1}
      </div>

      {/* marginLeft here (half of BOARD_WIDTH, negative) is what actually
          centers this on the page — see MultiplayerDuelFieldPage.css's own
          comment on .MultiplayerDuelFieldPage-content for why that's a
          plain margin instead of a transform: translateX(-50%). */}
      <div
        className="MultiplayerDuelFieldPage-content"
        style={{ marginLeft: -(BOARD_WIDTH / 2) }}
      >
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
              isSelectingRitualMaterial={pendingRitualSummon !== null}
              selectedRitualZoneIndices={pendingRitualSummon?.selectedZoneIndices ?? []}
              onToggleRitualZoneMaterial={handleRitualZoneMaterialToggle}
              currentPhase={currentPhase}
              turnEnding={turnEnding}
              isMyTurn={isMyTurn}
              turnNumber={turnNumber}
              onPrevPhase={handlePrevPhase}
              onNextPhase={handleNextPhase}
              onStartTurn={handleStartTurn}
              onStatsAdjust={handleStatsAdjust}
              isSelectingMoveDestination={pendingMove !== null}
              onMoveTarget={handleMoveTarget}
              isSelectingMoveToOpponentZone={pendingMove?.zoneType === 'monster'}
              onMoveToOpponentTarget={handleMoveToOpponentTarget}
              isSelectingEquipTarget={pendingEquip !== null}
              onEquipTarget={handleEquipTargetClick}
              isSelectingAttackTarget={pendingAttack !== null}
              onAttackTarget={handleAttackTargetClick}
              onFieldInstanceHoverChange={setHoveredFieldInstanceId}
              onSelectCard={handleSelectCard}
            />

            <Hand
              cards={renderMe.hand}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              onHoveredInstanceChange={setHoveredHandInstanceId}
              onNormalSummon={handleNormalSummon}
              onActivateSpell={handleActivateSpell}
              onSetSpellOrTrap={handleSetSpellOrTrap}
              onToGrave={handleHandToGrave}
              onBanish={handleHandBanish}
              onStackTop={handleHandStackTop}
              onStackBottom={handleHandStackBottom}
              onReveal={handleHandReveal}
            />

            {/* Renders every card in cardPositionEntries on top of
                everything above — DOM order alone (this is the last
                child) is enough to put it above DuelField's own zone
                chrome and Hand's own cells, without needing an explicit
                z-index war with FieldZone-rotatedOverlay or anything
                else in there. */}
            <CardLayer
              ref={cardLayerRef}
              entries={cardPositionEntries}
              me={renderMe}
              opponent={opponent}
              myRole={state.role ?? null}
              mySelection={mySelection}
              opponentSelection={opponentSelection}
              onSelectCard={handleSelectCard}
              pendingControlTransfers={pendingControlTransfers}
              pendingCardReturns={pendingCardReturns}
              isSelectingRitualMaterial={pendingRitualSummon !== null}
              selectedRitualHandIndices={pendingRitualSummon?.selectedHandIndices ?? []}
              onToggleRitualHandMaterial={handleRitualHandMaterialToggle}
              hoveredHandInstanceId={hoveredHandInstanceId}
              hoveredFieldInstanceId={hoveredFieldInstanceId}
              pendingAttackIndex={pendingAttack?.index ?? null}
              attackMousePosition={attackMousePosition}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              duelNumber={duelNumber}
            />
          </div>
        </div>

      </div>


      <div className="MultiplayerDuelFieldPage-opponentHud">
        {/* Reuses LifePointCounter-display's own steady-state styling,
            reused directly. A plain, non-interactive div rather than
            LifePointCounter itself: a player can never edit their
            opponent's life points, only see them. opponentDisplayLifePoints
            (see useAnimatedCount) counts steadily toward the real value
            rather than jumping straight to it, the same as the
            player's own counter. */}
        <div className="LifePointCounter-display MultiplayerDuelFieldPage-opponentLpDisplay">
          {opponentDisplayLifePoints}
        </div>
        {/* Reuses PlayerAvatarBox's own CSS classes directly (already
            globally available — this page already imports that
            component elsewhere) rather than a separately-styled
            approximation, so this is genuinely the same size/appearance,
            not just a close match. The blue turn-color border is the
            opponent-side counterpart to PlayerAvatarBox's own --myTurn
            variant — applied directly here rather than through that
            component, since this is the one place the opponent's own
            avatar renders (see PlayerAvatarBox.tsx's own comment on
            why it only ever needs the "mine" variant itself). */}
        <div
          className={[
            'PlayerAvatarBox',
            !isMyTurn && 'PlayerAvatarBox--opponentTurn',
          ]
            .filter(Boolean)
            .join(' ')}
        >
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
        <PlayerAvatarBox isMyTurn={isMyTurn} />
        {/* A row, not stacked with the rest of this column — the button
            sits to the LEFT of the LP counter specifically, at a fixed
            spot relative to it, rather than being just another item in
            the overall vertical stack above. */}
        <div className="MultiplayerDuelFieldPage-lpRow">
          <div className="MultiplayerDuelFieldPage-handButtonColumn">
            <button
              type="button"
              className={
                handRevealed
                  ? 'MultiplayerDuelFieldPage-revealHandButton MultiplayerDuelFieldPage-revealHandButton--active'
                  : 'MultiplayerDuelFieldPage-revealHandButton'
              }
              onClick={handleToggleHandReveal}
            >
              {handRevealed ? 'Hide Hand' : 'Reveal Hand'}
            </button>
            <button
              type="button"
              className="MultiplayerDuelFieldPage-shuffleHandButton"
              onClick={handleShuffleHand}
            >
              Shuffle Hand
            </button>
          </div>
          <LifePointCounter
            value={renderMe.lifePoints}
            onAdd={(amount) => handleLifePointChange(amount)}
            onSubtract={(amount) => handleLifePointChange(-amount)}
          />
        </div>
      </div>

      {showAdmitDefeatConfirm && (
        <ConfirmDialog
          message="Are you sure you want to admit defeat?"
          buttons={[
            { label: 'Yes', onClick: handleAdmitDefeatConfirm },
            { label: 'No', onClick: handleAdmitDefeatCancel },
          ]}
          onDismiss={handleAdmitDefeatCancel}
        />
      )}

      {showOfferDrawConfirm && (
        <ConfirmDialog
          message="Are you sure you want to offer a draw?"
          buttons={[
            { label: 'Yes', onClick: handleOfferDrawConfirm },
            { label: 'No', onClick: handleOfferDrawCancel },
          ]}
          onDismiss={handleOfferDrawCancel}
        />
      )}

      {matchConclusion?.type === 'drawOffered' &&
        matchConclusion.offererRole !== state.role && (
          <ConfirmDialog
            message="Your opponent has offered a draw"
            buttons={[
              { label: 'Accept', onClick: handleAcceptDraw },
              { label: 'Decline', onClick: handleDeclineDraw },
            ]}
          />
        )}

      {matchConclusion?.type === 'drawDeclined' &&
        matchConclusion.offererRole === state.role &&
        matchConclusionKey !== dismissedMatchConclusionKey && (
          <ConfirmDialog
            message="The opponent has declined the draw. The duel will continue"
            buttons={[{ label: 'OK', onClick: handleAcknowledgeDrawDeclined }]}
          />
        )}

      {/* No confirmation dialog for defeatAdmitted/drawAccepted here —
          those only matter as a mid-match result when the match ISN'T
          over yet, and that case now advances straight into the next
          duel on its own (see autoAdvancedForDuelNumberRef's own effect above),
          with no dialog either player needs to click through. When the
          match IS over, the match outcome dialog just below is the only
          acknowledgement that's actually needed. */}

      {/* The whole MATCH's own final outcome. */}
      {matchOutcome && matchOutcomeKey !== dismissedMatchOutcomeKey && (
          <ConfirmDialog
            message={
              matchOutcome.type === 'matchDraw'
                ? 'The match has ended in a draw.'
                : matchOutcome.type === (state.role === 'player1' ? 'player1WinsMatch' : 'player2WinsMatch')
                  ? 'You win the match!'
                  : 'Your opponent has won the match.'
            }
            buttons={[{ label: 'OK', onClick: () => setDismissedMatchOutcomeKey(matchOutcomeKey) }]}
          />
        )}

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

      {pendingRitualPositionChoice && (
        <SummonPositionDialog
          onSelectAttack={() => completeRitualSummon('attack')}
          onSelectDefense={() => completeRitualSummon('defense')}
        />
      )}

      {pendingStatAdjustIndex !== null &&
        (() => {
          const slot = renderMe.monsterZones[pendingStatAdjustIndex];
          // Guards against a slot that's emptied out from under the
          // dialog somehow (e.g. the monster left the field via another
          // means while this was open) — closes rather than rendering
          // against a card that no longer exists.
          if (!slot) return null;
          // card.atk/card.def are strings in this codebase's own data
          // (e.g. "2500") — parsed here rather than passed through
          // as-is, since StatAdjustDialog's own props are real numbers
          // throughout. Falls back to 0 for a missing OR non-numeric
          // base stat, same reasoning as FieldZone's own comparison
          // logic for the color coding.
          const parsedBaseAtk = Number(slot.card.atk);
          const parsedBaseDef = Number(slot.card.def);
          const baseAtk = Number.isNaN(parsedBaseAtk) ? 0 : parsedBaseAtk;
          const baseDef = Number.isNaN(parsedBaseDef) ? 0 : parsedBaseDef;
          return (
            <StatAdjustDialog
              baseAtk={baseAtk}
              baseDef={baseDef}
              currentAtk={slot.atkOverride ?? baseAtk}
              currentDef={slot.defOverride ?? baseDef}
              onConfirm={handleStatAdjustConfirm}
              onCancel={handleStatAdjustCancel}
              onReset={handleStatAdjustReset}
            />
          );
        })()}

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

      {pendingRitualSummon && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>
            Select cards to Tribute for the Ritual Summon (
            {pendingRitualSummon.selectedZoneIndices.length + pendingRitualSummon.selectedHandIndices.length}{' '}
            selected)
          </span>
          <button
            type="button"
            onClick={handleRitualSummonConfirm}
            disabled={
              pendingRitualSummon.selectedZoneIndices.length === 0 &&
              pendingRitualSummon.selectedHandIndices.length === 0
            }
          >
            Confirm
          </button>
          <button type="button" onClick={handleRitualSummonCancel}>
            Cancel
          </button>
        </div>
      )}

      {pendingMove && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>
            {pendingMove?.zoneType === 'monster'
              ? "Select an empty Monster or Spell/Trap Zone (yours), or an empty Monster Zone (your opponent's), to move this card to"
              : 'Select an empty zone to move this card to'}
          </span>
          <button type="button" onClick={handleMoveCancel}>
            Cancel
          </button>
        </div>
      )}

      {pendingEquip && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>Select a monster (yours or your opponent's) to equip this card to</span>
          <button type="button" onClick={handleEquipCancel}>
            Cancel
          </button>
        </div>
      )}

      {pendingAttack && (
        <div className="MultiplayerDuelFieldPage-materialSelectionBanner">
          <span>Select an opponent's monster to attack</span>
          <button type="button" onClick={handleAttackCancel}>
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
          onClose={handleCloseOwnPile}
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
          getCardActions={
            viewingOpponentPile === 'grave' ? getOpponentGraveCardActions : getOpponentBanishedCardActions
          }
          onCardAction={
            viewingOpponentPile === 'grave' ? handleOpponentGraveCardAction : handleOpponentBanishedCardAction
          }
        />
      )}

      {/* The opponent's own "Reveal Hand" — shown only on THIS
          (viewing) player's client, since the revealing player already
          sees their own hand normally and doesn't need a redundant
          overlay of it. No hover menu at all, per the feature's own
          spec — just Card Display hover and click-to-select, reusing
          the same highlight this app already shows for any other
          selected card. */}
      {opponent.revealedHand && !handRevealDismissed && (
        <DeckViewer
          cards={opponent.revealedHand}
          onClose={handleExitOpponentHandView}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          onCardClick={handleRevealedHandCardClick}
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
