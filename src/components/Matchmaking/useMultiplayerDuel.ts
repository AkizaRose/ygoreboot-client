import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { useUserAvatar } from '../Avatar/useUserAvatar';
import { useSavedDecks } from '../DeckManager/useSavedDecks';
import { shuffle } from '../../utils/shuffle';
import cardData from '../../data/carddata.json';
import type { CardData } from '../../types/Card';
import { type CardInstance, type PlacedCard, createCardInstance } from '../../types/CardInstance';

const OPENING_HAND_SIZE = 5;

export type PlayerRole = 'player1' | 'player2';

// Draw -> Main 1 -> Battle -> Main 2 -> End, in the order the Phase
// Tracker steps through them. "End Turn"/"Start Turn" (see
// MultiplayerDuelFieldPage's own applyTurnUpdate) is a separate,
// explicit turnEnding flag layered on top of 'end' rather than a sixth
// phase here — advancing past 'end' hands the turn off entirely, it
// doesn't move to a new named phase.
export const TURN_PHASES = ['draw', 'main1', 'battle', 'main2', 'end'] as const;
export type TurnPhase = (typeof TURN_PHASES)[number];

// A pure function of the duel + both players' UIDs — every client
// computes the exact same result independently, with nothing to
// coordinate and no write race between two clients both trying to flip
// the same coin. Not cryptographically meaningful, just needs to look
// evenly distributed across different duels.
function determineFirstPlayer(duelId: string, player1Uid: string, player2Uid: string): PlayerRole {
  const seed = `${duelId}:${player1Uid}:${player2Uid}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2 === 0 ? 'player1' : 'player2';
}

export interface OpponentInfo {
  uid: string;
  username: string;
  avatarId: string;
}

// The half of a player's state that's safe for the OPPONENT to read too —
// no hand contents, no deck order, just counts and whatever's genuinely
// visible on the field. Lives in the shared duels/{duelId} document.
//
// One known gap, not solved here: a face-down Spell/Trap's own card
// identity still lives inside its PlacedCard in this same public
// document — the UI won't show it to the opponent, but nothing stops
// reading the raw Firestore data directly. Properly closing that would
// need a server-side authority (e.g. Cloud Functions) filtering what
// each client can even fetch, which is a bigger step than this phase
// covers — worth knowing about, not something quietly papered over.
interface PublicPlayerState {
  lifePoints: number;
  phase: string;
  handCount: number;
  mainDeckCount: number;
  extraDeckCount: number;
  monsterZones: (PlacedCard | null)[];
  spellTrapZones: (PlacedCard | null)[];
  grave: CardInstance[];
  banished: CardInstance[];
  fieldZone: PlacedCard | null;
  // Which hand slot the most recent card to leave the hand was at,
  // right before it left — set centrally in MultiplayerDuelFieldPage's
  // own applyMeUpdate, for ANY action that removes a card from hand
  // (Summon, Activate, Set, discard, Banish, stacking back into a
  // deck), not something each individual handler has to remember to
  // set itself. This is the one piece of information about a specific
  // departure that's safe to share publicly without revealing anything
  // else about the hand's real contents or order — an index alone
  // reveals nothing about which card it was. null before any card has
  // ever left this hand.
  lastHandDepartureIndex: number | null;
  // Incremented every time this hand is shuffled (see
  // MultiplayerDuelFieldPage's own applyMeUpdate and handleShuffleHand)
  // — just a counter, not the shuffle result itself, so it reveals
  // nothing about hand contents or order. What lets the OPPONENT's
  // client know a shuffle just happened and play the animation for it,
  // the same idea as lastHandDepartureIndex above.
  handShuffleVersion: number;
}

// The half that must stay private — genuinely unreadable by the
// opponent (not just hidden in the UI), enforced by firestore.rules
// restricting duels/{duelId}/private/{uid} to that uid alone.
interface PrivatePlayerState {
  hand: CardInstance[];
  mainDeck: CardInstance[];
  extraDeck: CardInstance[];
}

interface DuelDoc {
  player1Uid: string;
  player1Username: string;
  player1AvatarId: string;
  player2Uid: string;
  player2Username: string;
  player2AvatarId: string;
  player1?: PublicPlayerState;
  player2?: PublicPlayerState;
  // Whose turn it currently is, and what phase of it — global, shared
  // state that belongs to neither player individually, so these live at
  // the top level of the document rather than nested under player1/
  // player2. turnEnding is true in the window between the turn player
  // clicking past End Phase and the OTHER player clicking "Start Turn"
  // to actually claim it — see MultiplayerDuelFieldPage's own
  // applyTurnUpdate/handleStartTurn for that handoff.
  turnPlayer?: PlayerRole;
  currentPhase?: TurnPhase;
  turnEnding?: boolean;
  turnNumber?: number;
  // Purely visual "I'm pointing at this card" indicator — see
  // MultiplayerDuelFieldPage's own handleSelectCard/clearSelections.
  // Each player has exactly one selection slot, set independently of
  // the other's (selecting never touches the opponent's own field
  // here) — a plain instanceId for a real field card, or
  // "hand:<owner>:<index>" for a card in someone's HAND specifically
  // (see encodeHandSelection below), since a hand card has no
  // cross-client instanceId the selecting player could reference at
  // all — only its owner and position are ever knowable to anyone else.
  player1Selection?: string | null;
  player2Selection?: string | null;
  // Every monster currently in transit to the OPPONENT's Monster Zone
  // (see MultiplayerDuelFieldPage's own handleMoveToOpponentTarget) — a
  // handoff, same idea as turnEnding/Start Turn above: a client can only
  // ever write its OWN public state slice, never the other player's
  // directly, so the moving player's own client removes the card from
  // their own monsterZones and appends an entry here instead (via
  // arrayUnion — see MultiplayerDuelFieldPage's own use of it); the
  // RECEIVING player's own client is what actually adds it to their own
  // monsterZones and removes this specific entry again (via
  // arrayRemove), via its own write.
  //
  // An ARRAY, not a single object — a plain setDoc/merge write to one
  // object field is NOT safe here: two transfers arriving close
  // together (the same player moving a second monster before the first
  // has been picked up, or both players moving a monster to each other
  // around the same time) would have the second overwrite the first
  // before the receiving client ever saw it, silently losing a card
  // that had already been removed from its sender's field — gone
  // entirely, on neither side. arrayUnion/arrayRemove are atomic,
  // read-free operations specifically for this: multiple concurrent
  // appends to the same array field are all preserved, never lost to
  // each other, unlike a plain merge write of the whole field.
  pendingControlTransfers: {
    toRole: PlayerRole;
    toIndex: number;
    card: PlacedCard;
  }[];
  // Same array-not-single-object reasoning as pendingControlTransfers
  // above, for the same reason — see that field's own comment. A card
  // (or several — see below) leaving the field entirely (Grave,
  // Banished, hand, either deck) whose true owner differs from whoever
  // currently controls it (see CardInstance's own `owner` field) — same
  // handoff idea, but for private zones (hand, Main/Extra Deck) as well
  // as public ones, and for destinations that are appended lists rather
  // than an indexed slot, hence the different shape. The controlling
  // player's own client removes the card(s) from their field as normal
  // but can't add them to their own hand/Grave/deck in this case (that
  // would hand true ownership to the wrong player) — it appends an
  // entry here instead. The OWNER's own client is what actually places
  // each one into its own destination and removes this entry again —
  // see MultiplayerDuelFieldPage's own handleFieldAction (the write
  // side) and the effect that completes it.
  //
  // `items` rather than a single card+destination per array entry: a
  // stack's buried Fusion materials can be individually owned by either
  // player (see CardInstance's own `owner` field), so one leave-zone
  // action can require returning several differently-owned cards at
  // once — the top card plus zero or more materials. All of them still
  // share the SAME toRole regardless, since with only two players,
  // every item needing this handoff at all necessarily belongs to the
  // one opponent — so one leave-zone action is still exactly one array
  // entry, just with potentially several items inside it, processed and
  // removed as a single atomic batch.
  pendingCardReturns: {
    toRole: PlayerRole;
    items: {
      destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
      card: CardInstance;
    }[];
  }[];
}

// A hand card (unlike a field card) has no instanceId the OTHER player
// could ever reference — its real identity is private. Encodes "this
// player's hand, this position" instead, which is the one thing about
// a hand card that's safe and meaningful to share; decodeHandSelection
// is the inverse, used when checking whether a given rendered hand
// proxy matches a stored selection.
export function encodeHandSelection(owner: PlayerRole, index: number): string {
  return `hand:${owner}:${index}`;
}

export function decodeHandSelection(value: string | null): { owner: PlayerRole; index: number } | null {
  if (!value) return null;
  const match = /^hand:(player1|player2):(\d+)$/.exec(value);
  if (!match) return null;
  return { owner: match[1] as PlayerRole, index: Number(match[2]) };
}

export interface MyDuelState {
  lifePoints: number;
  phase: string;
  monsterZones: (PlacedCard | null)[];
  spellTrapZones: (PlacedCard | null)[];
  grave: CardInstance[];
  banished: CardInstance[];
  fieldZone: PlacedCard | null;
  hand: CardInstance[];
  mainDeck: CardInstance[];
  extraDeck: CardInstance[];
  lastHandDepartureIndex: number | null;
  handShuffleVersion: number;
}

export interface OpponentDuelState extends PublicPlayerState {
  uid: string;
  username: string;
  avatarId: string;
}

interface UseMultiplayerDuelResult {
  // True until BOTH sides have finished initializing — each player only
  // ever populates their own half (see the initialization effect below),
  // so this reflects "have both players' clients shown up and written
  // their own starting state yet," not just "has my own read arrived."
  loading: boolean;
  error: string | null;
  me: MyDuelState | null;
  opponent: OpponentDuelState | null;
  // null only until the very first snapshot of the duel doc arrives —
  // in practice, always non-null by the time loading is false, since
  // both are written as part of the same initial setDoc as the rest of
  // this player's own starting state.
  turnPlayer: PlayerRole | null;
  currentPhase: TurnPhase | null;
  turnEnding: boolean;
  turnNumber: number;
  isMyTurn: boolean;
  // Resolved from player1Selection/player2Selection based on this
  // client's own role, so nothing downstream has to re-derive "which of
  // the two raw fields is mine" itself. null means nothing selected.
  mySelection: string | null;
  opponentSelection: string | null;
  // Raw, unresolved (not "mine"/"opponent") — the caller checks each
  // entry's own toRole, since either client might be the recipient of
  // any given entry depending on who initiated that move. Every entry
  // currently in flight, not just the most recent one — see
  // DuelDoc's own comment on why this is an array.
  pendingControlTransfers: {
    toRole: PlayerRole;
    toIndex: number;
    card: PlacedCard;
  }[];
  // Same raw/unresolved, array-not-single-object convention as
  // pendingControlTransfers above.
  pendingCardReturns: {
    toRole: PlayerRole;
    items: {
      destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
      card: CardInstance;
    }[];
  }[];
}

function buildInitialState(
  mainIds: number[],
  extraIds: number[],
): { publicState: PublicPlayerState; privateState: PrivatePlayerState } {
  const allCards = cardData as CardData[];
  const cardById = new Map(allCards.map((card) => [card.id, card]));

  const mainInstances = shuffle(
    mainIds
      .map((id) => cardById.get(id))
      .filter((card): card is CardData => !!card)
      .map(createCardInstance),
  );
  // Extra Deck order is meaningful (matches the Deck Builder) and is
  // never shuffled.
  const extraInstances = extraIds
    .map((id) => cardById.get(id))
    .filter((card): card is CardData => !!card)
    .map(createCardInstance);

  const openingHandSize = Math.min(OPENING_HAND_SIZE, mainInstances.length);
  const hand = mainInstances.slice(0, openingHandSize);
  const mainDeck = mainInstances.slice(openingHandSize);

  return {
    publicState: {
      lifePoints: 8000,
      phase: 'draw',
      handCount: hand.length,
      mainDeckCount: mainDeck.length,
      extraDeckCount: extraInstances.length,
      monsterZones: [null, null, null],
      spellTrapZones: [null, null, null],
      grave: [],
      banished: [],
      fieldZone: null,
      lastHandDepartureIndex: null,
      handShuffleVersion: 0,
    },
    privateState: { hand, mainDeck, extraDeck: extraInstances },
  };
}

export function useMultiplayerDuel(
  duelId: string | undefined,
  role: PlayerRole | undefined,
  opponentInfo: OpponentInfo | undefined,
  myDeckId: string | undefined,
): UseMultiplayerDuelResult {
  const { currentUser } = useAuth();
  const { avatarId: myAvatarId } = useUserAvatar();
  const { getSavedDeck, loading: decksLoading } = useSavedDecks();

  const [duelDoc, setDuelDoc] = useState<DuelDoc | null>(null);
  const [privateState, setPrivateState] = useState<PrivatePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Guards the initialization write below against firing more than
  // once for this mount — the effect's own dependencies (decksLoading in
  // particular) can legitimately change and re-run it otherwise, which
  // would attempt to re-shuffle and re-write a fresh starting hand over
  // an already-started duel.
  const hasInitializedRef = useRef(false);

  // Initializes MY OWN side of the duel — safe to run regardless of
  // whether the other player already created the document, or does so
  // moments later: setDoc with merge:true only ever touches this uid's
  // own top-level player1/player2 field, plus the shared identity
  // fields, which both clients compute identically from the same
  // information (their own auth/avatar, plus what they already know
  // about their opponent from the matchmaking handshake). Whichever
  // order the two writes actually land in, the end result is the same
  // either way — see firestore.rules for how this is enforced
  // server-side too, not just assumed here.
  useEffect(() => {
    if (!duelId || !role || !opponentInfo || !myDeckId || !currentUser || !currentUser.displayName)
      return;
    if (decksLoading) return;
    if (hasInitializedRef.current) return;

    const savedDeck = getSavedDeck(myDeckId);
    if (!savedDeck) {
      setError('Could not find the selected deck.');
      return;
    }

    hasInitializedRef.current = true;
    const { publicState, privateState: initialPrivateState } = buildInitialState(
      savedDeck.main,
      savedDeck.extra,
    );
    const isPlayer1 = role === 'player1';
    const player1Uid = isPlayer1 ? currentUser.uid : opponentInfo.uid;
    const player2Uid = isPlayer1 ? opponentInfo.uid : currentUser.uid;

    setDoc(
      doc(db, 'duels', duelId),
      {
        player1Uid,
        player1Username: isPlayer1 ? currentUser.displayName : opponentInfo.username,
        player1AvatarId: isPlayer1 ? myAvatarId : opponentInfo.avatarId,
        player2Uid,
        player2Username: isPlayer1 ? opponentInfo.username : currentUser.displayName,
        player2AvatarId: isPlayer1 ? opponentInfo.avatarId : myAvatarId,
        createdAt: serverTimestamp(),
        // Computed identically by both clients (see determineFirstPlayer's
        // own comment) — same idempotent-merge safety as player1Uid/
        // player2Uid above, not something that needs a coordinated write.
        turnPlayer: determineFirstPlayer(duelId, player1Uid, player2Uid),
        currentPhase: 'draw',
        turnEnding: false,
        turnNumber: 1,
        [role]: publicState,
      },
      { merge: true },
    ).catch((err) => {
      console.error('[useMultiplayerDuel] Failed to initialize duel document:', err);
      setError('Could not start the duel. Please try again.');
    });

    setDoc(doc(db, 'duels', duelId, 'private', currentUser.uid), initialPrivateState).catch(
      (err) => {
        console.error('[useMultiplayerDuel] Failed to initialize private state:', err);
        setError('Could not start the duel. Please try again.');
      },
    );
  }, [duelId, role, opponentInfo, myDeckId, currentUser, myAvatarId, decksLoading, getSavedDeck]);

  useEffect(() => {
    if (!duelId) return;
    const unsubscribe = onSnapshot(
      doc(db, 'duels', duelId),
      (snapshot) => {
        const data = snapshot.exists() ? (snapshot.data() as DuelDoc) : null;
        // TEMPORARY DIAGNOSTIC — remove once the animation bug is
        // confirmed fixed. Logs the RAW data this specific snapshot
        // firing actually delivered — hasPendingWrites/fromCache tell us
        // whether this is a local optimistic echo or a server-confirmed
        // value, and the instanceId lists let us directly compare
        // against what MultiplayerDuelFieldPage's own diagnostic
        // reported as missing, rather than inferring it secondhand.
        const summarize = (role: 'player1' | 'player2') => {
          const p = data?.[role];
          if (!p) return null;
          return {
            monsterZones: p.monsterZones.map((c) => c?.instanceId ?? null),
            grave: p.grave.map((c) => c.instanceId),
          };
        };
        console.log('[useMultiplayerDuel] duelDoc snapshot', {
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
          fromCache: snapshot.metadata.fromCache,
          player1: summarize('player1'),
          player2: summarize('player2'),
        });
        setDuelDoc(data);
      },
      (err) => {
        // A silent failure here (no error callback at all) is exactly
        // what made this hard to diagnose the first time around — an
        // onSnapshot subscription that fails (e.g. a security rule
        // rejecting it) doesn't retry on its own, and with nothing
        // logging why, the symptom is just "stuck on the loading state
        // forever, refreshing fixes it" with no clue as to which of the
        // two subscriptions below actually failed or why.
        console.error('[useMultiplayerDuel] duels/{duelId} subscription failed:', err);
        setError('Lost connection to the duel. Please try refreshing the page.');
      },
    );
    return unsubscribe;
  }, [duelId]);

  useEffect(() => {
    if (!duelId || !currentUser) return;
    const unsubscribe = onSnapshot(
      doc(db, 'duels', duelId, 'private', currentUser.uid),
      (snapshot) => {
        setPrivateState(snapshot.exists() ? (snapshot.data() as PrivatePlayerState) : null);
      },
      (err) => {
        console.error('[useMultiplayerDuel] private state subscription failed:', err);
        setError('Lost connection to the duel. Please try refreshing the page.');
      },
    );
    return unsubscribe;
  }, [duelId, currentUser]);

  let me: MyDuelState | null = null;
  let opponent: OpponentDuelState | null = null;

  if (duelDoc && privateState && role) {
    const opponentRole: PlayerRole = role === 'player1' ? 'player2' : 'player1';
    const myPublic = duelDoc[role];
    const opponentPublic = duelDoc[opponentRole];

    if (myPublic) {
      me = { ...myPublic, ...privateState };
    }
    if (opponentPublic) {
      opponent = {
        ...opponentPublic,
        uid: duelDoc[`${opponentRole}Uid`],
        username: duelDoc[`${opponentRole}Username`],
        avatarId: duelDoc[`${opponentRole}AvatarId`],
      };
    }
  }

  const turnPlayer = duelDoc?.turnPlayer ?? null;
  const currentPhase = duelDoc?.currentPhase ?? null;
  const turnEnding = duelDoc?.turnEnding ?? false;
  const turnNumber = duelDoc?.turnNumber ?? 1;
  const isMyTurn = turnPlayer !== null && turnPlayer === role;

  const opponentRoleForSelection: PlayerRole | null =
    role === 'player1' ? 'player2' : role === 'player2' ? 'player1' : null;
  const mySelection = (role && duelDoc?.[`${role}Selection`]) ?? null;
  const opponentSelection =
    (opponentRoleForSelection && duelDoc?.[`${opponentRoleForSelection}Selection`]) ?? null;

  return {
    loading: !me || !opponent,
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
    pendingControlTransfers: duelDoc?.pendingControlTransfers ?? [],
    pendingCardReturns: duelDoc?.pendingCardReturns ?? [],
  };
}