import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { doc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../auth/AuthContext';
import DuelField from '../components/DuelField/DuelField';
import { DieRollButton, DieRollDisplay, ROLL_DURATION_MS } from '../components/DuelField/DieRoller';
import { CoinFlipButton, CoinFlipDisplay, FLIP_DURATION_MS } from '../components/DuelField/CoinFlipper';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import LifePointCounter from '../components/DuelField/LifePointCounter';
import useAnimatedCount from '../components/DuelField/useAnimatedCount';
import PlayerAvatarBox from '../components/Avatar/PlayerAvatarBox';
import { useUserAvatar } from '../components/Avatar/useUserAvatar';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import StatAdjustDialog from '../components/DuelField/StatAdjustDialog';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import SideDecking from '../components/SideDecking/SideDecking';
import CardLayer, { type CardLayerHandle } from '../duel/CardLayer';
import { computeCardPositions } from '../duel/cardPositions';
import { BOARD_WIDTH, STAGE_HEIGHT, getRevealZoneSlot } from '../duel/cardGeometry';
import { getAvatarUrl } from '../components/Avatar/avatars';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import cardData from '../data/carddata.json';
import {
  useMultiplayerDuel,
  TURN_PHASES,
  encodeHandSelection,
  decodeHandSelection,
  OPENING_HAND_SIZE,
  buildSystemChatMessage,
  buildDuelLogEntry,
  type PlayerRole,
  type OpponentInfo,
  type MyDuelState,
  type TurnPhase,
  type SharedCardVisualPosition,
  type ChatMessage,
  type ExpressionEvent,
  type ViewingLocation,
  type DuelLogEntry,
  type DieRollData,
  type CoinFlipData,
} from '../components/Matchmaking/useMultiplayerDuel';
import thinkingIcon from '../assets/ui/duelfield/thinking.png';
import thumbsUpIcon from '../assets/ui/duelfield/thumbs-up.png';
import thinkingGif from '../assets/ui/duelfield/thinking.gif';
import adminIcon from '../assets/ui/duelfield/admin.png';
import revealHandIcon from '../assets/ui/duelfield/reveal_hand.png';
import shuffleHandIcon from '../assets/ui/duelfield/shuffle_hand.png';
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

// Same rule DeckBuilder's own useDeck.ts enforces at deck-building time
// (see that file's own isExtraDeckCard) — deliberately duplicated here
// rather than imported, the same "no dependency between these two
// otherwise-unrelated features" reasoning as cardGeometry.ts's own
// duplicated zone-kind arrays. Used by Side Decking (see the "--- Side
// Decking ---" section below) to keep a Side Deck card that isn't
// Extra-Deck-legal from ever being swapped INTO the Extra Deck.
function isExtraDeckCard(card: CardData): boolean {
  return (
    card.cardClass === 'Monster' && ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '')
  );
}

// Renders the transient thumbs-up/thinking overlay for either avatar —
// used for both the player's own (passed into PlayerAvatarBox's own
// overlay prop) and the opponent's (inserted directly into their own
// avatar box below, which isn't built through PlayerAvatarBox at all).
// null renders nothing, so this can be called unconditionally at both
// call sites. key={expression.id} is what makes a SECOND click of the
// SAME expression type, before the first one's own grow/shrink
// animation has finished playing, restart that animation from scratch —
// without a fresh key here, React would just keep reusing the same
// <img> element (identical src, identical class), and the
// already-running CSS animation wouldn't replay.
// Two nested elements, not one: the OUTER div owns the grow-then-shrink
// envelope (positioned absolutely against the avatar box, per
// MultiplayerDuelFieldPage-expressionOverlay's own comment), and the
// INNER img owns thumbs-up's own extra "oscillate between 80% and 100%
// size" pulse once it's grown in — two separate elements because a
// single element can only ever have one `transform` in effect at a
// time, so the envelope's grow/shrink scale and thumbs-up's own
// pulsing scale can't both animate the same `transform` property
// directly; nesting them multiplies the two scales together instead
// (envelope * pulse), which is the actual combined effect wanted.
// Thinking's own gif has no such pulse — see
// MultiplayerDuelFieldPage-expressionOverlayImage--thumbsUp's own CSS
// for why it's conditional on expression.type.
// Renders one chat log entry — shared between the normal duel field's own
// chat history and Side Decking's own identical copy of it (see that
// return's own comment on why the two HUDs are duplicated rather than
// shared), so the "mine"/"opponent"/"system" classification logic below
// only ever has to be gotten right in one place.
//
// A 'system' message (see ChatMessage's own comment on that role) is
// never "mine" — isMine only ever compares against an actual PlayerRole,
// and 'system' !== myRole for either player — so it automatically falls
// into the same avatar-right/bubble-left ORIENTATION as an opponent's
// message, exactly as requested, while still getting its own distinct
// avatar image (admin.png, not either player's own avatar) and its own
// bubble color via the separate --system modifier below, rather than
// being folded into the blue "opponent" styling.
function renderChatMessage(
  message: ChatMessage,
  myRole: PlayerRole | undefined,
  myAvatarId: string,
  opponentAvatarId: string,
) {
  const isSystem = message.role === 'system';
  const isMine = !isSystem && message.role === myRole;
  const avatarUrl = isSystem ? adminIcon : getAvatarUrl(isMine ? myAvatarId : opponentAvatarId);
  return (
    <div
      key={message.id}
      className={[
        'MultiplayerDuelFieldPage-chatMessage',
        isMine
          ? 'MultiplayerDuelFieldPage-chatMessage--mine'
          : 'MultiplayerDuelFieldPage-chatMessage--opponent',
      ].join(' ')}
    >
      <img src={avatarUrl} alt="" className="MultiplayerDuelFieldPage-chatAvatar" />
      <div
        className={[
          'MultiplayerDuelFieldPage-chatBubble',
          isSystem
            ? 'MultiplayerDuelFieldPage-chatBubble--system'
            : isMine
              ? 'MultiplayerDuelFieldPage-chatBubble--mine'
              : 'MultiplayerDuelFieldPage-chatBubble--opponent',
        ].join(' ')}
      >
        {message.text}
      </div>
    </div>
  );
}

