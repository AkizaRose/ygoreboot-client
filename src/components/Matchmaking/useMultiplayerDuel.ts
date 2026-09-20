import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { useUserAvatar } from '../Avatar/useUserAvatar';
import { useSavedDecks } from '../DeckManager/useSavedDecks';
import { shuffle } from '../../utils/shuffle';
import cardData from '../../data/carddata.json';
import type { CardData } from '../../types/Card';
import { type CardInstance, type PlacedCard, createCardInstance } from '../../types/CardInstance';

// Exported so MultiplayerDuelFieldPage.tsx's own opening-hand-draw effect
// (which deals this many cards one at a time, rather than having them
// already in hand from the start — see buildInitialState below) uses the
// exact same number, rather than a second hardcoded "5" that could drift
// out of sync with this one.
export const OPENING_HAND_SIZE = 5;

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
  // Same idea as handShuffleVersion above, for the Main Deck instead —
  // incremented every time it's shuffled (see MultiplayerDuelFieldPage's
  // own handleShuffleMainDeck), purely so either client can detect the
  // event and play the shuffle flourish for it (see CardLayer's own
  // deckShuffleFlourishes). Just a counter, reveals nothing about deck
  // order.
  mainDeckShuffleVersion: number;
  // True once this player's own opening hand has been fully dealt (see
  // MultiplayerDuelFieldPage's own opening-hand-draw effect) — set once,
  // stays true for the rest of the duel. This is the actual thing that
  // distinguishes "still dealing the opening hand" from "hand count has
  // simply dipped below OPENING_HAND_SIZE during normal play" (playing
  // cards, discarding, etc.) — checking hand.length/handCount against
  // OPENING_HAND_SIZE directly, without this flag, can't tell those two
  // situations apart, and would otherwise auto-draw (or, for the
  // opponent-side check on the start-of-turn draw, wrongly block a
  // normal draw) any time hand size happens to cross that threshold
  // again later in the game.
  openingHandDealt: boolean;
  // A hand card temporarily moved here by the hand's own "Reveal"
  // action (see MultiplayerDuelFieldPage's own handleHandReveal) —
  // renders in a shared, neutral, centered zone (see cardGeometry.ts's
  // own getRevealZoneSlot) visible to both players, then moves back to
  // hand a couple of seconds later. Unlike hand itself, this is public,
  // not private — deliberately: revealing something is the entire
  // point, so unlike every other card in a player's hand, this one
  // SHOULD be visible in the opponent's own read of this document. null
  // whenever nothing is currently being revealed.
  revealedCard: PlacedCard | null;
  // Which end of the Main Deck the most recent card to join it went to
  // — same "small hint, reveals nothing about the card itself" idea as
  // lastHandDepartureIndex above, purely so the OPPONENT's own client
  // can tell CardLayer's own returning-card animation which side to
  // visually land on (in front of the pile for the top, behind it for
  // the bottom — see cardPositions.ts's own deckPileEntries and its
  // comment on why the visual stacking order isn't simply "index 0").
  // Extra Deck never needs this: toExtra only ever prepends, so there's
  // no top/bottom ambiguity for it the way there is for the Main Deck's
  // own stackTop/stackBottom. null whenever nothing has joined the Main
  // Deck yet, or (deliberately) stays at its last value afterward —
  // this is read once, at the moment a deck-count increase is
  // detected, not tracked as an ongoing state to clear.
  lastMainDeckReturnSide: 'top' | 'bottom' | null;
  // A live copy of this player's own hand, present here (and thus
  // readable by the opponent) only while they've chosen to reveal it —
  // backs the "Reveal Hand" button. Unlike revealedCard above (a single
  // card, temporarily relocated to a shared zone), the hand itself
  // never moves anywhere — this is purely an ADDITIONAL, public mirror
  // of it, recomputed by buildPublicState (see MultiplayerDuelFieldPage's
  // own copy of that function) on every single write this player makes,
  // for as long as handRevealed (MyDuelState's own local toggle for
  // this) stays true — so it's always in sync with the real hand's
  // current contents, not a stale snapshot from the moment the button
  // was pressed. null whenever nothing is currently revealed.
  revealedHand: CardInstance[] | null;
  // A one-shot event: this player just resolved an attack from their own
  // monsterZones[fromIndex]. toIndex is the DEFENDING player's own
  // monsterZones index (null for a direct attack, with no monster
  // targeted) — unambiguous without also recording which role that is,
  // since the reader already knows the attacker's role (this object's
  // own owner) and therefore who the defender is. Set once, by the
  // attacking player's own client, the moment they resolve (see
  // MultiplayerDuelFieldPage's own handleAttackTargetClick and the
  // direct-attack path in handleFieldAction) — both clients detect it
  // and play the SAME resolution animation (see CardLayer's own
  // activeAttackAnimations), then the attacker's own client clears it
  // back to null shortly after (see ATTACK_RESOLUTION_CLEAR_MS). id
  // exists purely so a second attack from the same fromIndex to the
  // same toIndex still counts as a fresh, distinct event — the object
  // itself would otherwise look identical to the previous one. Unlike
  // pendingAttack (MultiplayerDuelFieldPage's own local aiming state),
  // this is never set while still deciding where to aim — only once
  // actually resolved, since the opponent has no reason to see a
  // targeting reticle waving around before an attack is committed.
  activeAttack: { id: string; fromIndex: number; toIndex: number | null } | null;
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
  // Set by the VIEWING player's own client when they close the Hand
  // Viewer opened by the other player's own "Reveal Hand" (see
  // PublicPlayerState's own revealedHand and MultiplayerDuelFieldPage's
  // own handleExitOpponentHandView) — the revealing player's own client
  // is the only one that can turn their own reveal off (same "a client
  // can only ever write its own public state slice" principle as
  // pendingControlTransfers above), so this is how the OTHER player
  // signals "please end your reveal" across that boundary. Whichever
  // role wrote it; the revealing player's own effect (see
  // MultiplayerDuelFieldPage's own watcher) checks it against their
  // OWN opponent's role, and always clears it back to null the moment
  // a reveal ends via EITHER path (this signal, or the revealer's own
  // "Hide Hand") — never left stale, so a later, genuinely new signal
  // (even reusing the same role) is always a real change to react to.
  handRevealExitedBy?: PlayerRole | null;
  // The current state of a match-ending action — Admit Defeat or Offer
  // Draw (see MultiplayerDuelFieldPage's own handleAdmitDefeat/
  // handleOfferDraw and friends). A shared, top-level field rather than
  // part of either player's own public state (unlike, say, equippedTo):
  // this describes the WHOLE match's own outcome, not something that
  // belongs to one player's own slice of it.
  //   'drawOffered' — offererRole offered a draw; the OTHER player is
  //     being shown an Accept/Decline prompt. Transient: only ever
  //     followed by 'drawAccepted' or 'drawDeclined' below.
  //   'drawDeclined' — the other player declined; offererRole is who
  //     offered (so their own client knows this concerns them) and is
  //     shown "declined" — the ONLY player who sees anything further,
  //     since the decliner already knows their own choice. Cleared back
  //     to null by the OFFERER's own client once THEY click OK on that
  //     dialog (see handleAcknowledgeDrawDeclined) — the match resumes
  //     normally at that point, so this never lingers once
  //     acknowledged.
  //   'defeatAdmitted' — loserRole admitted defeat.
  //   'drawAccepted' — the draw offer was accepted.
  // Both defeatAdmitted and drawAccepted above are now PER-DUEL
  // outcomes, not per-match — see matchOutcome below for the whole
  // match's own, separate, permanent outcome. matchConclusion itself is
  // never cleared for these two (dismissal is tracked client-side, see
  // MultiplayerDuelFieldPage's own dismissedMatchConclusionKey), but the
  // match keeps going (a fresh duel starts) unless matchOutcome also
  // got set at the same time.
  // null the rest of the time (including after a decline is
  // acknowledged) — MultiplayerDuelFieldPage's own buttons are disabled
  // only once the whole MATCH is over (matchOutcome non-null), not
  // merely because the current duel has ended.
  matchConclusion?:
    | { type: 'drawOffered'; offererRole: PlayerRole }
    | { type: 'drawDeclined'; offererRole: PlayerRole }
    | { type: 'defeatAdmitted'; loserRole: PlayerRole }
    | { type: 'drawAccepted' }
    | null;
  // Best-of-three match state — shared, top-level, and persists across
  // every individual duel played within this same duel "room" (this
  // whole app reuses one duelId per matchmaking pairing, so a "match" of
  // up to 3 duels lives inside a single duels/{duelId} document rather
  // than a separate collection). Only ONE client ever writes these at a
  // time (the same single write that sets matchConclusion above — see
  // MultiplayerDuelFieldPage's own handleAdmitDefeatConfirm/
  // handleAcceptDraw), so there's no race the way there would be if
  // both clients tried to increment these independently.
  matchWins?: { player1: number; player2: number };
  // Which duel of the match this is — starts at 1, incremented by the
  // same single write that ends a duel and decides the match isn't over
  // yet, at the same time as matchWins/duelStartingRole (see above).
  // MultiplayerDuelFieldPage's own effect watches this to know when to
  // rebuild and write a fresh duel for its own side (see startNextDuel
  // below).
  duelNumber?: number;
  // Who goes first in the CURRENT duel — distinct from turnPlayer
  // above, which changes as turns pass during the duel. Set once per
  // duel: at the very first duel's own creation (identical to
  // turnPlayer's own initial value there), and again by the same single
  // write that starts each subsequent duel, computed from the
  // just-finished duel's own outcome — the loser of a decisive duel
  // goes first next, or (for a draw) whoever went SECOND in the
  // just-finished duel goes first next (i.e. the opposite of this
  // field's own previous value).
  duelStartingRole?: PlayerRole;
  // The WHOLE MATCH's own final outcome, once any player has won 2
  // duels (or both reach 2 in the same duel via a draw) — null while
  // the match is still undecided. Set by the same single write that
  // ends the deciding duel. Unlike matchConclusion above (which
  // describes just the most recent duel and gets superseded every
  // duel), this is permanent once set — the match itself is over, and
  // MultiplayerDuelFieldPage's own Admit Defeat/Offer Draw buttons stay
  // disabled for good.
  matchOutcome?:
    | { type: 'player1WinsMatch' }
    | { type: 'player2WinsMatch' }
    | { type: 'matchDraw' }
    | null;
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
    // A fresh, genuinely unique value per transfer (crypto.randomUUID(),
    // generated by the initiating client) — NOT derived from
    // toRole/toIndex/card.instanceId. Those three alone are only unique
    // per DESTINATION, not per transfer EVENT: the same card bouncing
    // between the same two players' fields will very plausibly reuse
    // the same (toRole, toIndex) more than once (there are only 3
    // Monster Zone slots), and the processed-key Sets that guard
    // against double-handling a transfer (see MultiplayerDuelFieldPage's
    // own receiving effect, and CardLayer's animation-queueing) persist
    // for the whole duel — a repeated derived key would have been
    // silently treated as "already handled," on a genuinely new
    // transfer, both for the actual data move AND its animation. This
    // id is what makes every transfer distinguishable from every other,
    // however many times the same card revisits the same slot.
    id: string;
    toRole: PlayerRole;
    toIndex: number;
    card: PlacedCard;
    // Where this card came from, described so EVERY client — not just
    // the one that initiated the transfer — can correctly resolve it
    // into their own coordinate space. Raw (x, y, rotation) coordinates
    // are only ever valid from the CAPTURING client's own perspective
    // (their own side of the board is always rendered as if they're
    // looking at it themselves), and get silently misinterpreted by any
    // OTHER client reusing them verbatim — the same numeric coordinates
    // land in a genuinely different physical board location depending
    // on who's rendering them (their own side vs. the opponent's are
    // NOT just the same coordinates with a 180° rotation — the board's
    // own row/column geometry is asymmetric enough that no simple
    // transform recovers the correct position either). fromRole is
    // whose side this came from; each client resolves the actual
    // position themselves by comparing it against their own role and
    // feeding the result through the same geometry functions the
    // destination (toIndex) already uses — see CardLayer's own
    // buildControlTransferCard. 'monster' additionally carries an index
    // (which of the 3 slots); Grave/Banished don't need one, since the
    // whole pile occupies one spot that matters for an animation's
    // starting point.
    fromRole: PlayerRole;
    fromZone: { kind: 'monster'; index: number } | { kind: 'grave' } | { kind: 'banished' };
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
    // Same reasoning as pendingControlTransfers' own `id` above — a
    // fresh, genuinely unique value per BATCH (not derived from
    // toRole/destination/instanceId, which can legitimately repeat
    // across different returns of the same card over a duel). One id
    // per batch is enough, not one per item within it — the whole batch
    // is always processed and removed as a single atomic unit.
    id: string;
    toRole: PlayerRole;
    items: {
      destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
      card: CardInstance;
      // Same reasoning as pendingControlTransfers' own `from` field
      // above — captured per item, since a batch can contain several
      // differently-positioned cards (the top card plus buried
      // materials, each with their own slightly offset stack position).
      from: SharedCardVisualPosition;
    }[];
  }[];
  // A request from one player to the OTHER, asking them to act on a
  // card sitting in THEIR OWN Grave or Banished Zone — backs the
  // opponent-Grave/Banished viewer's own hover-menu actions (S. Summon,
  // Banish, To Grave). Unlike pendingControlTransfers/pendingCardReturns
  // above, which hand off something the SENDER has already removed from
  // their own state, the requester here can't remove anything at all:
  // the card lives entirely within the TARGET's own public state slice,
  // which only the target's own client can ever write to. So this is a
  // request awaiting action, not a handoff of something already in
  // flight — the target's own client is what actually reads it, carries
  // it out, and clears it again (arrayRemove, once done), the same
  // one-way "only the owning client writes their own slice" rule as
  // every other cross-player interaction in this document.
  //
  // Same array-not-single-object reasoning as pendingControlTransfers/
  // pendingCardReturns above, for the same reason: two requests arriving
  // close together must never let the second silently overwrite the
  // first before the target ever sees it.
  pendingPileRequests: {
    id: string;
    targetRole: PlayerRole;
    instanceId: string;
    pile: 'grave' | 'banished';
    // 'specialSummon': the target removes the card from their own pile
    // and hands it to the REQUESTER's field, by building and appending
    // a normal pendingControlTransfers entry themselves — from that
    // point on it's handled no differently than a transfer that
    // originated from an ordinary field move; the requester's own
    // existing receiving effect places it. 'toOtherPile': moves the
    // card to the target's OTHER pile (Grave -> Banished or the
    // reverse) — entirely within the target's own state once they act
    // on it, no further handoff needed.
    action: 'specialSummon' | 'toOtherPile';
    // Only meaningful for 'specialSummon' — the Battle Position the
    // REQUESTER chose (via the same SummonPositionDialog flow the
    // existing, same-owner Special Summon already uses). Carried here
    // because the requester is the one asked, but the target's own
    // client is the one building the resulting PlacedCard.
    position?: 'attack' | 'defense';
  }[];
}

