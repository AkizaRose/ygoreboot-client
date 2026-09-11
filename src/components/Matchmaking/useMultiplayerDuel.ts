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

    setDoc(
      doc(db, 'duels', duelId),
      {
        player1Uid: isPlayer1 ? currentUser.uid : opponentInfo.uid,
        player1Username: isPlayer1 ? currentUser.displayName : opponentInfo.username,
        player1AvatarId: isPlayer1 ? myAvatarId : opponentInfo.avatarId,
        player2Uid: isPlayer1 ? opponentInfo.uid : currentUser.uid,
        player2Username: isPlayer1 ? opponentInfo.username : currentUser.displayName,
        player2AvatarId: isPlayer1 ? opponentInfo.avatarId : myAvatarId,
        createdAt: serverTimestamp(),
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
        setDuelDoc(snapshot.exists() ? (snapshot.data() as DuelDoc) : null);
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

  return { loading: !me || !opponent, error, me, opponent };
}