// Duel Log overlay — a simple fixed-position modal (see its own CSS for
// the position: fixed/inset:0 backdrop, which is what keeps it from
// disturbing the layout of anything else on the page per the original
// request) listing every entry in timestamp order, color-coded red for
// this player's own actions, blue for the opponent's, and white for
// system entries — same red/blue convention as PhaseTracker's own
// turn-color coding and PlayerAvatarBox's own --myTurn/--opponentTurn
// border colors, just applied to text here instead of a border.
function renderDuelLogOverlay(
  entries: DuelLogEntry[],
  myRole: PlayerRole | undefined,
  onClose: () => void,
  historyRef: { current: HTMLDivElement | null },
) {
  return (
    <div className="MultiplayerDuelFieldPage-duelLogOverlay">
      <div className="MultiplayerDuelFieldPage-duelLogPanel">
        <div className="MultiplayerDuelFieldPage-duelLogHeader">
          <span className="MultiplayerDuelFieldPage-duelLogTitle">Duel Log</span>
          <button type="button" className="MultiplayerDuelFieldPage-duelLogCloseButton" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="MultiplayerDuelFieldPage-duelLogEntries" ref={historyRef}>
          {entries.length === 0 && (
            <div className="MultiplayerDuelFieldPage-duelLogEmpty">No actions recorded yet.</div>
          )}
          {entries.map((entry) => {
            const isSystem = entry.role === 'system';
            const isMine = !isSystem && entry.role === myRole;
            return (
              <div
                key={entry.id}
                className={[
                  'MultiplayerDuelFieldPage-duelLogEntry',
                  isSystem
                    ? 'MultiplayerDuelFieldPage-duelLogEntry--system'
                    : isMine
                      ? 'MultiplayerDuelFieldPage-duelLogEntry--mine'
                      : 'MultiplayerDuelFieldPage-duelLogEntry--opponent',
                ].join(' ')}
              >
                <span className="MultiplayerDuelFieldPage-duelLogTimestamp">{entry.timestamp}</span>{' '}
                {entry.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function renderExpressionOverlay(expression: ExpressionEvent | null) {
  if (!expression) return null;
  const src = expression.type === 'thumbsUp' ? thumbsUpIcon : thinkingGif;
  return (
    <div key={expression.id} className="MultiplayerDuelFieldPage-expressionOverlay">
      <img
        src={src}
        alt=""
        className={
          expression.type === 'thumbsUp'
            ? 'MultiplayerDuelFieldPage-expressionOverlayImage MultiplayerDuelFieldPage-expressionOverlayImage--thumbsUp'
            : 'MultiplayerDuelFieldPage-expressionOverlayImage'
        }
      />
    </div>
  );
}

// The plain-English label shown for each ViewingLocation — "Viewing
// Opponent's Grave"/"Viewing Opponent's Banished" rather than just
// "Viewing Grave"/"Viewing Banished" for those two, since this overlay
// always renders over the VIEWING player's own avatar (see
// renderViewingLocationOverlay below), so it needs to say whose pile is
// being looked at, not just which kind.
const VIEWING_LOCATION_LABELS: Record<ViewingLocation, string> = {
  mainDeck: 'Viewing Main Deck',
  extraDeck: 'Viewing Extra Deck',
  grave: 'Viewing Grave',
  banished: 'Viewing Banished',
  opponentGrave: "Viewing Opponent's Grave",
  opponentBanished: "Viewing Opponent's Banished",
};

// Renders the "Viewing [location]" text overlay for either avatar — same
// call shape as renderExpressionOverlay above (null renders nothing, so
// this can be called unconditionally at both the player's own
// PlayerAvatarBox overlay prop and the opponent's own inline avatar box
// markup), and positions against that same PlayerAvatarBox's own
// position: relative.
//
// Unlike the expression overlay, this doesn't run on a fixed 3-second
// timer — it stays up for as long as the relevant player has one of the
// six pile viewers open (see the viewingLocation-sync effect further
// down, and DuelDoc's own player1ViewingLocation/player2ViewingLocation
// comment), so a single CSS keyframe timeline sized to a known duration
// (the way MultiplayerDuelFieldPage-expressionPulse is) can't drive its
// grow-in/shrink-out the way it drives the expression overlay's. Instead
// this uses AnimatePresence/motion.div — already used elsewhere in this
// app for exactly this "animate an element out before actually removing
// it" need, see DeckViewer's own context menu — to play a real exit
// animation on unmount, whenever `location` goes back to null. The
// "present" pulse (once grown in) is still a plain CSS animation
// (MultiplayerDuelFieldPage-viewingLocationPulse), the same technique as
// the thumbs-up icon's own inner pulse — kept as a separate inner <span>
// rather than on motion.div's own element, so it doesn't fight
// motion.div's own grow/shrink scale (two `transform`s can't combine on
// one element any more than MultiplayerDuelFieldPage-expressionOverlayImage
// --thumbsUp's own comment already explains for the thumbs-up icon).
function renderViewingLocationOverlay(location: ViewingLocation | null) {
  return (
    <AnimatePresence>
      {location && (
        <motion.div
          key="viewingLocationOverlay"
          className="MultiplayerDuelFieldPage-viewingLocationOverlay"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          <span className="MultiplayerDuelFieldPage-viewingLocationText">
            {VIEWING_LOCATION_LABELS[location]}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Kept in sync with the resolve-on-timeout effect further down, which is
// what actually ends the match once this elapses — this constant is
// purely the display's own idea of the countdown length, not something
// that independently controls when the match actually resolves.
const DISCONNECT_TIMEOUT_MS = 60_000;

// Ticks down once a second, purely a DISPLAY of time already elapsed
// against disconnectTimer's own startedAt (see DuelDoc's own comment on
// that field) — this component doesn't decide anything itself, in
// particular it does NOT resolve the match when it reaches 0 (see this
// page's own resolve-on-timeout effect for that; both this component and
// that effect independently derive the same remaining time from the same
// startedAt, rather than one driving the other). Recomputes from
// Date.now() - startedAt on every tick, rather than counting its own
// local seconds down from 60, so a client that mounts partway through
// (a page load, a remount) shows the CORRECT remaining time immediately
// rather than restarting from a fresh 60.
function DisconnectCountdown({ startedAt }: { startedAt: number }) {
  const computeRemaining = () =>
    Math.max(0, Math.ceil((startedAt + DISCONNECT_TIMEOUT_MS - Date.now()) / 1000));
  const [remaining, setRemaining] = useState(computeRemaining);
  useEffect(() => {
    setRemaining(computeRemaining());
    const intervalId = window.setInterval(() => {
      setRemaining(computeRemaining());
    }, 250);
    return () => window.clearInterval(intervalId);
    // computeRemaining intentionally not a dependency — it's a fresh
    // closure every render (not memoized), and it only ever reads
    // `startedAt`, which IS already a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);
  return <div className="MultiplayerDuelFieldPage-disconnectCountdown">{remaining}</div>;
}

// Renders the countdown over whichever avatar it belongs to — null
// whenever no countdown is currently running, or it belongs to the
// OTHER player's avatar (avatarRole is which player's own avatar box
// THIS call is rendering into, e.g.
// renderDisconnectCountdownOverlay(disconnectTimer, state.role) for this
// player's own avatar box, opponentRole for the opponent's — so the
// countdown only ever actually shows up over the DISCONNECTED player's
// own avatar, on whichever client happens to be looking). Shared between
// the normal duel field's own avatars and Side Decking's own duplicate
// pair, same "written once, used everywhere it's needed" reasoning as
// renderChatMessage/renderExpressionOverlay above.
// key={disconnectTimer.startedAt} is what makes a SECOND disconnect
// (after a first one that already ran to completion or was cancelled by
// a reconnect) restart the visible countdown cleanly, rather than
// DisconnectCountdown's own state carrying over from the first.
function renderDisconnectCountdownOverlay(
  disconnectTimer: { role: PlayerRole; startedAt: number } | null,
  avatarRole: PlayerRole | null,
) {
  if (!disconnectTimer || !avatarRole || disconnectTimer.role !== avatarRole) return null;
  return (
    <DisconnectCountdown key={disconnectTimer.startedAt} startedAt={disconnectTimer.startedAt} />
  );
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
    lastAutoDrawnTurn: me.lastAutoDrawnTurn,
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
    myDieRoll,
    opponentDieRoll,
    myCoinFlip,
    opponentCoinFlip,
    pendingControlTransfers,
    pendingCardReturns,
    pendingPileRequests,
    handRevealExitedBy,
    matchConclusion,
    matchWins,
    duelNumber,
    duelStartingRole,
    matchOutcome,
    myDoneSiding,
    opponentDoneSiding,
    chatMessages,
    duelLog,
    duelStartedAt,
    myExpression,
    opponentExpression,
    myViewingLocation,
    opponentViewingLocation,
    forfeitedBy,
    disconnectTimer,
    disconnectedBy,
    startNextDuel,
  } = useMultiplayerDuel(duelId, state.role, state.opponentInfo, state.myDeckId);

  // Computed once here rather than inline at each of the several call
  // sites that need it (the disconnect countdown overlay, the
  // resolve-on-timeout effect below) — same value handleRevealedHandCardClick
  // and several other handlers elsewhere in this file already compute
  // ad hoc for their own one-off use, just given a single shared name
  // here since this feature needs it in more than one place.
  const opponentRole: PlayerRole | null =
    state.role === 'player1' ? 'player2' : state.role === 'player2' ? 'player1' : null;

  // --- Duel Log ---
  // This client's own display name, as it should appear at the front of
  // every Duel Log entry this client itself writes (every action handler
  // below logs the ACTOR's own action, and the actor is always this
  // client for everything except the match/duel-lifecycle and
  // disconnect/reconnect entries, which useMultiplayerDuel's own init/
  // presence effects post instead — see DuelLogEntry's own comment).
  // Falls back the same way handleAdmitDefeatConfirm's own copy of this
  // already does, for the same reason (currentUser briefly null on a
  // very first render).
  const myUsername = currentUser?.displayName ?? 'A player';
  // Wraps one Duel Log entry, attributed to THIS client's own role, in
  // the arrayUnion field update most call sites below merge straight
  // into whatever setDoc/applyMeUpdate write the triggering action was
  // already making — see DuelDoc's own duelLog/duelStartedAt comments
  // for the full array-append/timestamp reasoning. A handler that needs
  // to log an action NOT attributed to this client's own role (there are
  // none among the player-triggered handlers below — every one of them
  // only ever logs its own actor's own action) would pass a second
  // argument instead of relying on this default.
  const logDuelAction = (text: string, role: PlayerRole | 'system' = state.role ?? 'system') =>
    arrayUnion(buildDuelLogEntry(role, text, duelStartedAt));
  // "zone 2" rather than a raw index — 1-indexed since that's how a
  // person would actually refer to one of their 3 Monster/Spell-Trap
  // Zone slots ("my second zone"), not how the array storing them
  // happens to be indexed internally.
  const zoneName = (index: number) => `zone ${index + 1}`;
  // "(zone 2)" — the parenthesized form most requested entry formats use
  // as a trailing suffix (Normal/Special/Fusion/etc. Summon, activate,
  // Set, attack); a couple of others (declared effect, moved) instead
  // fold the bare zoneName in as their own "in [location]" value, with
  // no parentheses of their own.
  const zoneLabel = (index: number) => `(${zoneName(index)})`;

  // --- Side Decking (see the "--- Side Decking ---" section further
  // down for the full feature) — getSavedDeck/cardById are needed here,
  // at the top of the component, purely to resolve card IDs into
  // CardData for the Side Decking screen; a second, independent
  // useSavedDecks() subscription (useMultiplayerDuel already has its
  // own, separate copy, used only for the very first duel's own initial
  // shuffle) — both just read the same Firestore data, so there's no
  // consistency concern in having two.
  const { getSavedDeck } = useSavedDecks();
  const savedDeck = state.myDeckId ? getSavedDeck(state.myDeckId) : null;
  // Chat — this player's own avatar, for their own message bubbles (see
  // the "--- Chat ---" section further down). The opponent's own
  // messages resolve their avatar from opponent.avatarId instead, the
  // same already-available field PlayerAvatarBox/the opponent HUD use.
  const { avatarId: myAvatarId } = useUserAvatar();
  const allCards = cardData as CardData[];
  const cardById = useMemo(() => new Map(allCards.map((card) => [card.id, card])), [allCards]);

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
  // Same idea, for the Exit button — see the "--- Exit / Forfeit ---"
  // section further down for the actual forfeit write this guards.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // Whether the Duel Log overlay is open — purely local, both-players-
  // press-it-independently UI state, the same shape as the confirm
  // prompts above, just without any confirmation step of its own (see
  // the "--- Duel Log ---" section's own renderDuelLogOverlay).
  const [showDuelLog, setShowDuelLog] = useState(false);
  // Auto-scrolled to the bottom on every new entry AND whenever the
  // overlay is (re)opened — the same reasoning as chatHistoryRef's own
  // effect, just also keyed on showDuelLog so opening the overlay after
  // several entries have already piled up starts scrolled to the most
  // recent one instead of the very first.
  const duelLogHistoryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showDuelLog) return;
    const el = duelLogHistoryRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [duelLog.length, showDuelLog]);
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
  // being tied to turnNumber === 1 specifically, since this also gets
  // reused at the start of duel 2/3 (see resetLocalStateForNewDuel
  // below). A remount that's actually a RECONNECT to a duel already in
  // progress (a refresh, or briefly closing and reopening the tab) — as
  // opposed to a genuinely fresh join — skips it via the effect just
  // below instead, now that useMultiplayerDuel's own initialization
  // effect no longer overwrites an already-in-progress duel's state on
  // remount (see that hook's own duelDoc?.[role] guard): reappearing
  // here too, on top of that, would still make a reconnect look like the
  // duel had restarted even though the underlying data hadn't.
  const [showFirstPlayerBanner, setShowFirstPlayerBanner] = useState(true);
  // Runs once, the first time `me` is available after a mount — if the
  // opening hand had already been dealt (only ever true for a duel
  // that's already under way), this mount is a reconnect, not a fresh
  // join, so the banner is dismissed immediately rather than making the
  // player wait out its usual ~2.5s before seeing their own board again.
  // A genuinely fresh duel has openingHandDealt still false at this
  // point, so the banner behaves exactly as before for that case.
  const hasCheckedReconnectBannerRef = useRef(false);
  useEffect(() => {
    if (hasCheckedReconnectBannerRef.current || !me) return;
    hasCheckedReconnectBannerRef.current = true;
    if (me.openingHandDealt) {
      setShowFirstPlayerBanner(false);
    }
  }, [me]);
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
  // "Start Turn". Keyed on turnNumber, via me.lastAutoDrawnTurn (a
  // persisted, Firestore-backed field — see PublicPlayerState's own
  // comment on it), rather than firing whenever currentPhase === 'draw',
  // so navigating back to Draw Phase later in the same turn doesn't draw
  // again — this only ever fires once per genuinely NEW turnNumber this
  // client has seen.
  //
  // Previously this was guarded by a plain useRef instead of a persisted
  // field, which broke on reconnect: refreshing or briefly closing and
  // reopening the tab during your own turn reset the ref back to null on
  // remount, with nothing to tell this effect "you already drew for this
  // turn, before you left" apart from that ref — so it looked exactly
  // like a fresh turn and fired a second, spurious draw the moment the
  // player reconnected. Persisting the marker in the very same write as
  // the draw itself (see the applyMeUpdate call below) closes that gap
  // the same way openingHandDealt already does for its own equivalent
  // problem.
  //
  // Gated on !showFirstPlayerBanner so even turn 1's own draw happens
  // once the field is actually visible and CardLayer is mounted to
  // animate it, rather than invisibly while the announcement banner is
  // still up. Also gated on BOTH players' own openingHandDealt —
  // opponent's own is public, so this client can see whether the
  // opponent has finished their opening draw even though it can't see
  // the cards themselves. Without this, turn 1's own draw could
  // interleave with the opening hand still being dealt (e.g. arriving as
  // an out-of-place 6th card partway through), rather than opening hands
  // finishing cleanly before any turn-based drawing begins. Checked via
  // this flag, not a live hand.length/handCount comparison, for the same
  // reason the opening-hand-draw effect above uses it instead of one
  // too: a normal draw later in the game must never be blocked just
  // because either player's hand size happens to be under
  // OPENING_HAND_SIZE at that moment (e.g. after playing several cards)
  // — only whether the ONE-TIME opening deal has ever completed matters
  // here.
  useEffect(() => {
    if (!isMyTurn || showFirstPlayerBanner) return;
    if (!me?.openingHandDealt || !opponent?.openingHandDealt) return;
    if (me.lastAutoDrawnTurn === turnNumber) return;
    applyMeUpdate(
      (current) => {
        // Re-checked against the LATEST state (not the `me` closed over
        // above), the same idempotency guarantee handleDrawCard's own
        // callers rely on elsewhere — this is what keeps a second
        // effect-fire before the first write has round-tripped back from
        // ever drawing twice for the same turn.
        if (current.lastAutoDrawnTurn === turnNumber) return current;
        if (current.mainDeck.length === 0) {
          return { ...current, lastAutoDrawnTurn: turnNumber };
        }
        const [drawnCard, ...restDeck] = current.mainDeck;
        return {
          ...current,
          hand: [...current.hand, drawnCard],
          mainDeck: restDeck,
          lastAutoDrawnTurn: turnNumber,
        };
      },
      { shuffleHand: false },
    );
    // applyMeUpdate is intentionally not a dependency — same reasoning as
    // the opening-hand-draw effect above (it's redefined every render,
    // not memoized), and the updater's own re-check against
    // current.lastAutoDrawnTurn already makes this effect idempotent
    // regardless of exactly when within a render cycle it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMyTurn,
    turnNumber,
    showFirstPlayerBanner,
    me?.openingHandDealt,
    opponent?.openingHandDealt,
    me?.lastAutoDrawnTurn,
  ]);
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

  // Mirrors viewingOwnPile/viewingOpponentPile above into the duel doc as
  // a single combined ViewingLocation, so the "Viewing [location]" text
  // overlay (see renderViewingLocationOverlay) shows up over the VIEWING
  // player's own avatar for BOTH players, not just locally — the same
  // "each client only ever writes its own field" convention as
  // player1Expression/player2Expression (see DuelDoc's own comment on
  // those two fields), just driven by a derived effect here rather than
  // a discrete click handler like handleSendExpression's own: there's no
  // single call site to hook a write into, since viewingOwnPile/
  // viewingOpponentPile are each set from several different places
  // scattered through this file (the Main/Extra Deck buttons, the
  // Grave/Banished zone clicks, the opponent's own Grave/Banished
  // clicks) — deriving one combined value here and syncing it in one
  // effect keeps this feature isolated to a single place rather than
  // needing every one of those existing call sites touched individually.
  // Unlike handleSendExpression's own 3-second auto-clear, this never
  // clears itself on a timer — it simply mirrors whatever
  // viewingOwnPile/viewingOpponentPile currently is, including back to
  // null the instant the relevant viewer is closed. The two are only
  // ever expected to be open one at a time in practice (opening one pile
  // viewer already closes any other), so this priority order (own pile
  // before the opponent's) is just a defensive fallback, never
  // meaningfully exercised.
  const currentViewingLocation: ViewingLocation | null =
    viewingOwnPile === 'main'
      ? 'mainDeck'
      : viewingOwnPile === 'extra'
        ? 'extraDeck'
        : viewingOwnPile === 'grave'
          ? 'grave'
          : viewingOwnPile === 'banished'
            ? 'banished'
            : viewingOpponentPile === 'grave'
              ? 'opponentGrave'
              : viewingOpponentPile === 'banished'
                ? 'opponentBanished'
                : null;
  // Human-readable phrasing for each ViewingLocation, matching the Duel
  // Log spec's own "[their/their opponent's] [Main Deck/Extra Deck/
  // Grave/Banished Zone]" wording exactly.
  const viewingLocationLabel = (location: ViewingLocation): string => {
    switch (location) {
      case 'mainDeck':
        return "their Main Deck";
      case 'extraDeck':
        return "their Extra Deck";
      case 'grave':
        return "their Grave";
      case 'banished':
        return "their Banished Zone";
      case 'opponentGrave':
        return "their opponent's Grave";
      case 'opponentBanished':
        return "their opponent's Banished Zone";
    }
  };
  // Tracks the previous value purely to diff transitions for Duel Log
  // "started/stopped viewing" entries — the setDoc sync above already
  // mirrors the CURRENT value unconditionally on every change, so this
  // ref only ever informs which log line(s), if any, to also append.
  const previousViewingLocationRef = useRef<ViewingLocation | null>(null);
  useEffect(() => {
    if (!duelId || !state.role) return;
    const field = `${state.role}ViewingLocation`;
    const previous = previousViewingLocationRef.current;
    previousViewingLocationRef.current = currentViewingLocation;
    const logEntries: DuelLogEntry[] = [];
    if (previous && previous !== currentViewingLocation) {
      logEntries.push(
        buildDuelLogEntry(state.role, `${myUsername} stopped viewing ${viewingLocationLabel(previous)}`, duelStartedAt),
      );
    }
    if (currentViewingLocation && currentViewingLocation !== previous) {
      logEntries.push(
        buildDuelLogEntry(
          state.role,
          `${myUsername} started viewing ${viewingLocationLabel(currentViewingLocation)}`,
          duelStartedAt,
        ),
      );
    }
    setDoc(
      doc(db, 'duels', duelId),
      {
        [field]: currentViewingLocation,
        ...(logEntries.length > 0 ? { duelLog: arrayUnion(...logEntries) } : {}),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to sync viewing location:', err);
    });
  }, [currentViewingLocation, duelId, state.role]);

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
    applyMeUpdate(
      (current) => {
        if (current.mainDeck.length === 0) return current;
        const [drawnCard, ...restDeck] = current.mainDeck;
        return { ...current, hand: [...current.hand, drawnCard], mainDeck: restDeck };
      },
      { shuffleHand: false, extraFields: { duelLog: logDuelAction(`${myUsername} drew a card`) } },
    );

  // The actual random result is generated HERE, once, at roll-start —
  // not inside DieRollDisplay itself — and immediately written to this
  // player's own DieRoll field (player1DieRoll/player2DieRoll), which is
  // what lets BOTH clients animate and settle on the exact same roll:
  // DieRollDisplay (in DuelField/DieRoller.tsx) derives its whole
  // tumble-then-settle animation purely from this shared
  // startedAt/rollId/result, and is rendered once, identically, for both
  // clients, centered in the shared reveal zone (see this page's own
  // activeDieRoll/dieRollSlot). The "[Player] rolled a
  // [number]" chat message is deliberately delayed until the animation
  // has actually finished (ROLL_DURATION_MS, imported from DieRoller so
  // the two can never drift apart) rather than posted immediately —
  // announcing the number in chat text the instant the roll starts would
  // spoil the whole point of watching it tumble first, for both players.
  // Cancelled/restarted on every new roll — same reasoning as
  // expressionClearTimeoutRef above: without this, clicking Roll again
  // before the FIRST roll's own clear had fired would let that stale
  // timeout null out the field a moment after the second roll started,
  // hiding it far too early.
  const dieRollClearTimeoutRef = useRef<number | undefined>(undefined);

  const handleRollDie = () => {
    if (!duelId || !state.role) return;
    const role = state.role;
    if (dieRollClearTimeoutRef.current !== undefined) {
      window.clearTimeout(dieRollClearTimeoutRef.current);
    }
    const result = 1 + Math.floor(Math.random() * 6);
    const roll: DieRollData = { result, startedAt: Date.now(), rollId: crypto.randomUUID() };
    const field = `${role}DieRoll`;
    setDoc(doc(db, 'duels', duelId), { [field]: roll }, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to start die roll:', err);
    });
    window.setTimeout(() => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role,
        text: `${currentUser?.displayName ?? 'A player'} rolled a ${result}`,
        sentAt: Date.now(),
      };
      setDoc(
        doc(db, 'duels', duelId),
        {
          chatMessages: arrayUnion(message),
          // Logged on this same delay, for the same reason the chat
          // message itself is (see this function's own top comment) —
          // the reveal, not the roll's own start, is the moment worth
          // recording.
          duelLog: logDuelAction(`${myUsername} rolled a ${result}`, role),
        },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to send die roll message:', err);
      });
    }, ROLL_DURATION_MS);
    // Clears the die back to null (hiding it — both DuelField's own
    // DieRollButton, which simply re-enables once its own roll field is
    // null, and this page's own shared dieRollZone display, which simply
    // stops rendering once neither side has an active roll) 3 seconds
    // after the roll actually finishes settling, rather than leaving it
    // showing indefinitely.
    dieRollClearTimeoutRef.current = window.setTimeout(() => {
      setDoc(doc(db, 'duels', duelId), { [field]: null }, { merge: true }).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to clear die roll:', err);
      });
      dieRollClearTimeoutRef.current = undefined;
    }, ROLL_DURATION_MS + 3000);
  };

  // Mirrors handleRollDie above exactly — same shared-write-then-delayed-
  // chat-message-then-auto-clear shape, just for a coin's two possible
  // results instead of a die's six. See that function's own comments for
  // the full reasoning; not repeated here since none of it differs.
  const coinFlipClearTimeoutRef = useRef<number | undefined>(undefined);

  const handleFlipCoin = () => {
    if (!duelId || !state.role) return;
    const role = state.role;
    if (coinFlipClearTimeoutRef.current !== undefined) {
      window.clearTimeout(coinFlipClearTimeoutRef.current);
    }
    const result: 'heads' | 'tails' = Math.random() < 0.5 ? 'heads' : 'tails';
    const flip: CoinFlipData = { result, startedAt: Date.now(), flipId: crypto.randomUUID() };
    const field = `${role}CoinFlip`;
    setDoc(doc(db, 'duels', duelId), { [field]: flip }, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to start coin flip:', err);
    });
    window.setTimeout(() => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role,
        text: `${currentUser?.displayName ?? 'A player'}'s coin landed on ${result}`,
        sentAt: Date.now(),
      };
      setDoc(
        doc(db, 'duels', duelId),
        {
          chatMessages: arrayUnion(message),
          duelLog: logDuelAction(`${myUsername}'s coin landed on ${result}`, role),
        },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to send coin flip message:', err);
      });
    }, FLIP_DURATION_MS);
    coinFlipClearTimeoutRef.current = window.setTimeout(() => {
      setDoc(doc(db, 'duels', duelId), { [field]: null }, { merge: true }).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to clear coin flip:', err);
      });
      coinFlipClearTimeoutRef.current = undefined;
    }, FLIP_DURATION_MS + 3000);
  };

  // appliedDelta is the ACTUAL change (which can differ from the
  // requested `delta` — e.g. subtracting 500 from 300 only actually
  // loses 300, since lifePoints is clamped to 0), captured by the
  // updater below and read back afterward by extraFields, per
  // applyMeUpdate's own comment on that pattern (the generic
  // leave-zone handler uses the same trick). Declared here, outside the
  // updater, since extraFields needs to see it after the updater has
  // already run, not build its own separate copy of the clamping logic.
  const handleLifePointChange = (delta: number) => {
    if (delta === 0) return;
    let appliedDelta = 0;
    applyMeUpdate(
      (current) => {
        const nextLifePoints = Math.max(0, current.lifePoints + delta);
        appliedDelta = nextLifePoints - current.lifePoints;
        return { ...current, lifePoints: nextLifePoints };
      },
      {
        extraFields: () => {
          // Nothing actually changed (e.g. already at 0 and subtracting
          // further) — no system message for a no-op change.
          if (appliedDelta === 0) return undefined;
          const verb = appliedDelta > 0 ? 'gained' : 'lost';
          return {
            chatMessages: arrayUnion(
              buildSystemChatMessage(
                `${currentUser?.displayName ?? 'A player'} has ${verb} ${Math.abs(appliedDelta)} Life Points`,
              ),
            ),
            duelLog: logDuelAction(
              `${myUsername} ${appliedDelta > 0 ? 'gained' : 'lost'} ${Math.abs(appliedDelta)} Life Points`,
            ),
          };
        },
      },
    );
  };

  // A deliberate, player-triggered shuffle — separate from the automatic
  // reshuffle that can happen when a card is added to the hand, but using
  // the exact same handShuffleVersion mechanism for the animation.
  // No length check needed here, unlike applyMeUpdate's own automatic
  // version — this always counts as a shuffle regardless of whether
  // the hand's size happens to have changed.
  const handleShuffleHand = () =>
    applyMeUpdate(
      (current) => ({
        ...current,
        hand: shuffle(current.hand),
        handShuffleVersion: current.handShuffleVersion + 1,
      }),
      { extraFields: { duelLog: logDuelAction(`${myUsername} shuffled their hand`) } },
    );

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
    applyMeUpdate(
      (current) => ({ ...current }),
      {
        extraFields: {
          handRevealExitedBy: null,
          duelLog: logDuelAction(`${myUsername} revealed their hand`),
        },
      },
    );
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

  // Whether the given instanceId is the current selection in either
  // channel — Grave/Banished cards are always public knowledge (unlike
  // hand cards), so unlike getSelectionColor's own real matching logic
  // (in CardLayer.tsx) there's no hand-encoding case to decode here: the
  // stored selection target for one of these IS just its real instanceId,
  // compared directly.
  const getPileSelectionColor = (instanceId: string): 'mine' | 'opponent' | null => {
    if (mySelection === instanceId) return 'mine';
    if (opponentSelection === instanceId) return 'opponent';
    return null;
  };

  // Selecting a card in a Grave/Banished viewer (own OR opponent's,
  // either player's zone — see the two DeckViewer call sites below) —
  // drives the same red/blue outline as everywhere else via
  // handleSelectCard's own mySelectionChannel/instanceId convention, and
  // additionally announces the pick in chat, exactly like a real typed
  // message (role: state.role, not 'system'). Only announced on the
  // SELECT half of the click-to-toggle interaction, never on deselect —
  // there's nothing worth announcing about a selection being cleared.
  const handleSelectPileCard = (instanceId: string, cardName: string, zoneDescription: string) => {
    if (!duelId || !state.role) return;
    const next = mySelection === instanceId ? null : instanceId;
    const fields: Record<string, unknown> = { [`${state.role}Selection`]: next };
    if (next) {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: state.role,
        text: `${currentUser?.displayName ?? 'A player'} selected ${cardName} in ${zoneDescription}`,
        sentAt: Date.now(),
      };
      fields.chatMessages = arrayUnion(message);
      fields.duelLog = logDuelAction(`${myUsername} selected ${cardName} in ${zoneDescription}`);
    }
    setDoc(doc(db, 'duels', duelId), fields, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to update pile selection:', err);
    });
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

  // --- Chat ---
  // Purely local: what's currently typed into the chat box, not yet
  // sent. Cleared the moment a message actually sends (see
  // handleSendChatMessage below) — the sent message itself then arrives
  // back through chatMessages, the same as any other player's message,
  // rather than this input's own value being treated as a local optimistic
  // echo of it.
  const [chatInput, setChatInput] = useState('');
  // The scrollable message history box — auto-scrolled to the bottom
  // whenever a new message arrives (see the effect below), so the most
  // recent message is always the one in view rather than requiring a
  // manual scroll every time.
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatHistoryRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  // Appended via arrayUnion, not a plain merge write of the whole array
  // — same reasoning as pendingControlTransfers/pendingCardReturns/
  // pendingPileRequests elsewhere in this file (see DuelDoc's own
  // comment on chatMessages): two messages sent close together, by
  // either or both players, must never let the second silently
  // overwrite the first before anyone's seen it. Trims and ignores an
  // empty/whitespace-only send rather than adding a blank message
  // bubble.
  const handleSendChatMessage = () => {
    const text = chatInput.trim();
    if (!text || !duelId || !state.role) return;
    setChatInput('');
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: state.role,
      text,
      sentAt: Date.now(),
    };
    setDoc(
      doc(db, 'duels', duelId),
      {
        chatMessages: arrayUnion(message),
        // Every chat message gets its own Duel Log entry too, per
        // request — quoted, so it reads unambiguously as what was SAID
        // rather than another automated action line.
        duelLog: logDuelAction(`${myUsername}: "${text}"`),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to send chat message:', err);
    });
  };

  // Enter sends (Shift+Enter would be the usual way to allow a newline
  // instead, but the chat box here is a single-line input, not a
  // textarea, so there's no newline case to special-case around).
  const handleChatInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSendChatMessage();
    }
  };

  // Disconnect/reconnect chat announcements used to live here as a
  // client-side 'pagehide' listener, but that approach turned out to be
  // unreliable in practice — a browser tears down in-flight network
  // requests the instant a page actually unloads, so there's often not
  // enough time left for the async Firestore write to escape before the
  // connection is gone, and it could never catch a crash or a dropped
  // network at all (neither fires any JS event to hook into). Replaced
  // with a proper Realtime Database presence system — see
  // useMultiplayerDuel's own "--- Presence ---" effects for the full
  // reasoning; this page doesn't need to do anything for it directly,
  // since chatMessages (which those effects write into) already flows
  // through here via the normal chat rendering.

  // --- Expressions ---
  // Tracks the pending "clear this back to null" timer for THIS client's
  // own most recent expression click, so a second click (of either
  // expression) before the first one's own 3-second window has elapsed
  // cancels and restarts that timer, rather than the first click's
  // now-stale timeout firing partway through the second one's own
  // animation and clearing it early.
  const expressionClearTimeoutRef = useRef<number | undefined>(undefined);
  const handleSendExpression = (type: ExpressionEvent['type']) => {
    if (!duelId || !state.role) return;
    if (expressionClearTimeoutRef.current !== undefined) {
      window.clearTimeout(expressionClearTimeoutRef.current);
    }
    const field = `${state.role}Expression`;
    setDoc(
      doc(db, 'duels', duelId),
      {
        [field]: { id: crypto.randomUUID(), type },
        duelLog: logDuelAction(
          type === 'thumbsUp' ? `${myUsername} gave thumbs-up` : `${myUsername} was thinking`,
        ),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to send expression:', err);
    });
    // Clears back to null ~3 seconds later — see
    // MultiplayerDuelFieldPage-expressionOverlay's own CSS animation,
    // which is timed to this same 3-second duration: the grow-then-hold-
    // then-shrink keyframe animation finishes right around when this
    // clears the field and the overlay element actually unmounts, so the
    // shrink transition is already visually complete by then rather than
    // the element just vanishing mid-animation.
    expressionClearTimeoutRef.current = window.setTimeout(() => {
      setDoc(doc(db, 'duels', duelId), { [field]: null }, { merge: true }).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to clear expression:', err);
      });
      expressionClearTimeoutRef.current = undefined;
    }, 3000);
  };

  // --- Side Decking ---
  // The player's own working Main/Side Deck lists for the whole MATCH
  // (not just the current duel) — starts as the saved deck's own
  // main/extra/side lists (see the initializing effect below), then
  // carries forward, swap by swap, across every duel in this match.
  // Deliberately NOT re-read from the saved deck at the start of each
  // new duel (that would silently undo any siding already done) — only
  // "Reset Deck" explicitly goes back to the saved deck's own lists.
  // null until the saved deck itself has loaded.
  const [matchMainIds, setMatchMainIds] = useState<number[] | null>(null);
  const [matchExtraIds, setMatchExtraIds] = useState<number[] | null>(null);
  const [matchSideIds, setMatchSideIds] = useState<number[] | null>(null);
  // Indices into matchMainIds/matchExtraIds/matchSideIds (not card ids)
  // — indices disambiguate multiple copies of the same card the same
  // way DeckBuilder's own DeckSlots does.
  //
  // selectedMainIndices and selectedExtraIndices are kept mutually
  // exclusive — never both non-empty at once (see toggleMainSelection/
  // toggleExtraSelection below) — which is what actually enforces "can't
  // swap a Main Deck card for an Extra Deck card": a single Swap Cards
  // click only ever exchanges cards between Side and WHICHEVER ONE of
  // Main/Extra currently has a selection (see
  // handleSwapSideDeckCards below), so a Main card can only ever land
  // back in Main, and an Extra card only ever back in Extra. Side
  // Deck's own selection is a single shared pool either way — nothing
  // about a Side Deck card itself says which of Main/Extra it's
  // destined for, that's determined entirely by which of the other two
  // has cards selected at swap time.
  const [selectedMainIndices, setSelectedMainIndices] = useState<number[]>([]);
  const [selectedExtraIndices, setSelectedExtraIndices] = useState<number[]>([]);
  const [selectedSideIndices, setSelectedSideIndices] = useState<number[]>([]);

  // Runs once, the first time the saved deck is actually available —
  // guarded by matchMainIds still being null so this never re-fires and
  // clobbers in-progress siding on a later render (savedDeck itself is a
  // stable reference from useSavedDecks' own array once loaded, but
  // there's no reason to depend on that staying true).
  useEffect(() => {
    if (!savedDeck || matchMainIds !== null) return;
    setMatchMainIds(savedDeck.main);
    setMatchExtraIds(savedDeck.extra);
    setMatchSideIds(savedDeck.side);
  }, [savedDeck, matchMainIds]);

  // Drops any already-selected Side Deck card that ISN'T legal for the
  // deck the Side Deck is now being matched against — e.g. selecting a
  // Main Deck card commits this swap to the Main <-> Side channel, so
  // any Side Deck card selected a moment ago that's actually
  // Extra-Deck-only (Fusion/Ritual/Evolution) needs to drop out of the
  // selection too, or it could end up swapped into the Main Deck.
  // keepExtraEligible is true when filtering FOR the Extra channel
  // (keep only Fusion/Ritual/Evolution), false when filtering for the
  // Main channel (keep only everything else).
  const pruneSideSelectionForChannel = (keepExtraEligible: boolean) => {
    setSelectedSideIndices((prevSide) =>
      prevSide.filter((i) => {
        const id = matchSideIds?.[i];
        const card = id !== undefined ? cardById.get(id) : undefined;
        if (!card) return true;
        return isExtraDeckCard(card) === keepExtraEligible;
      }),
    );
  };

  const toggleMainSelection = (index: number) => {
    setSelectedMainIndices((prev) => {
      const next = prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index];
      // Selecting (not deselecting) a Main Deck card commits this
      // swap to the Main <-> Side channel — clear out any Extra Deck
      // selection so the two can never mix (see this state's own
      // declaration comment above), and drop any already-selected Side
      // Deck card that isn't legal in the Main Deck.
      if (next.length > prev.length) {
        setSelectedExtraIndices([]);
        pruneSideSelectionForChannel(false);
      }
      return next;
    });
  };
  const toggleExtraSelection = (index: number) => {
    setSelectedExtraIndices((prev) => {
      const next = prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index];
      if (next.length > prev.length) {
        setSelectedMainIndices([]);
        pruneSideSelectionForChannel(true);
      }
      return next;
    });
  };
  const toggleSideSelection = (index: number) => {
    setSelectedSideIndices((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      // Selecting a NEW Side Deck card — only allow it if it's legal
      // for whichever of Main/Extra is currently the active swap
      // channel (see toggleMainSelection/toggleExtraSelection above).
      // Neither active yet (both empty) means nothing to check against,
      // so any card can be the first one selected.
      const id = matchSideIds?.[index];
      const card = id !== undefined ? cardById.get(id) : undefined;
      if (card) {
        const cardIsExtraEligible = isExtraDeckCard(card);
        if (selectedExtraIndices.length > 0 && !cardIsExtraEligible) return prev;
        if (selectedMainIndices.length > 0 && cardIsExtraEligible) return prev;
      }
      return [...prev, index];
    });
  };

  // The Swap Cards button is only ever clickable once an equal, nonzero
  // number of cards is selected on the Side Deck and on WHICHEVER of
  // Main/Extra currently has a selection — see SideDecking's own button
  // for where this actually gates the click. Main and Extra are never
  // both selected at once (see toggleMainSelection/toggleExtraSelection
  // above), so at most one of these two clauses can ever be true.
  const canSwapSideDeckCards =
    (selectedMainIndices.length > 0 && selectedMainIndices.length === selectedSideIndices.length) ||
    (selectedExtraIndices.length > 0 && selectedExtraIndices.length === selectedSideIndices.length);

  const handleSwapSideDeckCards = () => {
    if (!canSwapSideDeckCards || !matchMainIds || !matchExtraIds || !matchSideIds) return;
    const sideSelectedSet = new Set(selectedSideIndices);
    const sideMovingOut = selectedSideIndices.map((i) => matchSideIds[i]);

    if (selectedMainIndices.length > 0) {
      const mainSelectedSet = new Set(selectedMainIndices);
      const mainMovingToSide = selectedMainIndices.map((i) => matchMainIds[i]);
      setMatchMainIds([
        ...matchMainIds.filter((_, i) => !mainSelectedSet.has(i)),
        ...sideMovingOut,
      ]);
      setMatchSideIds([
        ...matchSideIds.filter((_, i) => !sideSelectedSet.has(i)),
        ...mainMovingToSide,
      ]);
    } else {
      const extraSelectedSet = new Set(selectedExtraIndices);
      const extraMovingToSide = selectedExtraIndices.map((i) => matchExtraIds[i]);
      setMatchExtraIds([
        ...matchExtraIds.filter((_, i) => !extraSelectedSet.has(i)),
        ...sideMovingOut,
      ]);
      setMatchSideIds([
        ...matchSideIds.filter((_, i) => !sideSelectedSet.has(i)),
        ...extraMovingToSide,
      ]);
    }

    setSelectedMainIndices([]);
    setSelectedExtraIndices([]);
    setSelectedSideIndices([]);
  };

  const handleResetSideDeck = () => {
    if (!savedDeck) return;
    setMatchMainIds(savedDeck.main);
    setMatchExtraIds(savedDeck.extra);
    setMatchSideIds(savedDeck.side);
    setSelectedMainIndices([]);
    setSelectedExtraIndices([]);
    setSelectedSideIndices([]);
  };

  // Marks THIS player's own side of player1DoneSiding/player2DoneSiding
  // — a plain top-level field per role (same convention as
  // player1Selection/player2Selection), not one shared nested object,
  // specifically so both clients can each write their own flag
  // independently without racing to merge the same field (see
  // DuelDoc's own comment on why pendingControlTransfers/
  // pendingCardReturns need arrayUnion for the same underlying reason —
  // two clients writing the same plain object field, one after the
  // other, can silently clobber each other's half).
  const handleDoneSidingClick = () => {
    if (!duelId || !state.role) return;
    const field = state.role === 'player1' ? 'player1DoneSiding' : 'player2DoneSiding';
    setDoc(doc(db, 'duels', duelId), { [field]: true }, { merge: true }).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to mark done siding:', err);
    });
  };

  // True during the window between one duel ending (without deciding
  // the whole match) and the next one actually starting — see the
  // render guard further down, which shows the Side Decking screen
  // instead of the normal duel field for exactly this condition.
  const isSidingPhase =
    (matchConclusion?.type === 'defeatAdmitted' || matchConclusion?.type === 'drawAccepted') &&
    !matchOutcome;

  // --- Exit / Forfeit ---
  // Leaving via Exit, once confirmed, forfeits the match outright to the
  // opponent — regardless of the current duel win tally — rather than
  // simply navigating away and leaving the match's own outcome
  // unresolved. forfeitedBy is a separate field from matchOutcome
  // itself purely so the OPPONENT's own client can tell a forfeit apart
  // from an ordinary match win and show the different "Your opponent
  // has left the duel" message (see the match outcome dialog's own
  // message logic further down) — matchOutcome alone is set to exactly
  // the same shape a normal win already uses (winnerRole's own
  // WinsMatch type), so every OTHER matchOutcome-driven effect in this
  // file (Admit Defeat/Offer Draw going disabled, Side Decking's own
  // isSidingPhase turning false, etc.) already treats a forfeit exactly
  // like any other final match outcome, with no special-casing needed
  // for those.
  // Once the match is already decided — matchOutcome is set, whether
  // from a normal 2-duel win, a draw, or an earlier forfeit — there's
  // nothing left to forfeit, so Exit just leaves immediately, the same
  // as it always did before this feature existed, rather than asking a
  // question ("you forfeit the match") that's no longer true.
  const handleExitClick = () => {
    if (isMatchOver) {
      navigate('/duel');
      return;
    }
    setShowExitConfirm(true);
  };
  const handleExitCancel = () => setShowExitConfirm(false);
  const handleExitConfirm = () => {
    setShowExitConfirm(false);
    if (duelId && state.role) {
      const winnerRole: PlayerRole = state.role === 'player1' ? 'player2' : 'player1';
      setDoc(
        doc(db, 'duels', duelId),
        {
          forfeitedBy: state.role,
          matchOutcome: { type: winnerRole === 'player1' ? 'player1WinsMatch' : 'player2WinsMatch' },
          // Belt-and-braces: if the OPPONENT happened to have an active
          // disconnect countdown running against THEM at this exact
          // moment (a genuinely rare double-edge-case), the match is
          // being decided right now anyway via this forfeit, so there's
          // nothing left for that countdown to resolve.
          disconnectTimer: null,
          duelLog: logDuelAction(`${myUsername} left the match`),
        },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to record forfeit:', err);
      });
    }
    navigate('/duel');
  };

  // Ends the match immediately once a disconnect countdown (see DuelDoc's
  // own comment on disconnectTimer) elapses without the disconnected
  // player reconnecting — the DisconnectCountdown component above only
  // ever DISPLAYS the remaining time; this is what actually decides the
  // outcome once it reaches zero, independently deriving the same
  // remaining time from the same disconnectTimer.startedAt.
  //
  // Only the STILL-CONNECTED client (disconnectTimer.role !== state.role)
  // ever runs this — the disconnected player's own client obviously can't
  // resolve anything while it's the one that's gone, and if THEY
  // reconnect in time and are looking at this effect themselves, they
  // must never be the one to declare themselves the loser.
  //
  // Depends on `disconnectTimer` itself (not just its startedAt), so a
  // reconnect that clears it back to null — or a NEW disconnect that
  // replaces it with a fresh startedAt — tears down whatever timeout was
  // previously scheduled (the effect's own cleanup) before this body
  // decides whether to schedule a new one, rather than an old, stale
  // timeout still firing after the situation that started it is over.
  // Also depends on `matchOutcome`: if the match gets decided some OTHER
  // way (e.g. the opponent's own remaining client admits defeat) while
  // this is still pending, that same cleanup-then-reevaluate cycle cancels
  // this without it ever firing.
  useEffect(() => {
    if (!duelId || !state.role || !disconnectTimer || disconnectTimer.role === state.role) return;
    if (matchOutcome) return;
    const remainingMs = disconnectTimer.startedAt + DISCONNECT_TIMEOUT_MS - Date.now();
    const timeoutId = window.setTimeout(() => {
      const winnerRole = state.role as PlayerRole;
      setDoc(
        doc(db, 'duels', duelId),
        {
          matchOutcome: { type: winnerRole === 'player1' ? 'player1WinsMatch' : 'player2WinsMatch' },
          disconnectedBy: disconnectTimer.role,
          disconnectTimer: null,
        },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to resolve disconnect timeout:', err);
      });
      // Math.max(0, ...) — a countdown resumed after this client's own
      // remount could already be past its own deadline by the time this
      // effect first runs (e.g. this client was itself offline for a
      // while and only just reconnected); firing immediately rather than
      // scheduling a negative delay is the correct behavior for that
      // case, not a bug to guard against differently.
    }, Math.max(0, remainingMs));
    return () => window.clearTimeout(timeoutId);
  }, [duelId, state.role, disconnectTimer, matchOutcome]);

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
        // Belt-and-braces, same reasoning as handleExitConfirm's own
        // copy of this: only clear it once the MATCH is actually over —
        // a disconnect countdown belongs to a player, not a single duel,
        // so it should keep running across an ordinary duel-to-duel
        // transition (matchDecided false) rather than being wiped by it.
        ...(matchDecided ? { disconnectTimer: null } : {}),
        // Merged into this same write (via arrayUnion, same as every
        // other chatMessages append) rather than a separate setDoc — see
        // buildSystemChatMessage's own comment for why. currentUser is
        // THIS client's own account, i.e. the player admitting defeat
        // (loserRole), so their own displayName is exactly the name this
        // message should name.
        chatMessages: arrayUnion(
          buildSystemChatMessage(`${currentUser?.displayName ?? 'A player'} has admitted defeat`),
        ),
        duelLog: logDuelAction(`${myUsername} admitted defeat`, loserRole),
        // The loser of a decisive duel goes first next. Only reset the
        // Side Decking done-flags when the match ISN'T over — a
        // match-deciding duel skips siding entirely (isSidingPhase
        // requires !matchOutcome), so there's no siding phase for these
        // to gate in that case.
        ...(matchDecided
          ? {}
          : {
              duelNumber: duelNumber + 1,
              duelStartingRole: loserRole,
              player1DoneSiding: false,
              player2DoneSiding: false,
            }),
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
      {
        matchConclusion: { type: 'drawOffered', offererRole: state.role },
        // Same "merged into this same write via arrayUnion" reasoning as
        // handleAdmitDefeatConfirm's own copy of this comment — currentUser
        // is THIS client's own account, i.e. the player making the offer,
        // so their own displayName is exactly the name this should name.
        chatMessages: arrayUnion(
          buildSystemChatMessage(`${currentUser?.displayName ?? 'A player'} offered a draw`),
        ),
        duelLog: logDuelAction(`${myUsername} offered a draw`),
      },
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
        // Same reasoning as handleAdmitDefeatConfirm's own copy of this
        // — only reset the Side Decking done-flags when a siding phase
        // is actually about to start (the match isn't over yet).
        ...(matchOutcomeUpdate
          ? {}
          : {
              duelNumber: duelNumber + 1,
              duelStartingRole: nextStartingRole,
              player1DoneSiding: false,
              player2DoneSiding: false,
            }),
        // Same "merged into this same write via arrayUnion" reasoning as
        // handleAdmitDefeatConfirm's own copy of this comment — this
        // handler is only ever callable by the player who was OFFERED the
        // draw (see its own comment above), i.e. THIS client, so
        // currentUser's own displayName is exactly the name this should
        // name.
        chatMessages: arrayUnion(
          buildSystemChatMessage(`${currentUser?.displayName ?? 'A player'} accepted draw offer`),
        ),
        duelLog: logDuelAction(`${myUsername} accepted draw offer`),
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
      {
        matchConclusion: { type: 'drawDeclined', offererRole: matchConclusion.offererRole },
        // Same reasoning as handleAcceptDraw's own copy of this comment —
        // only the player who was OFFERED the draw can decline it, i.e.
        // THIS client, so currentUser's own displayName is exactly the
        // name this should name.
        chatMessages: arrayUnion(
          buildSystemChatMessage(`${currentUser?.displayName ?? 'A player'} declined draw offer`),
        ),
        duelLog: logDuelAction(`${myUsername} declined draw offer`),
      },
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
    // No lastAutoDrawnTurnRef reset needed here anymore — the marker is
    // now a persisted field (me.lastAutoDrawnTurn) that startNextDuel's
    // own fresh publicState write already resets to null on its own, the
    // same way openingHandDealt resets itself for a new duel.
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
    // Clears out any leftover Side Decking selections from the phase
    // that just ended, so the NEXT siding phase (after the duel that's
    // about to start) begins with a clean slate — matchMainIds/
    // matchExtraIds/matchSideIds themselves are deliberately NOT reset
    // here, since they need to persist across duels within the same
    // match (see their own declaration comment).
    setSelectedMainIndices([]);
    setSelectedExtraIndices([]);
    setSelectedSideIndices([]);
  };

  // Auto-advances straight into the next duel once one has just ended
  // (defeatAdmitted/drawAccepted), the MATCH itself isn't over yet, AND
  // BOTH players have clicked "Done Siding" (see isSidingPhase/
  // handleDoneSidingClick above) — no confirmation dialog for the duel
  // outcome itself, on either client: a mid-match duel outcome doesn't
  // need a player to click OK before Side Decking starts, only the
  // match's own final outcome does (see the matchOutcome dialog further
  // down). Siding itself, unlike the old immediate auto-advance, DOES
  // gate starting the next duel — that's the whole point of the screen.
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
  // Clearing matchConclusion (and both players' own DoneSiding flags)
  // back to null/false (both clients do — safe, idempotent, same
  // reasoning as other multi-writer fields elsewhere in this file)
  // matters for a DIFFERENT reason: matchConclusion is otherwise never
  // cleared for defeatAdmitted/drawAccepted at all, so without this it
  // would still read as THIS duel's outcome (and isSidingPhase would
  // still read true) all the way through the next duel too.
  //
  // matchMainIds/matchExtraIds are passed straight through to
  // startNextDuel as this client's own sided Main/Extra Deck for the
  // upcoming duel — see useMultiplayerDuel's own startNextDuel for how
  // those overrides are used instead of re-reading the saved deck's
  // original Main/Extra Deck.
  const autoAdvancedForDuelNumberRef = useRef<number | null>(null);
  useEffect(() => {
    if (matchConclusion?.type !== 'defeatAdmitted' && matchConclusion?.type !== 'drawAccepted') return;
    if (matchOutcome) return;
    if (!duelId) return;
    if (!myDoneSiding || !opponentDoneSiding) return;
    if (autoAdvancedForDuelNumberRef.current === duelNumber) return;
    autoAdvancedForDuelNumberRef.current = duelNumber;
    resetLocalStateForNewDuel();
    startNextDuel(matchMainIds ?? undefined, matchExtraIds ?? undefined);
    setDoc(
      doc(db, 'duels', duelId),
      { matchConclusion: null, player1DoneSiding: false, player2DoneSiding: false },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to clear matchConclusion after starting next duel:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchConclusion, matchOutcome, duelId, duelNumber, myDoneSiding, opponentDoneSiding]);

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
    // Captured from inside the updater below for the Duel Log entry —
    // Normal Summon (source 'hand') gets its own simpler entry with no
    // "from" clause at all, while every other source here is a Special
    // Summon "from" one of this player's own piles (opponentGrave/
    // opponentBanished are handled by the SEPARATE pendingPileRequests
    // branch above, before this point, so they never reach here).
    let summonedCardName: string | undefined;
    let summonedZoneIndex: number | undefined;
    applyMeUpdate(
      (current) => {
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
        summonedCardName = instance.card.name;
        summonedZoneIndex = emptySlot;

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
      },
      {
        extraFields: () => {
          if (!summonedCardName || summonedZoneIndex === undefined) return undefined;
          const zone = zoneLabel(summonedZoneIndex);
          if (pending.source === 'hand') {
            return {
              duelLog: logDuelAction(
                `${myUsername} Normal Summoned ${summonedCardName} in ${position} position ${zone}`,
              ),
            };
          }
          const fromLocation =
            pending.source === 'main'
              ? 'the Main Deck'
              : pending.source === 'extra'
                ? 'the Extra Deck'
                : pending.source === 'grave'
                  ? 'the Grave'
                  : 'the Banished Zone';
          return {
            duelLog: logDuelAction(
              `${myUsername} Special Summoned ${summonedCardName} from ${fromLocation} in ${position} position ${zone}`,
            ),
          };
        },
      },
    );
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

    // Captured for the Duel Log entry — one "[material] in zone [x]" per
    // selected material, in selection order, before any of them are
    // actually removed from their zones below.
    const materialDescriptions = selectedIndices
      .map((idx) => {
        const material = me?.monsterZones[idx];
        return material ? `${material.card.name} in ${zoneName(idx)}` : null;
      })
      .filter((d): d is string => d !== null);
    let summonedZoneIndex: number | undefined;

    applyMeUpdate(
      (current) => {
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
        summonedZoneIndex = emptySlot;

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
      },
      {
        extraFields: () =>
          summonedZoneIndex === undefined
            ? undefined
            : {
                duelLog: logDuelAction(
                  `${myUsername} Fusion Summoned ${extraDeckInstance.card.name} using ${materialDescriptions.join(', ')} ${zoneLabel(summonedZoneIndex)}`,
                ),
              },
      },
    );
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

    let materialCardName: string | undefined;
    applyMeUpdate(
      (current) => {
        const material = current.monsterZones[index];
        if (!material) return current;
        materialCardName = material.card.name;
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
      },
      {
        extraFields: () =>
          materialCardName
            ? {
                duelLog: logDuelAction(
                  `${myUsername} Evolution Summoned ${extraDeckInstance.card.name} using ${materialCardName} in ${zoneName(index)} ${zoneLabel(index)}`,
                ),
              }
            : undefined,
      },
    );
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

    let zoneMaterialNames: string[] = [];
    let handMaterialNames: string[] = [];
    let summonedZoneIndex: number | undefined;

    applyMeUpdate(
      (current) => {
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
        zoneMaterialNames = [];
        for (const idx of selectedZoneIndices) {
          const material = current.monsterZones[idx];
          if (!material) continue;
          zoneMaterialNames.push(material.card.name);
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
        handMaterialNames = handMaterials.map((m) => m.card.name);
        graveAdditions.push(...handMaterials);

        const nextZones = [...current.monsterZones];
        for (const idx of selectedZoneIndices) nextZones[idx] = null;
        nextZones[emptySlot] = {
          instanceId: extraDeckInstance.instanceId,
          card: extraDeckInstance.card,
          faceDown: false,
          position,
        };
        summonedZoneIndex = emptySlot;

        return {
          ...current,
          monsterZones: nextZones,
          hand: nextHand,
          grave: [...current.grave, ...graveAdditions],
          extraDeck: current.extraDeck.filter((i) => i.instanceId !== extraDeckInstance.instanceId),
        };
      },
      {
        extraFields: () => {
          if (summonedZoneIndex === undefined) return undefined;
          // Spec format: "using [material(s)] from [location 1] and
          // [material(s)] from [location 2]" — but either group can be
          // empty (a Ritual Summon can draw entirely from the field or
          // entirely from hand), so each group's "from ..." clause is
          // only included when that group actually has materials, and
          // they're joined with "and" only when BOTH groups are present.
          const groups: string[] = [];
          if (zoneMaterialNames.length > 0) {
            groups.push(`${zoneMaterialNames.join(', ')} from the field`);
          }
          if (handMaterialNames.length > 0) {
            groups.push(`${handMaterialNames.join(', ')} from hand`);
          }
          return {
            duelLog: logDuelAction(
              `${myUsername} Ritual Summoned ${extraDeckInstance.card.name} using ${groups.join(' and ')} ${zoneLabel(summonedZoneIndex)}`,
            ),
          };
        },
      },
    );
  };

  // --- Stat adjustment ---

  const handleStatsAdjust = (index: number) => setPendingStatAdjustIndex(index);

  const handleStatAdjustCancel = () => setPendingStatAdjustIndex(null);

  const handleStatAdjustConfirm = (atk: number, def: number) => {
    const index = pendingStatAdjustIndex;
    setPendingStatAdjustIndex(null);
    if (index === null) return;
    // StatAdjustDialog always submits both fields together (see its own
    // onConfirm), even when the person only meant to change one — so
    // each stat is compared against its own previous value (the
    // existing override, or the card's base stat when never overridden)
    // and only the one(s) that actually changed get their own Duel Log
    // line, matching the spec's singular "[ATK/DEF]" phrasing per entry.
    let statChangeEntries: { stat: 'ATK' | 'DEF'; from: number; to: number }[] = [];
    let statChangedCardName: string | undefined;
    applyMeUpdate(
      (current) => {
        const slot = current.monsterZones[index];
        if (!slot) return current;
        statChangedCardName = slot.card.name;
        const parsedBaseAtk = Number(slot.card.atk);
        const parsedBaseDef = Number(slot.card.def);
        const baseAtk = Number.isNaN(parsedBaseAtk) ? 0 : parsedBaseAtk;
        const baseDef = Number.isNaN(parsedBaseDef) ? 0 : parsedBaseDef;
        const previousAtk = slot.atkOverride ?? baseAtk;
        const previousDef = slot.defOverride ?? baseDef;
        statChangeEntries = [];
        if (atk !== previousAtk) statChangeEntries.push({ stat: 'ATK', from: previousAtk, to: atk });
        if (def !== previousDef) statChangeEntries.push({ stat: 'DEF', from: previousDef, to: def });
        const nextZones = [...current.monsterZones];
        nextZones[index] = { ...slot, atkOverride: atk, defOverride: def };
        return { ...current, monsterZones: nextZones };
      },
      {
        extraFields: () =>
          statChangedCardName && statChangeEntries.length > 0
            ? {
                duelLog: arrayUnion(
                  ...statChangeEntries.map((change) =>
                    buildDuelLogEntry(
                      state.role ?? 'system',
                      `${myUsername} changed ${statChangedCardName}'s ${zoneLabel(index)} ${change.stat} from ${change.from} to ${change.to}`,
                      duelStartedAt,
                    ),
                  ),
                ),
              }
            : undefined,
      },
    );
  };

  // Resets to base AND closes the dialog, in one step — no separate
  // confirmation, matching how Cancel also closes immediately rather
  // than asking "are you sure."
  const handleStatAdjustReset = () => {
    const index = pendingStatAdjustIndex;
    setPendingStatAdjustIndex(null);
    if (index === null) return;
    let resetCardName: string | undefined;
    let hadOverride = false;
    applyMeUpdate(
      (current) => {
        const slot = current.monsterZones[index];
        if (!slot) return current;
        resetCardName = slot.card.name;
        // Only worth a Duel Log entry when there was actually something
        // to reset — Reset can be clicked with neither stat overridden
        // (nothing changed at all), which shouldn't post a misleading
        // "reset to default" line.
        hadOverride = slot.atkOverride != null || slot.defOverride != null;
        const nextZones = [...current.monsterZones];
        nextZones[index] = { ...slot, atkOverride: null, defOverride: null };
        return { ...current, monsterZones: nextZones };
      },
      {
        extraFields: () =>
          resetCardName && hadOverride
            ? {
                duelLog: logDuelAction(
                  `${myUsername} reset ${resetCardName}'s ${zoneLabel(index)} stats to default`,
                ),
              }
            : undefined,
      },
    );
  };

  // Shared by Activate and Set — both place a card into the first
  // available Spell/Trap Zone, differing only in faceDown.
  const placeInSpellTrapZone = (instanceId: string, faceDown: boolean) => {
    let placedCardName: string | undefined;
    let placedZoneIndex: number | undefined;
    applyMeUpdate(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        const emptySlot = findEmptyZoneSlot(current.spellTrapZones);
        if (!instance || emptySlot === -1) return current;
        placedCardName = instance.card.name;
        placedZoneIndex = emptySlot;
        const nextZones = [...current.spellTrapZones];
        nextZones[emptySlot] = { instanceId: instance.instanceId, card: instance.card, faceDown };
        return {
          ...current,
          hand: current.hand.filter((i) => i.instanceId !== instanceId),
          spellTrapZones: nextZones,
        };
      },
      {
        extraFields: () => {
          if (placedZoneIndex === undefined) return undefined;
          return {
            duelLog: logDuelAction(
              faceDown
                ? `${myUsername} Set a card to S/T zone ${zoneLabel(placedZoneIndex)}`
                : `${myUsername} activated ${placedCardName} ${zoneLabel(placedZoneIndex)}`,
            ),
          };
        },
      },
    );
  };

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
    const attackerCardName = me?.monsterZones[fromIndex]?.card.name;
    const targetCardName = opponent?.monsterZones[targetIndex]?.card.name;
    applyMeUpdate(
      (current) => ({
        ...current,
        activeAttack: { id: crypto.randomUUID(), fromIndex, toIndex: targetIndex },
      }),
      {
        extraFields:
          attackerCardName && targetCardName
            ? {
                duelLog: logDuelAction(
                  `${myUsername} attacked opponent's ${targetCardName} ${zoneLabel(targetIndex)} with ${attackerCardName} ${zoneLabel(fromIndex)}`,
                ),
              }
            : undefined,
      },
    );
  };

  const handleAttackCancel = () => setPendingAttack(null);

  const handleHandToGrave = (instanceId: string) => {
    let movedCardName: string | undefined;
    return applyMeUpdate(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        if (!instance) return current;
        movedCardName = instance.card.name;
        return {
          ...current,
          hand: current.hand.filter((i) => i.instanceId !== instanceId),
          grave: [...current.grave, instance],
        };
      },
      {
        extraFields: () =>
          movedCardName
            ? { duelLog: logDuelAction(`${myUsername} moved ${movedCardName} from hand to Grave`) }
            : undefined,
      },
    );
  };

  const handleHandBanish = (instanceId: string) => {
    let movedCardName: string | undefined;
    return applyMeUpdate(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        if (!instance) return current;
        movedCardName = instance.card.name;
        return {
          ...current,
          hand: current.hand.filter((i) => i.instanceId !== instanceId),
          banished: [...current.banished, instance],
        };
      },
      {
        extraFields: () =>
          movedCardName
            ? { duelLog: logDuelAction(`${myUsername} moved ${movedCardName} from hand to Banished Zone`) }
            : undefined,
      },
    );
  };

  const handleHandStackTop = (instanceId: string) => {
    let movedCardName: string | undefined;
    return applyMeUpdate(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        if (!instance) return current;
        movedCardName = instance.card.name;
        return {
          ...current,
          hand: current.hand.filter((i) => i.instanceId !== instanceId),
          mainDeck: [instance, ...current.mainDeck],
          lastMainDeckReturnSide: 'top',
        };
      },
      {
        extraFields: () =>
          movedCardName
            ? {
                duelLog: logDuelAction(
                  `${myUsername} moved ${movedCardName} from hand to the top of the Main Deck`,
                ),
              }
            : undefined,
      },
    );
  };

  const handleHandStackBottom = (instanceId: string) => {
    let movedCardName: string | undefined;
    return applyMeUpdate(
      (current) => {
        const instance = current.hand.find((i) => i.instanceId === instanceId);
        if (!instance) return current;
        movedCardName = instance.card.name;
        return {
          ...current,
          hand: current.hand.filter((i) => i.instanceId !== instanceId),
          mainDeck: [...current.mainDeck, instance],
          lastMainDeckReturnSide: 'bottom',
        };
      },
      {
        extraFields: () =>
          movedCardName
            ? {
                duelLog: logDuelAction(
                  `${myUsername} moved ${movedCardName} from hand to the bottom of the Main Deck`,
                ),
              }
            : undefined,
      },
    );
  };

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
    // Read from the current `me` snapshot, outside the updater — the
    // reveal-zone move itself is fully generic (moveCardViaRevealZone is
    // shared with several Grave/Banished pile actions that already log
    // their own "moved" entries elsewhere), so the card name is grabbed
    // here rather than threading a Duel Log write through that shared
    // helper.
    const revealedCardName = me?.hand.find((i) => i.instanceId === instanceId)?.card.name;
    if (revealedCardName && duelId) {
      setDoc(
        doc(db, 'duels', duelId),
        { duelLog: logDuelAction(`${myUsername} revealed ${revealedCardName} in hand`) },
        { merge: true },
      ).catch((err) => {
        console.error('[MultiplayerDuelFieldPage] Failed to log hand reveal:', err);
      });
    }
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

  // --- Declare (card effect activation announcements) ---
  // Posts "[Player] activated the effect of [card name]" as if the
  // player had typed it themselves — role: state.role, NOT 'system' —
  // so it renders through renderChatMessage's ordinary "mine" styling
  // exactly like a real typed message. See handleSendChatMessage above
  // for the identical write shape this mirrors.
  // `location` (added alongside the Duel Log feature) is only used for
  // the Duel Log's own "declared effect of [card] in [location]" line —
  // the chat announcement's own wording stays exactly as it already was,
  // since that's a separate, already-shipped feature this isn't meant to
  // reword.
  const sendDeclareMessage = (cardName: string, location: string) => {
    if (!duelId || !state.role) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: state.role,
      text: `${currentUser?.displayName ?? 'A player'} activated the effect of ${cardName}`,
      sentAt: Date.now(),
    };
    setDoc(
      doc(db, 'duels', duelId),
      {
        chatMessages: arrayUnion(message),
        duelLog: logDuelAction(`${myUsername} declared effect of ${cardName} in ${location}`),
      },
      { merge: true },
    ).catch((err) => {
      console.error('[MultiplayerDuelFieldPage] Failed to send declare message:', err);
    });
  };

  // Which Grave/Banished pile card (if any) is currently being declared
  // — purely a local, client-side display concern (like hoveredInstanceId
  // elsewhere), not synced through Firestore: it just tells DuelField's
  // pile rendering below to temporarily treat this one instanceId as the
  // top of its pile, reverting after DECLARE_PILE_HOLD_MS. See
  // handleGraveCardAction/handleBanishedCardAction's own 'declare' case.
  const [declaredPileCard, setDeclaredPileCard] = useState<{
    pile: 'grave' | 'banished';
    instanceId: string;
  } | null>(null);
  const DECLARE_PILE_HOLD_MS = 1000;

  // The hand's own "Declare" action — announces the effect, then sends
  // the card through the reveal zone and back exactly like Reveal (same
  // 2-second hold), per the user's own "in the same way that happens for
  // the 'Reveal' option" instruction.
  const handleHandDeclare = (instanceId: string) => {
    const instance = (latestMeRef.current ?? me)?.hand.find((i) => i.instanceId === instanceId);
    if (instance) sendDeclareMessage(instance.card.name, 'hand');
    moveCardViaRevealZone(
      (current) => {
        const inst = current.hand.find((i) => i.instanceId === instanceId);
        if (!inst) return null;
        return {
          instance: inst,
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
        const attackerCardName = me?.monsterZones[index]?.card.name;
        applyMeUpdate(
          (current) => ({
            ...current,
            activeAttack: { id: crypto.randomUUID(), fromIndex: index, toIndex: null },
          }),
          {
            extraFields: attackerCardName
              ? {
                  duelLog: logDuelAction(
                    `${myUsername} attacked directly with ${attackerCardName} ${zoneLabel(index)}`,
                  ),
                }
              : undefined,
          },
        );
      } else {
        setPendingAttack({ index });
      }
      return;
    }

    if (actionKey === 'view') {
      if (zoneType === 'monster') setViewingOwnStackIndex(index);
      return;
    }

    if (actionKey === 'declare') {
      // Only ever offered face-up (see getPlacedCardActions), so
      // clickedPlaced's card is always public knowledge already.
      if (clickedPlaced) sendDeclareMessage(clickedPlaced.card.name, zoneName(index));
      return;
    }

    if (actionKey === 'activate' || actionKey === 'set') {
      const faceDown = actionKey === 'set';
      // 'activate' is only ever offered on a FACE-DOWN card (see
      // getPlacedCardActions), so this is specifically activating a
      // previously-Set Spell/Trap — the Duel Log's own "activated set
      // [name]" line. 'set' (flipping an already-placed face-up
      // Spell/Trap back face-down) isn't one of the requested Duel Log
      // entries, so that direction stays unlogged.
      const activatedSetCardName =
        actionKey === 'activate' && zoneType === 'spellTrap' ? clickedPlaced?.card.name : undefined;
      applyMeUpdate(
        (current) => {
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
        },
        activatedSetCardName
          ? {
              extraFields: {
                duelLog: logDuelAction(
                  `${myUsername} activated set ${activatedSetCardName} ${zoneLabel(index)}`,
                ),
              },
            }
          : {},
      );
      return;
    }

    if (actionKey === 'toDefense' || actionKey === 'toAttack') {
      if (zoneType !== 'monster') return;
      const newPosition = actionKey === 'toDefense' ? 'defense' : 'attack';
      let switchedCardName: string | undefined;
      let previousPosition: 'attack' | 'defense' | undefined;
      applyMeUpdate(
        (current) => {
          const slot = current.monsterZones[index];
          if (!slot) return current;
          switchedCardName = slot.card.name;
          previousPosition = slot.position ?? 'attack';
          const next = [...current.monsterZones];
          next[index] = { ...slot, position: newPosition };
          return { ...current, monsterZones: next };
        },
        {
          extraFields: () =>
            switchedCardName && previousPosition
              ? {
                  duelLog: logDuelAction(
                    `${myUsername} switched ${switchedCardName} ${zoneLabel(index)} from ${previousPosition} to ${newPosition}`,
                  ),
                }
              : undefined,
        },
      );
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

    // The "moved [card] from [previous location] to [new location]" Duel
    // Log line for this generic "send a placed card off the field to a
    // pile" action — captured before the updater below runs (it reads
    // clickedPlaced/zoneType/index from the outer closure, none of which
    // this actually needs to wait on).
    const moveFromLocation =
      zoneType === 'monster' ? zoneName(index) : zoneType === 'spellTrap' ? zoneName(index) : 'Field Zone';
    const moveToLocation =
      actionKey === 'toHand'
        ? 'hand'
        : actionKey === 'toExtra'
          ? 'Extra Deck'
          : actionKey === 'toGrave'
            ? 'Grave'
            : actionKey === 'banish'
              ? 'Banished Zone'
              : actionKey === 'stackTop'
                ? 'the top of the Main Deck'
                : 'the bottom of the Main Deck';
    const movedCardName = clickedPlaced?.card.name;

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
        const duelLogField = movedCardName
          ? { duelLog: logDuelAction(`${myUsername} moved ${movedCardName} from ${moveFromLocation} to ${moveToLocation}`) }
          : {};
        if (returnItems.length === 0 || !returnToRole) return duelLogField;
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
          ...duelLogField,
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
    let movedCardName: string | undefined;
    applyMeUpdate(
      (current) => {
        const originZones = originZoneType === 'monster' ? current.monsterZones : current.spellTrapZones;
        const destZones = destZoneType === 'monster' ? current.monsterZones : current.spellTrapZones;
        const card = originZones[originIndex];
        // Guards against the origin having emptied out from under this
        // (e.g. sent to Grave by some other means) or the destination
        // having filled up since it was clicked — neither should happen
        // given the menu/click gating in DuelField.tsx, but this is the
        // authoritative check that actually matters.
        if (!card || destZones[destIndex]) return current;
        movedCardName = card.card.name;

        const nextMonsterZones = [...current.monsterZones];
        const nextSpellTrapZones = [...current.spellTrapZones];
        if (originZoneType === 'monster') nextMonsterZones[originIndex] = null;
        else nextSpellTrapZones[originIndex] = null;
        if (destZoneType === 'monster') nextMonsterZones[destIndex] = card;
        else nextSpellTrapZones[destIndex] = card;

        return { ...current, monsterZones: nextMonsterZones, spellTrapZones: nextSpellTrapZones };
      },
      {
        extraFields: () =>
          movedCardName
            ? {
                duelLog: logDuelAction(
                  `${myUsername} moved ${movedCardName} from ${zoneName(originIndex)} to ${zoneName(destIndex)}`,
                ),
              }
            : undefined,
      },
    );
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
          duelLog: logDuelAction(
            `${myUsername} moved ${card.card.name} from ${zoneName(originIndex)} to opponent's ${zoneName(destIndex)}`,
          ),
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
    applyMeUpdate(
      (current) => ({
        ...current,
        mainDeck: shuffle(current.mainDeck),
        mainDeckShuffleVersion: current.mainDeckShuffleVersion + 1,
      }),
      { extraFields: { duelLog: logDuelAction(`${myUsername} shuffled their deck`) } },
    );

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

    // Declare is appended below regardless of card class — announcing an
    // effect activation makes sense for any card already in the Grave.
    const DECLARE = { key: 'declare', label: 'Declare' };

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
        DECLARE,
      ];
    }
    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
        DECLARE,
      ];
    }
    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
        DECLARE,
      ];
    }
    return [];
  };

  const handleGraveCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.grave.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'declare') {
      sendDeclareMessage(instance.card.name, 'Grave');
      setDeclaredPileCard({ pile: 'grave', instanceId });
      window.setTimeout(() => {
        setDeclaredPileCard((current) =>
          current?.pile === 'grave' && current.instanceId === instanceId ? null : current,
        );
      }, DECLARE_PILE_HOLD_MS);
      return;
    }

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

    // Same reasoning as getGraveCardActions' own DECLARE.
    const DECLARE = { key: 'declare', label: 'Declare' };

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
        DECLARE,
      ];
    }
    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
        DECLARE,
      ];
    }
    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
        DECLARE,
      ];
    }
    return [];
  };

  const handleBanishedCardAction = (instanceId: string, actionKey: string) => {
    if (!me) return;
    const instance = me.banished.find((i) => i.instanceId === instanceId);
    if (instance && actionKey === 'declare') {
      sendDeclareMessage(instance.card.name, 'Banished Zone');
      setDeclaredPileCard({ pile: 'banished', instanceId });
      window.setTimeout(() => {
        setDeclaredPileCard((current) =>
          current?.pile === 'banished' && current.instanceId === instanceId ? null : current,
        );
      }, DECLARE_PILE_HOLD_MS);
      return;
    }
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
    // Special Summons requested from one of THIS client's own piles are
    // logged here (the one place that actually knows the card's name and
    // its destination zone) rather than back at the requester's own
    // completeSummon — but attributed to the REQUESTER (opponentRole
    // here, from this executing client's own point of view), not to
    // this client itself, since it's the requester's own action being
    // recorded, not this client's.
    const specialSummonLogEntries: DuelLogEntry[] = [];
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
      specialSummonLogEntries.push(
        buildDuelLogEntry(
          opponentRole,
          `${opponent?.username ?? 'Opponent'} Special Summoned ${instance.card.name} from their opponent's ${
            request.pile === 'grave' ? 'Grave' : 'Banished Zone'
          } in ${transfer.card.position} position ${zoneLabel(destIndex)}`,
          duelStartedAt,
        ),
      );
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
          ...(specialSummonLogEntries.length > 0
            ? { duelLog: arrayUnion(...specialSummonLogEntries) }
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

  // Shown in place of the normal duel field between duels, whenever the
  // duel that just ended didn't decide the whole match — see
  // isSidingPhase's own declaration above. mainDeckCards/extraDeckCards/
  // sideDeckCards resolve matchMainIds/matchExtraIds/matchSideIds
  // (plain card ids) into real CardData via cardById, the same way
  // DeckBuilderPage resolves a saved deck's own id lists.
  if (isSidingPhase) {
    const mainDeckCards = (matchMainIds ?? [])
      .map((id) => cardById.get(id))
      .filter((card): card is CardData => !!card);
    const extraDeckCards = (matchExtraIds ?? [])
      .map((id) => cardById.get(id))
      .filter((card): card is CardData => !!card);
    const sideDeckCards = (matchSideIds ?? [])
      .map((id) => cardById.get(id))
      .filter((card): card is CardData => !!card);
    // Dims (and blocks clicking) whichever Side Deck cards aren't legal
    // for the currently active swap channel — see toggleSideSelection's
    // own comment for the actual enforcement; this is purely the visual
    // side of the same rule, so the player can see up front which cards
    // wouldn't do anything if clicked, rather than discovering it by
    // clicking them. Empty (nothing dimmed) while neither Main nor
    // Extra has a selection yet.
    const sideDeckIneligibleIndices: number[] = [];
    if (selectedExtraIndices.length > 0 || selectedMainIndices.length > 0) {
      sideDeckCards.forEach((card, i) => {
        const cardIsExtraEligible = isExtraDeckCard(card);
        if (selectedExtraIndices.length > 0 && !cardIsExtraEligible) {
          sideDeckIneligibleIndices.push(i);
        } else if (selectedMainIndices.length > 0 && cardIsExtraEligible) {
          sideDeckIneligibleIndices.push(i);
        }
      });
    }
    return (
      <div className="MultiplayerDuelFieldPage MultiplayerDuelFieldPage--siding">
        <div className="MultiplayerDuelFieldPage-sidePanel">
          <CardDisplay card={hoveredCard} />
          {/* Exit/Swap Cards/Reset Deck/Done Siding — all grouped together
              in the same column as the Card Viewer, below it: Exit in its
              own row, then Swap Cards and Reset Deck in a row underneath,
              then Done Siding in its own row underneath that. This whole
              block only ever renders during this isSidingPhase return, so
              it only ever appears during Side Decking. */}
          <div className="SideDecking-sidePanelActions">
            <div className="MultiplayerDuelFieldPage-topActions">
              <button type="button" className="MultiplayerDuelFieldPage-exitButton" onClick={handleExitClick}>
                Exit
              </button>
              <button
                type="button"
                className="MultiplayerDuelFieldPage-duelLogButton"
                onClick={() => setShowDuelLog(true)}
              >
                Duel Log
              </button>
            </div>

            {/* The default instructional sentence ("Select an equal
                number of cards…") is left out here — it took up too much
                space and isn't necessary. The two dynamic status messages
                (shown once this player has clicked Done Siding) are still
                worth the room, so those still render. */}
            {myDoneSiding && (
              <p className="SideDecking-subtext">
                {opponentDoneSiding ? 'Starting the next duel…' : 'Waiting for your opponent to finish siding…'}
              </p>
            )}
            <div className="SideDecking-actions">
              <button
                type="button"
                className="SideDecking-actionButton"
                disabled={!canSwapSideDeckCards || myDoneSiding}
                onClick={handleSwapSideDeckCards}
              >
                Swap Cards
              </button>
              <button
                type="button"
                className="SideDecking-actionButton"
                disabled={myDoneSiding}
                onClick={handleResetSideDeck}
              >
                Reset Deck
              </button>
            </div>
            <button
              type="button"
              className="SideDecking-doneButton"
              disabled={myDoneSiding}
              onClick={handleDoneSidingClick}
            >
              {myDoneSiding ? 'Done Siding ✓' : 'Done Siding'}
            </button>
          </div>
        </div>

        {showExitConfirm && (
          <ConfirmDialog
            message="If you leave, you forfeit the match. Are you sure?"
            buttons={[
              { label: 'Yes', onClick: handleExitConfirm },
              { label: 'No', onClick: handleExitCancel },
            ]}
            onDismiss={handleExitCancel}
          />
        )}

        {showDuelLog &&
          renderDuelLogOverlay(duelLog, state.role, () => setShowDuelLog(false), duelLogHistoryRef)}

        {/* The opponent having left/forfeited can happen even while this
            client is still on the Side Decking screen — isSidingPhase
            itself already turns false the instant matchOutcome is set
            (see that const's own declaration), so ordinarily this
            branch would never render at the same time as a resolved
            matchOutcome. The one moment it still can is the render
            where duelDoc has JUST updated with both matchOutcome and
            forfeitedBy at once — belt-and-braces here rather than
            relying on a guaranteed-single-field-at-a-time update. */}
        {matchOutcome && matchOutcomeKey !== dismissedMatchOutcomeKey && (
          <ConfirmDialog
            message={
              disconnectedBy && disconnectedBy !== state.role
                ? 'Your opponent has disconnected. You win the match!'
                : forfeitedBy && forfeitedBy !== state.role
                  ? 'Your opponent has left the duel. You win the match!'
                  : matchOutcome.type === 'matchDraw'
                    ? 'The match has ended in a draw.'
                    : matchOutcome.type === (state.role === 'player1' ? 'player1WinsMatch' : 'player2WinsMatch')
                      ? 'You win the match!'
                      : 'Your opponent has won the match.'
            }
            buttons={[{ label: 'OK', onClick: () => setDismissedMatchOutcomeKey(matchOutcomeKey) }]}
          />
        )}

        <SideDecking
          mainDeck={mainDeckCards}
          extraDeck={extraDeckCards}
          sideDeck={sideDeckCards}
          selectedMainIndices={selectedMainIndices}
          selectedExtraIndices={selectedExtraIndices}
          selectedSideIndices={selectedSideIndices}
          sideDeckIneligibleIndices={sideDeckIneligibleIndices}
          onToggleMainCard={toggleMainSelection}
          onToggleExtraCard={toggleExtraSelection}
          onToggleSideCard={toggleSideSelection}
          isDone={myDoneSiding}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />

        {/* Both HUDs (avatar, LP display, username, chat, expressions) —
            identical markup to the normal duel field's own further down,
            duplicated here rather than shared because this whole return
            replaces the normal field's markup entirely for as long as
            isSidingPhase is true, the same "duplicated, not shared"
            reasoning as the Exit button and its own confirmation dialogs
            above. Requested so players can keep chatting (and see life
            points/avatars) between duels, not just during them — both
            .MultiplayerDuelFieldPage-opponentHud/-playerHud are
            position: absolute against this same
            .MultiplayerDuelFieldPage root (see that class's own CSS), so
            they overlay correctly here exactly as they do over the
            normal field, regardless of where in this return they're
            written. `me` is used directly here rather than `renderMe`
            (that alias isn't computed until after this early return) —
            fine since nothing during Side Decking triggers the
            optimistic card-move animation renderMe exists to smooth
            over. */}
        <div className="MultiplayerDuelFieldPage-opponentHud">
          <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--opponent">
            <div className="MultiplayerDuelFieldPage-hudInfo">
              <div className="LifePointCounter-display MultiplayerDuelFieldPage-opponentLpDisplay">
                {opponentDisplayLifePoints}
              </div>
              <span className="MultiplayerDuelFieldPage-hudUsername">{opponent.username}</span>
            </div>
            <div className="PlayerAvatarBox">
              <img src={getAvatarUrl(opponent.avatarId)} alt="" className="PlayerAvatarBox-image" />
              {renderExpressionOverlay(opponentExpression)}
              {renderViewingLocationOverlay(opponentViewingLocation)}
              {renderDisconnectCountdownOverlay(disconnectTimer, opponentRole)}
            </div>
          </div>
        </div>

        <div className="MultiplayerDuelFieldPage-playerHud">
          <div className="MultiplayerDuelFieldPage-chatHistory" ref={chatHistoryRef}>
            {[...chatMessages]
              .sort((a, b) => a.sentAt - b.sentAt)
              .map((message) => renderChatMessage(message, state.role, myAvatarId, opponent.avatarId))}
          </div>
          <div className="MultiplayerDuelFieldPage-chatInputRow">
            <input
              type="text"
              className="MultiplayerDuelFieldPage-chatInput"
              placeholder="Type a message…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatInputKeyDown}
            />
            <button
              type="button"
              className="MultiplayerDuelFieldPage-expressionButton"
              onClick={() => handleSendExpression('thumbsUp')}
            >
              <img src={thumbsUpIcon} alt="Thumbs up" />
            </button>
            <button
              type="button"
              className="MultiplayerDuelFieldPage-expressionButton"
              onClick={() => handleSendExpression('thinking')}
            >
              <img src={thinkingIcon} alt="Thinking" />
            </button>
          </div>
          <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--player">
            <div className="MultiplayerDuelFieldPage-hudInfo">
              <span className="MultiplayerDuelFieldPage-hudUsername">
                {currentUser?.displayName}
              </span>
              <div className="MultiplayerDuelFieldPage-lpRow">
                <LifePointCounter
                  value={me.lifePoints}
                  onAdd={(amount) => handleLifePointChange(amount)}
                  onSubtract={(amount) => handleLifePointChange(-amount)}
                />
              </div>
            </div>
            <PlayerAvatarBox
              overlay={
                <>
                  {renderExpressionOverlay(myExpression)}
                  {renderViewingLocationOverlay(myViewingLocation)}
                  {renderDisconnectCountdownOverlay(disconnectTimer, state.role ?? null)}
                </>
              }
            />
          </div>
        </div>
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

  // Display-only reordering for the Grave/Banished "Declare" animation —
  // moves the declared card to the END of the array passed to DuelField,
  // which is what that component always renders as the TOP of the pile
  // (see its own `pile[pile.length - 1]` topCard logic) — for
  // DECLARE_PILE_HOLD_MS, then reverts. The real grave/banished arrays
  // (and their actual stored order) are never touched; this only affects
  // what gets rendered.
  //
  // Deliberately plain consts, NOT useMemo — this whole block sits after
  // the `if (loading || !me || !opponent) return ...` early return above,
  // so any hook called here would only run on SOME renders (never on the
  // very first, still-loading one) and never on others, violating the
  // Rules of Hooks (hook call count/order must be identical on every
  // render) and crashing the page entirely with a "Rendered more hooks
  // than during the previous render" error the instant real duel data
  // arrived. These piles are never more than a few dozen cards, so
  // recomputing on every render (instead of memoizing) costs nothing
  // worth guarding against.
  const declareReorderedPile = (pile: CardInstance[], kind: 'grave' | 'banished'): CardInstance[] => {
    if (!declaredPileCard || declaredPileCard.pile !== kind) return pile;
    const idx = pile.findIndex((c) => c.instanceId === declaredPileCard.instanceId);
    if (idx === -1) return pile;
    return [...pile.slice(0, idx), ...pile.slice(idx + 1), pile[idx]];
  };
  const displayGrave = declareReorderedPile(renderMe.grave, 'grave');
  const displayBanished = declareReorderedPile(renderMe.banished, 'banished');

  // Whichever roll (mine or the opponent's) is currently active — shown
  // once, centered in the shared reveal zone below, identically to both
  // players, rather than the old per-side split (own button showed the
  // animation / opponent saw a small badge next to their avatar). If
  // both happen to be active at the same time (nothing stops both
  // players rolling within the same few hundred ms of each other), the
  // more recently started one wins, simply so there's only ever one die
  // on screen at once rather than two overlapping.
  // Same idea, now generalized across FOUR possible sources instead of
  // two (mine/opponent's die roll, mine/opponent's coin flip) — the coin
  // flip added below shares this exact same reveal-zone slot with the
  // die roll (per the user's own request), so at most one of the two
  // kinds can ever be showing at once; whichever of the (up to 4) active
  // events started most recently wins, same "only one thing on screen
  // at once" reasoning as before.
  type ActiveRandomEvent =
    | { kind: 'die'; data: DieRollData }
    | { kind: 'coin'; data: CoinFlipData };
  const randomEventCandidates: ActiveRandomEvent[] = [
    ...(myDieRoll ? [{ kind: 'die' as const, data: myDieRoll }] : []),
    ...(opponentDieRoll ? [{ kind: 'die' as const, data: opponentDieRoll }] : []),
    ...(myCoinFlip ? [{ kind: 'coin' as const, data: myCoinFlip }] : []),
    ...(opponentCoinFlip ? [{ kind: 'coin' as const, data: opponentCoinFlip }] : []),
  ];
  const activeRandomEvent = randomEventCandidates.reduce<ActiveRandomEvent | null>(
    (latest, candidate) =>
      !latest || candidate.data.startedAt >= latest.data.startedAt ? candidate : latest,
    null,
  );
  const randomEventSlot = activeRandomEvent ? getRevealZoneSlot() : null;

  // The opponent's hand now has real geometry (getOpponentHandSlot, in
  // cardGeometry.ts) and renders through CardLayer like every other
  // card — no filtering needed anymore. It used to be excluded here and
  // rendered via a separate, static block below instead, back when its
  // coordinates were only placeholders — which is also why the
  // hand-shuffle animation had no visible effect on the opponent's
  // side: CardLayer's own animated elements existed but weren't the
  // actual visible cards.
  // computeCardPositions is what actually draws each card's own
  // position/zIndex (via CardLayer) — DuelField's own playerGrave/
  // playerBanished props (above) only feed its zone label's top-card
  // image/count, which was NOT what needed reordering for the Declare
  // pile animation. The real per-card positions come from here, reading
  // grave/banished straight off whatever `me`-shaped object is passed
  // in — so the declared-card reorder has to be applied to THIS input
  // too, via a shallow copy, rather than only to the props DuelField
  // itself receives.
  const cardPositionEntries = computeCardPositions(
    { ...renderMe, grave: displayGrave, banished: displayBanished },
    opponent,
  );

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

        {/* Exit / Admit Defeat / Offer Draw — grouped together in the same
            column as the Card Viewer, directly below it: Exit in its own
            row, then Admit Defeat and Offer Draw in a row underneath. The
            best-of-three duel counter/win tally renders as a further row
            below that, so it doesn't visually collide with these buttons
            now that everything shares this one column. */}
        <div className="MultiplayerDuelFieldPage-sidePanelActions">
          <div className="MultiplayerDuelFieldPage-topActions">
            <button type="button" className="MultiplayerDuelFieldPage-exitButton" onClick={handleExitClick}>
              Exit
            </button>
            <button
              type="button"
              className="MultiplayerDuelFieldPage-duelLogButton"
              onClick={() => setShowDuelLog(true)}
            >
              Duel Log
            </button>
          </div>

          <div className="MultiplayerDuelFieldPage-matchActionsRow">
            <button
              type="button"
              className="MultiplayerDuelFieldPage-matchActionButton"
              disabled={isMatchOver}
              onClick={handleAdmitDefeatClick}
            >
              Forfeit
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
            <div>
              Duel {duelNumber} of 3
            </div>
            Wins: You{' '}
            {state.role === 'player1' ? matchWins.player1 : matchWins.player2} · Opponent{' '}
            {state.role === 'player1' ? matchWins.player2 : matchWins.player1}
          </div>
        </div>
      </div>

      {showExitConfirm && (
        <ConfirmDialog
          message="If you leave, you forfeit the match. Are you sure?"
          buttons={[
            { label: 'Yes', onClick: handleExitConfirm },
            { label: 'No', onClick: handleExitCancel },
          ]}
          onDismiss={handleExitCancel}
        />
      )}

      {showDuelLog &&
        renderDuelLogOverlay(duelLog, state.role, () => setShowDuelLog(false), duelLogHistoryRef)}

      {/* 2x2 grid: Die Roll/Coin Flip on top (moved here from the duel
          field itself — see DuelField.tsx's own deckRow comment), Reveal
          Hand/Shuffle Hand underneath, grouping every "player action, not
          a card action" button in one place. */}
      <div className="MultiplayerDuelFieldPage-handButtonRow">
        <DieRollButton roll={myDieRoll ?? null} onRoll={handleRollDie} />
        <CoinFlipButton flip={myCoinFlip ?? null} onFlip={handleFlipCoin} />
        <button
          type="button"
          className={
            handRevealed
              ? 'MultiplayerDuelFieldPage-revealHandButton MultiplayerDuelFieldPage-revealHandButton--active'
              : 'MultiplayerDuelFieldPage-revealHandButton'
          }
          onClick={handleToggleHandReveal}
          title={handRevealed ? 'Hide Hand' : 'Reveal Hand'}
        >
          <img
            src={revealHandIcon}
            alt={handRevealed ? 'Hide Hand' : 'Reveal Hand'}
            className="MultiplayerDuelFieldPage-handButtonIcon"
          />
        </button>
        <button
          type="button"
          className="MultiplayerDuelFieldPage-shuffleHandButton"
          onClick={handleShuffleHand}
          title="Shuffle Hand"
        >
          <img src={shuffleHandIcon} alt="Shuffle Hand" className="MultiplayerDuelFieldPage-handButtonIcon" />
        </button>
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
              playerGrave={displayGrave}
              playerBanished={displayBanished}
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
              onDeclare={handleHandDeclare}
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

            {/* The die roll / coin flip itself — centered in the same
                shared reveal zone the Hand's own "Reveal" action and the
                Declare feature use (see getRevealZoneSlot's own
                comment), positioned absolutely against this same
                boardStage rather than going through CardLayer's own
                cardPositionEntries pipeline (neither is a
                CardInstance/PlacedCard, so neither has anything to hand
                that pipeline). pointerEvents: 'none' since this is
                purely a display — the actual buttons live on the board
                itself (see DuelField's own deckRow). Rendered last
                (after CardLayer) so it's never covered by any card art
                beneath it. activeRandomEvent already picks at most ONE
                of the two kinds to show at a time (see its own
                comment), so this never needs to render both together. */}
            {activeRandomEvent && randomEventSlot && (
              <div
                className="MultiplayerDuelFieldPage-dieRollZone"
                style={{
                  position: 'absolute',
                  left: randomEventSlot.x,
                  top: randomEventSlot.y,
                  width: randomEventSlot.width,
                  height: randomEventSlot.height,
                  pointerEvents: 'none',
                }}
              >
                {activeRandomEvent.kind === 'die' ? (
                  <DieRollDisplay roll={activeRandomEvent.data} />
                ) : (
                  <CoinFlipDisplay flip={activeRandomEvent.data} />
                )}
              </div>
            )}
          </div>
        </div>

      </div>


      <div className="MultiplayerDuelFieldPage-opponentHud">
        {/* Avatar box on the right, spanning the full height of the
            username/LP counter stacked to its left — mirrored from the
            player's own hudRow below: the opponent's LP counter comes
            FIRST (top) and their username SECOND (bottom), the reverse
            of the player's own order, per the requested mockup. */}
        <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--opponent">
          <div className="MultiplayerDuelFieldPage-hudInfo">
            {/* Reuses LifePointCounter-display's own steady-state
                styling, reused directly. A plain, non-interactive div
                rather than LifePointCounter itself: a player can never
                edit their opponent's life points, only see them.
                opponentDisplayLifePoints (see useAnimatedCount) counts
                steadily toward the real value rather than jumping
                straight to it, the same as the player's own counter. */}
            <div className="LifePointCounter-display MultiplayerDuelFieldPage-opponentLpDisplay">
              {opponentDisplayLifePoints}
            </div>
            <span className="MultiplayerDuelFieldPage-hudUsername">{opponent.username}</span>
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
            {renderExpressionOverlay(opponentExpression)}
            {renderViewingLocationOverlay(opponentViewingLocation)}
            {renderDisconnectCountdownOverlay(disconnectTimer, opponentRole)}
          </div>
        </div>
      </div>

      <div className="MultiplayerDuelFieldPage-playerHud">
        {/* Chat — positioned in this same right-hand column, in between
            the two players' own usernames (this one, and the opponent's
            own further up in MultiplayerDuelFieldPage-opponentHud): the
            message history box sits directly above the input box, which
            sits directly above this player's own username, all as
            ordinary stacked children of this same bottom-anchored
            column — rather than each being independently positioned
            with its own computed offset, the column simply grows
            upward from its fixed bottom edge as these two are added
            above the content that was already here. */}
        <div className="MultiplayerDuelFieldPage-chatHistory" ref={chatHistoryRef}>
          {[...chatMessages]
            .sort((a, b) => a.sentAt - b.sentAt)
            .map((message) => renderChatMessage(message, state.role, myAvatarId, opponent.avatarId))}
        </div>
        {/* The chat input, plus the two expression buttons next to it —
            clicking either briefly overlays that image on top of this
            player's own avatar box (see PlayerAvatarBox's own overlay
            prop below), visible to both players (see
            renderExpressionOverlay's own comment for how the opponent's
            side of this works). */}
        <div className="MultiplayerDuelFieldPage-chatInputRow">
          <input
            type="text"
            className="MultiplayerDuelFieldPage-chatInput"
            placeholder="Type a message…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatInputKeyDown}
          />
          <button
            type="button"
            className="MultiplayerDuelFieldPage-expressionButton"
            onClick={() => handleSendExpression('thumbsUp')}
          >
            <img src={thumbsUpIcon} alt="Thumbs up" />
          </button>
          <button
            type="button"
            className="MultiplayerDuelFieldPage-expressionButton"
            onClick={() => handleSendExpression('thinking')}
          >
            <img src={thinkingIcon} alt="Thinking" />
          </button>
        </div>
        {/* Avatar box on the right, spanning the full height of the
            username/LP counter stacked to its left — username FIRST
            (top), LP counter SECOND (bottom), per the requested mockup
            (the opponent's own hudRow above uses the reverse order). */}
        <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--player">
          <div className="MultiplayerDuelFieldPage-hudInfo">
            {/* Same username styling as the opponent's own, just reused
                here too — currentUser.displayName is already
                established elsewhere in the app (e.g. AccountPage) as
                where a user's own username lives. */}
            <span className="MultiplayerDuelFieldPage-hudUsername">
              {currentUser?.displayName}
            </span>
            <div className="MultiplayerDuelFieldPage-lpRow">
              <LifePointCounter
                value={renderMe.lifePoints}
                onAdd={(amount) => handleLifePointChange(amount)}
                onSubtract={(amount) => handleLifePointChange(-amount)}
              />
            </div>
          </div>
          <PlayerAvatarBox
            isMyTurn={isMyTurn}
            overlay={
              <>
                {renderExpressionOverlay(myExpression)}
                {renderViewingLocationOverlay(myViewingLocation)}
                {renderDisconnectCountdownOverlay(disconnectTimer, state.role ?? null)}
              </>
            }
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

      {/* The whole MATCH's own final outcome — disconnectedBy/forfeitedBy
          each override the normal win/lose/draw wording with their own
          specific message when this client is the one who benefited from
          a disconnect timeout or a forfeit respectively (see
          handleExitConfirm's own comment on why forfeitedBy is a
          separate field from matchOutcome itself, and DuelDoc's own
          comment on disconnectedBy for why it's a distinct field from
          forfeitedBy rather than reusing it). */}
      {matchOutcome && matchOutcomeKey !== dismissedMatchOutcomeKey && (
          <ConfirmDialog
            message={
              disconnectedBy && disconnectedBy !== state.role
                ? 'Your opponent has disconnected. You win the match!'
                : forfeitedBy && forfeitedBy !== state.role
                  ? 'Your opponent has left the duel. You win the match!'
                  : matchOutcome.type === 'matchDraw'
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
                ? // Grave/Banished append their most recently added card
                  // to the END of the array (the LAST element is the top
                  // of the pile — see cardPositions.ts's own comment on
                  // this). Reversed here so the viewer grid's natural
                  // left-to-right/top-to-bottom order matches, top of
                  // pile shown first instead of last. Main/Extra Deck
                  // need no such reversal — they PREPEND instead, so
                  // index 0 is already their own top card.
                  [...renderMe.grave].reverse()
                : viewingOwnPile === 'banished'
                  ? [...renderMe.banished].reverse()
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
          // Click-to-select + its own chat announcement — only for
          // Grave/Banished (per the feature request), never Main/Extra
          // Deck, whose contents aren't public knowledge either player
          // should be pointing at by name.
          onCardClick={
            viewingOwnPile === 'grave'
              ? (instanceId) => {
                  const inst = renderMe.grave.find((c) => c.instanceId === instanceId);
                  if (inst) handleSelectPileCard(instanceId, inst.card.name, 'their Grave');
                }
              : viewingOwnPile === 'banished'
                ? (instanceId) => {
                    const inst = renderMe.banished.find((c) => c.instanceId === instanceId);
                    if (inst) handleSelectPileCard(instanceId, inst.card.name, 'their Banished Zone');
                  }
                : undefined
          }
          getSelectionColor={
            viewingOwnPile === 'grave' || viewingOwnPile === 'banished'
              ? getPileSelectionColor
              : undefined
          }
        />
      )}

      {viewingOpponentPile && (
        <DeckViewer
          cards={
            viewingOpponentPile === 'grave'
              ? [...opponent.grave].reverse()
              : [...opponent.banished].reverse()
          }
          onClose={() => setViewingOpponentPile(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          onCardClick={
            viewingOpponentPile === 'grave'
              ? (instanceId) => {
                  const inst = opponent.grave.find((c) => c.instanceId === instanceId);
                  if (inst) handleSelectPileCard(instanceId, inst.card.name, `${opponent.username}'s Grave`);
                }
              : (instanceId) => {
                  const inst = opponent.banished.find((c) => c.instanceId === instanceId);
                  if (inst) {
                    handleSelectPileCard(instanceId, inst.card.name, `${opponent.username}'s Banished Zone`);
                  }
                }
          }
          getSelectionColor={getPileSelectionColor}
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