// The exact visual position a card was rendered at, at a specific
// moment — used only for embedding a known-good animation starting
// point directly into pendingControlTransfers/pendingCardReturns above,
// not for any ongoing rendering state. Deliberately a plain, minimal
// shape (not imported from CardLayer.tsx, a much higher-level UI
// module this file shouldn't depend on) — CardLayer's own
// CardVisualPosition is structurally identical, so passing one where
// the other's expected works without either file needing to share an
// actual type.
export interface SharedCardVisualPosition {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  faceDown: boolean;
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
  mainDeckShuffleVersion: number;
  openingHandDealt: boolean;
  revealedCard: PlacedCard | null;
  lastMainDeckReturnSide: 'top' | 'bottom' | null;
  activeAttack: { id: string; fromIndex: number; toIndex: number | null } | null;
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
    id: string;
    toRole: PlayerRole;
    toIndex: number;
    card: PlacedCard;
    fromRole: PlayerRole;
    fromZone: { kind: 'monster'; index: number } | { kind: 'grave' } | { kind: 'banished' };
  }[];
  // Same raw/unresolved, array-not-single-object convention as
  // pendingControlTransfers above.
  pendingCardReturns: {
    id: string;
    toRole: PlayerRole;
    items: {
      destination: 'hand' | 'grave' | 'banished' | 'mainDeckTop' | 'mainDeckBottom' | 'extraDeck';
      card: CardInstance;
      from: SharedCardVisualPosition;
    }[];
  }[];
  // Same raw/unresolved convention as pendingControlTransfers above —
  // the caller checks each entry's own targetRole, since either client
  // might be the one asked to act on any given request depending on
  // who initiated it.
  pendingPileRequests: {
    id: string;
    targetRole: PlayerRole;
    instanceId: string;
    pile: 'grave' | 'banished';
    action: 'specialSummon' | 'toOtherPile';
    position?: 'attack' | 'defense';
  }[];
  // Resolved straight from DuelDoc's own field of the same name — see
  // that field's own comment for the full reasoning.
  handRevealExitedBy: PlayerRole | null;
  // Resolved straight from DuelDoc's own field of the same name — see
  // that field's own comment for the full reasoning.
  matchConclusion:
    | { type: 'drawOffered'; offererRole: PlayerRole }
    | { type: 'drawDeclined'; offererRole: PlayerRole }
    | { type: 'defeatAdmitted'; loserRole: PlayerRole }
    | { type: 'drawAccepted' }
    | null;
  // --- Best-of-three match state — see DuelDoc's own comments for the
  // full reasoning on each of these. ---
  matchWins: { player1: number; player2: number };
  duelNumber: number;
  duelStartingRole: PlayerRole | null;
  matchOutcome:
    | { type: 'player1WinsMatch' }
    | { type: 'player2WinsMatch' }
    | { type: 'matchDraw' }
    | null;
  // Rebuilds and writes a brand-new duel (fresh shuffled deck, empty
  // hand, full life points) for THIS client's own role only — safe for
  // both clients to call independently, same "each client only ever
  // writes its own slice" rule as everywhere else in this file. Called
  // once per duel, after this player has acknowledged the previous
  // duel's own outcome dialog, and only when the match itself isn't
  // over (matchOutcome still null) — see MultiplayerDuelFieldPage's own
  // handleAcknowledgeMatchConclusion.
  startNextDuel: () => void;
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

  // Deliberately NOT pre-dealt here — both start at 0/full deck, and
  // MultiplayerDuelFieldPage.tsx's own effect deals the opening
  // OPENING_HAND_SIZE cards one at a time once the duel doc is live,
  // the same way any other draw happens (so it animates the same way
  // too), rather than the hand just starting full from the very first
  // snapshot with nothing to see happen.
  const hand: CardInstance[] = [];
  const mainDeck = mainInstances;

  return {
    publicState: {
      lifePoints: 8000,
      phase: 'draw',
      handCount: hand.length,
      mainDeckCount: mainDeck.length,
      extraDeckCount: extraInstances.length,
      monsterZones: [null, null, null, null, null],
      spellTrapZones: [null, null, null, null, null],
      grave: [],
      banished: [],
      fieldZone: null,
      lastHandDepartureIndex: null,
      handShuffleVersion: 0,
      mainDeckShuffleVersion: 0,
      openingHandDealt: false,
      revealedCard: null,
      lastMainDeckReturnSide: null,
      revealedHand: null,
      activeAttack: null,
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

  // retryTick exists purely to force the initialization write below and
  // both onSnapshot subscriptions further down to tear down and
  // re-attach from scratch — see the watchdog effect below those
  // subscriptions for when and why that's needed. Bumping it is
  // deliberately the ONLY thing that effect does; actually detecting
  // "stuck" and deciding to retry lives in one place, not duplicated
  // into each subscription.
  const [retryTick, setRetryTick] = useState(0);

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
    // Computed identically by both clients (see determineFirstPlayer's own
    // comment) — same idempotent-merge safety as player1Uid/player2Uid
    // above, not something that needs a coordinated write. Also doubles as
    // duel 1's own duelStartingRole (see that field's own comment).
    const firstPlayerRole = determineFirstPlayer(duelId, player1Uid, player2Uid);

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
        turnPlayer: firstPlayerRole,
        currentPhase: 'draw',
        turnEnding: false,
        turnNumber: 1,
        matchWins: { player1: 0, player2: 0 },
        duelNumber: 1,
        duelStartingRole: firstPlayerRole,
        matchOutcome: null,
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
  }, [
    duelId,
    role,
    opponentInfo,
    myDeckId,
    currentUser,
    myAvatarId,
    decksLoading,
    getSavedDeck,
    retryTick,
  ]);

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
  }, [duelId, retryTick]);

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
  }, [duelId, currentUser, retryTick]);

  // Self-heals the "stuck on Waiting for both players to be ready"
  // bug: an onSnapshot listener that quietly never receives the update
  // it's waiting for (rather than actually erroring — the error
  // callbacks above already cover the case where it fails outright)
  // doesn't retry on its own, and previously the only fix was manually
  // leaving and rejoining the duel, which works only because it forces
  // a full remount — fresh listeners, and (since hasInitializedRef
  // resets with it) a fresh init write too. This reproduces exactly
  // that recovery automatically instead of requiring it: if role,
  // opponentInfo and myDeckId are all present (so this genuinely SHOULD
  // be loading normally, not stuck on missing session info) but
  // `opponent` still hasn't shown up after a few seconds, bump
  // retryTick to tear down and re-attach both listeners, and clear
  // hasInitializedRef so this client's own write — safe and idempotent
  // to redo, per that effect's own comment — goes out again too, in
  // case IT was the one that silently never landed. Cancelled the
  // moment opponent actually arrives, so this never fires during an
  // ordinary, healthy wait for the other player to finish loading their
  // own deck.
  const opponentRoleForWatchdog: PlayerRole | null =
    role === 'player1' ? 'player2' : role === 'player2' ? 'player1' : null;
  const hasOpponentPublicState = Boolean(
    opponentRoleForWatchdog && duelDoc?.[opponentRoleForWatchdog],
  );
  useEffect(() => {
    if (!duelId || !role || !opponentInfo || !myDeckId) return;
    if (hasOpponentPublicState) return;
    const timeoutId = window.setTimeout(() => {
      hasInitializedRef.current = false;
      setRetryTick((tick) => tick + 1);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [duelId, role, opponentInfo, myDeckId, hasOpponentPublicState]);

  // Rebuilds and writes a fresh duel for this client's own role — see
  // UseMultiplayerDuelResult's own comment on startNextDuel. Deliberately
  // NOT routed through MultiplayerDuelFieldPage's own applyMeUpdate: this
  // is a hard reset, not an incremental change building on the previous
  // duel — applyMeUpdate's own hand-shuffle/departure bookkeeping is
  // meaningless here, since every card is leaving/entering as one
  // transition, not a single move worth animating a "departure" for.
  const startNextDuel = useCallback(() => {
    if (!duelId || !role || !myDeckId || !currentUser) return;
    const savedDeck = getSavedDeck(myDeckId);
    if (!savedDeck) return;
    const { publicState, privateState: freshPrivateState } = buildInitialState(
      savedDeck.main,
      savedDeck.extra,
    );
    // duelStartingRole was already agreed on by both clients when the
    // previous duel's outcome was written (matchConclusion's own single
    // writer set it then, alongside duelNumber) — so both clients calling
    // startNextDuel independently still compute the exact same values
    // here and merging them twice is harmless, same as the rest of this
    // object. Without this, turnPlayer/currentPhase/turnEnding/turnNumber
    // would be left over from the PREVIOUS duel (startNextDuel used to
    // only touch this client's own [role] slice), which is what caused
    // duel 2/3 to get stuck on the "will go first" banner forever: the
    // banner only clears once turnPlayer looks like a fresh duel actually
    // started, which never happened while these were still duel 1's
    // stale values.
    const duelStartingRole = duelDoc?.duelStartingRole ?? role;
    setDoc(
      doc(db, 'duels', duelId),
      {
        [role]: publicState,
        turnPlayer: duelStartingRole,
        currentPhase: 'draw',
        turnEnding: false,
        turnNumber: 1,
      },
      { merge: true },
    ).catch((err) => {
      console.error('[useMultiplayerDuel] Failed to start next duel (public state):', err);
    });
    setDoc(doc(db, 'duels', duelId, 'private', currentUser.uid), freshPrivateState).catch((err) => {
      console.error('[useMultiplayerDuel] Failed to start next duel (private state):', err);
    });
  }, [duelId, role, myDeckId, currentUser, getSavedDeck, duelDoc]);

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
    pendingPileRequests: duelDoc?.pendingPileRequests ?? [],
    handRevealExitedBy: duelDoc?.handRevealExitedBy ?? null,
    matchConclusion: duelDoc?.matchConclusion ?? null,
    matchWins: duelDoc?.matchWins ?? { player1: 0, player2: 0 },
    duelNumber: duelDoc?.duelNumber ?? 1,
    duelStartingRole: duelDoc?.duelStartingRole ?? null,
    matchOutcome: duelDoc?.matchOutcome ?? null,
    startNextDuel,
  };
}
