import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { CardInstance, PlacedCard } from '../../types/CardInstance';
import type {
  ChatMessage,
  CoinFlipData,
  DieRollData,
  DuelLogEntry,
  ExpressionEvent,
  PlayerRole,
  TurnPhase,
  ViewingLocation,
} from '../Matchmaking/useMultiplayerDuel';

// Mirrors MultiplayerDuelFieldPage's own (module-private) buildPublicState
// return shape — deliberately re-declared here rather than imported, since
// that function isn't exported and this file has no reason to depend on
// the live duel page at all. Deck CONTENTS are never included (only
// counts) — decks stay unviewable in replay same as live, per the feature
// request, so nothing about their contents was ever recorded in the first
// place; grave/banished ARE full CardInstance[] since those are already
// public information even during a live duel.
export interface ReplayPublicState {
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
  lastHandDepartureIndex: number | null;
  handShuffleVersion: number;
  mainDeckShuffleVersion: number;
  openingHandDealt: boolean;
  lastAutoDrawnTurn: number | null;
  revealedCard: PlacedCard | null;
  lastMainDeckReturnSide: 'top' | 'bottom' | null;
  revealedHand: CardInstance[] | null;
}

export interface ReplayPlayerState {
  publicState: ReplayPublicState;
  hand: CardInstance[];
  // Set only on the ONE frame immediately before a card leaves this
  // player's own Main/Extra Deck (pendingMainDeckId/pendingExtraDeckId),
  // or the ONE frame immediately after a card joins it — see the
  // back-patching pass below for why. ReplayFieldPage substitutes this
  // real instanceId for one of that pile's normal fake placeholder ids,
  // purely so CardLayer's ordinary same-instanceId-across-renders
  // animation tracking (the mechanism that plays every hand/deck move on
  // the LIVE field, where "my own" deck always held real instanceIds
  // already) has a matching id to pick up on the replay's own synthetic
  // deck arrays too. It never reveals anything about deck order/content —
  // a placeholder still only ever renders as a plain card back.
  pendingMainDeckId?: string | null;
  pendingExtraDeckId?: string | null;
  // This player's own current "Viewing [location]"/expression overlay
  // state — see MultiplayerDuelFieldPage's own 'viewingLocation'/
  // 'expression' frames. Unlike publicState/hand above, these are patched
  // independently onto whatever ReplayPlayerState already exists rather
  // than replacing it wholesale, since a viewing-location or expression
  // change is never accompanied by a full board/hand snapshot of its own.
  // undefined until that player's first such frame arrives; null once any
  // frame has explicitly cleared it back out.
  viewingLocation?: ViewingLocation | null;
  expression?: ExpressionEvent | null;
  // This player's own current die roll/coin flip, if any is currently
  // showing — same "patched independently, carried forward across full
  // board/hand snapshots" treatment as viewingLocation/expression above,
  // via the same-shaped 'dieRoll'/'coinFlip' frames (see
  // MultiplayerDuelFieldPage's own recordReplayFrame calls in
  // handleRollDie/handleFlipCoin, which record one of these both when the
  // roll/flip starts and again when it's cleared back to null a few
  // seconds later). ReplayFieldPage restamps startedAt to the moment the
  // replay actually reveals it, rather than trusting the original
  // wall-clock value recorded here, so the tumble/flip animation plays
  // fresh during playback instead of already appearing settled.
  dieRoll?: DieRollData | null;
  coinFlip?: CoinFlipData | null;
  // This player's own last resolved attack, if any — same "patched
  // independently, carried forward across full board/hand snapshots"
  // treatment as dieRoll/coinFlip above, via the same-shaped 'attack'
  // frame (see MultiplayerDuelFieldPage's own recordReplayFrame calls in
  // handleAttackTargetClick and the direct-attack branch of
  // handleFieldAction). Unlike dieRoll/coinFlip, there's no matching
  // "clear" frame — activeAttack is never cleared back to null live
  // either (see MyDuelState's own copy of this field), so it simply stays
  // set to the last attack until a fresh one overwrites it, exactly
  // matching that live behavior. CardLayer's own attack-resolution
  // animation triggers purely off `id` changing to a new value it hasn't
  // seen before, so replaying the exact recorded id/fromIndex/toIndex
  // here (no restamping needed, unlike dieRoll/coinFlip's startedAt)
  // still plays the animation fresh, timed to whenever this replay
  // actually steps onto the frame that set it.
  activeAttack?: { id: string; fromIndex: number; toIndex: number | null } | null;
}

export interface ReplaySnapshot {
  duelNumber: number;
  turnPlayer: PlayerRole | null;
  currentPhase: TurnPhase | null;
  turnEnding: boolean;
  turnNumber: number;
  // Best-of-3 match win tally — a top-level, MATCH-wide field (persists
  // across all 3 duels, same as chatMessages/duelLog), recorded as part
  // of an ordinary 'shared' frame (see MultiplayerDuelFieldPage's own
  // comment on why this doesn't need its own frame kind) whenever a duel
  // concludes.
  matchWins: { player1: number; player2: number };
  // null until that player's very first frame arrives (should be
  // essentially immediately, from the opening-hand-dealt frame — see
  // MultiplayerDuelFieldPage's own comment on recordedOpeningHandForDuelRef).
  player1: ReplayPlayerState | null;
  player2: ReplayPlayerState | null;
  // Every chat message sent so far, MATCH-wide (see ChatMessage's own
  // recorded 'chat' frame in MultiplayerDuelFieldPage — chat persists
  // across all 3 duels, unlike player1/player2 above, which get wholesale
  // replaced at the start of each new duel) — accumulated monotonically
  // across the whole fold below, never reset, same as the live duel
  // document's own chatMessages field never resets it either.
  chatMessages: ChatMessage[];
  // Every Duel Log entry so far — same shared, MATCH-wide, never-reset
  // accumulation as chatMessages above (see DuelLogEntry's own comment),
  // just for the separate 'duelLog' frame stream.
  duelLog: DuelLogEntry[];
}

export interface ReplayMeta {
  player1Username: string;
  player1AvatarId: string;
  player2Username: string;
  player2AvatarId: string;
  myRole: PlayerRole;
}

// Fixed-step pacing, per the confirmed design choice — every recorded
// frame is shown for the same short duration before auto-advancing,
// rather than reproducing the real elapsed time between the original
// actions (which could mean staring at one board state for several real
// minutes during a slow, thoughtful turn).
const STEP_MS = 1200;

export function useReplayPlayback(duelId: string | undefined, currentUid: string | undefined) {
  const [snapshots, setSnapshots] = useState<ReplaySnapshot[] | null>(null);
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!duelId || !currentUid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setIndex(0);

    (async () => {
      const duelSnapshot = await getDoc(doc(db, 'duels', duelId));
      if (!duelSnapshot.exists()) {
        throw new Error('This replay no longer exists.');
      }
      const duelData = duelSnapshot.data();
      const myRole: PlayerRole = duelData.player1Uid === currentUid ? 'player1' : 'player2';

      // Fetched unordered and sorted client-side (recordedAt, then seq as
      // a same-author tie-breaker — see recordReplayFrame's own comment)
      // rather than via a Firestore orderBy, so opening a replay never
      // depends on a composite index existing for this subcollection.
      const framesSnapshot = await getDocs(collection(db, 'duels', duelId, 'replayFrames'));
      const frames = framesSnapshot.docs
        .map((frameDoc) => frameDoc.data())
        .sort((a, b) => {
          const aMs = a.recordedAt?.toMillis?.() ?? 0;
          const bMs = b.recordedAt?.toMillis?.() ?? 0;
          if (aMs !== bMs) return aMs - bMs;
          return (a.seq ?? 0) - (b.seq ?? 0);
        });

      // One cumulative snapshot per frame, built by folding each frame's
      // own small update onto the running total — the same "full-object-
      // overwrite per author, shared fields patched independently" shape
      // the live duel document itself already uses (see recordReplayFrame
      // and applyTurnUpdate's own comments), just replayed forward frame
      // by frame instead of applied in place. Precomputing every step
      // up front (rather than re-folding live during playback) is what
      // lets scrubbing/seeking later be an instant array lookup.
      const built: ReplaySnapshot[] = [];
      let running: ReplaySnapshot = {
        duelNumber: 1,
        turnPlayer: null,
        currentPhase: null,
        turnEnding: false,
        turnNumber: 1,
        matchWins: { player1: 0, player2: 0 },
        player1: null,
        player2: null,
        chatMessages: [],
        duelLog: [],
      };
      // Both players independently record every chat message they can see
      // (see MultiplayerDuelFieldPage's own comment on its 'chat' frames —
      // chatMessages is one shared array on the live duel doc, so each
      // client ends up recording the OTHER player's messages too, not
      // just their own), so the same message.id can arrive twice here.
      // Deduped as it folds in, rather than after, so a message already
      // seen through one player's stream is never appended a second time
      // just because the other player's stream also recorded it.
      const seenChatIds = new Set<string>();
      // Same dedupe reasoning as seenChatIds above, for the Duel Log's own
      // 'duelLog' frame stream.
      const seenDuelLogIds = new Set<string>();
      for (const frame of frames) {
        const next: ReplaySnapshot = { ...running, duelNumber: frame.duelNumber ?? running.duelNumber };
        if (frame.kind === 'player' && (frame.role === 'player1' || frame.role === 'player2')) {
          const role = frame.role as PlayerRole;
          // A full board/hand snapshot never carries its own
          // viewingLocation/expression — those are patched in
          // independently by their own frame kinds below — so whatever
          // this player's own overlay state already was has to be
          // carried forward here explicitly, or every board update would
          // otherwise silently clear it back to unset.
          const existing = next[role];
          next[role] = {
            publicState: frame.publicState,
            hand: frame.hand,
            viewingLocation: existing?.viewingLocation,
            expression: existing?.expression,
            dieRoll: existing?.dieRoll,
            coinFlip: existing?.coinFlip,
            activeAttack: existing?.activeAttack,
          };
        } else if (
          frame.kind === 'viewingLocation' &&
          (frame.role === 'player1' || frame.role === 'player2')
        ) {
          const role = frame.role as PlayerRole;
          const existing = next[role];
          if (existing) next[role] = { ...existing, viewingLocation: frame.location };
        } else if (
          frame.kind === 'expression' &&
          (frame.role === 'player1' || frame.role === 'player2')
        ) {
          const role = frame.role as PlayerRole;
          const existing = next[role];
          if (existing) next[role] = { ...existing, expression: frame.expression };
        } else if (
          frame.kind === 'dieRoll' &&
          (frame.role === 'player1' || frame.role === 'player2')
        ) {
          const role = frame.role as PlayerRole;
          const existing = next[role];
          if (existing) next[role] = { ...existing, dieRoll: frame.roll };
        } else if (
          frame.kind === 'coinFlip' &&
          (frame.role === 'player1' || frame.role === 'player2')
        ) {
          const role = frame.role as PlayerRole;
          const existing = next[role];
          if (existing) next[role] = { ...existing, coinFlip: frame.flip };
        } else if (
          frame.kind === 'attack' &&
          (frame.role === 'player1' || frame.role === 'player2')
        ) {
          const role = frame.role as PlayerRole;
          const existing = next[role];
          if (existing) next[role] = { ...existing, activeAttack: frame.attack };
        } else if (frame.kind === 'shared' && frame.shared) {
          Object.assign(next, frame.shared);
        } else if (frame.kind === 'chat' && frame.message && !seenChatIds.has(frame.message.id)) {
          seenChatIds.add(frame.message.id);
          next.chatMessages = [...running.chatMessages, frame.message];
        } else if (frame.kind === 'duelLog' && frame.entry && !seenDuelLogIds.has(frame.entry.id)) {
          seenDuelLogIds.add(frame.entry.id);
          next.duelLog = [...running.duelLog, frame.entry];
        }
        running = next;
        built.push(running);
      }

      // Back-patch pass: CardLayer plays a hand<->deck move on the LIVE
      // field by noticing the SAME instanceId occupying a new position
      // across two renders (its usual, only-for-real-cards animation
      // path — the separate "anonymous slide" path a few files over only
      // exists for the OPPONENT's hidden zones, never for your own). But
      // every replay deck array is built from scratch per frame out of
      // fake, count-only placeholder ids (see ReplayFieldPage's own
      // placeholderDeck), so a card leaving/joining OWN deck never shares
      // an id across the two frames either side of the move, and that
      // animation path silently finds nothing to key off. Fixing this
      // means finding, for each pile-count change, which real card
      // actually crossed — inferred from what newly appeared or
      // disappeared across every OTHER already-real, already-visible
      // zone (hand/board/grave/banished) — and stamping that one real id
      // onto the pending*DeckId of whichever single frame sits on the far
      // side of the count change, so it briefly shares an id with the
      // deck the way it always does live. Only ever attributes ONE real
      // id per pile per transition, so a multi-card move (several cards
      // milled/returned at once) still only gets one of them animated
      // correctly — a real but narrower gap than the total silence this
      // fixes for the overwhelmingly common single-card case (draws,
      // stacking a single card back onto the deck).
      const visibleElsewhereIds = (state: ReplayPlayerState): Set<string> => {
        const ids = new Set<string>();
        const addPlaced = (placed: PlacedCard | null) => {
          if (!placed) return;
          ids.add(placed.instanceId);
          placed.stackedBelow?.forEach((card) => ids.add(card.instanceId));
        };
        state.hand.forEach((card) => ids.add(card.instanceId));
        state.publicState.monsterZones.forEach(addPlaced);
        state.publicState.spellTrapZones.forEach(addPlaced);
        addPlaced(state.publicState.fieldZone);
        state.publicState.grave.forEach((card) => ids.add(card.instanceId));
        state.publicState.banished.forEach((card) => ids.add(card.instanceId));
        return ids;
      };

      const piles: Array<{
        countKey: 'mainDeckCount' | 'extraDeckCount';
        field: 'pendingMainDeckId' | 'pendingExtraDeckId';
      }> = [
        { countKey: 'mainDeckCount', field: 'pendingMainDeckId' },
        { countKey: 'extraDeckCount', field: 'pendingExtraDeckId' },
      ];
      const patches = new Map<string, Partial<ReplayPlayerState>>();
      for (const role of ['player1', 'player2'] as PlayerRole[]) {
        for (let i = 0; i < built.length - 1; i++) {
          const cur = built[i][role];
          const next = built[i + 1][role];
          if (!cur || !next) continue;
          const curVisible = visibleElsewhereIds(cur);
          const nextVisible = visibleElsewhereIds(next);
          for (const { countKey, field } of piles) {
            const delta = next.publicState[countKey] - cur.publicState[countKey];
            if (delta < 0) {
              // A card left this pile — whichever real id newly showed up
              // somewhere else (almost always the hand, via a draw) is
              // the one that just departed. Attached to CUR, the last
              // frame before the pile shrank, so the deck still shows
              // this real id right up until the frame it lands elsewhere.
              const arrived = [...nextVisible].find((id) => !curVisible.has(id));
              if (arrived) {
                const key = `${i}:${role}`;
                patches.set(key, { ...patches.get(key), [field]: arrived });
              }
            } else if (delta > 0) {
              // A card joined this pile (e.g. stacked back onto the
              // deck) — whichever real id just stopped being visible
              // anywhere else is the one that just arrived. Attached to
              // NEXT, the first frame where the pile is already the
              // larger size, so it shares an id with wherever that card
              // last rendered on the previous frame.
              const departed = [...curVisible].find((id) => !nextVisible.has(id));
              if (departed) {
                const key = `${i + 1}:${role}`;
                patches.set(key, { ...patches.get(key), [field]: departed });
              }
            }
          }
        }
      }
      for (const [key, patch] of patches) {
        const separatorIndex = key.indexOf(':');
        const i = Number(key.slice(0, separatorIndex));
        const role = key.slice(separatorIndex + 1) as PlayerRole;
        const existing = built[i][role];
        if (existing) {
          built[i] = { ...built[i], [role]: { ...existing, ...patch } };
        }
      }

      if (cancelled) return;
      setMeta({
        player1Username: duelData.player1Username ?? 'Player 1',
        player1AvatarId: duelData.player1AvatarId ?? '',
        player2Username: duelData.player2Username ?? 'Player 2',
        player2AvatarId: duelData.player2AvatarId ?? '',
        myRole,
      });
      setSnapshots(built);
      // Each player's frames are written independently by their own
      // client, so the very first few frames in sorted order can easily
      // belong to only ONE side (e.g. that side's opening-hand frame
      // landing a moment before the other side's own) — at those indices,
      // player1/player2 genuinely aren't both populated yet. Starting
      // playback there would show an incomplete board with no way to
      // advance. Once both sides HAVE reported at least once, every later
      // frame keeps them populated (a running fold never nulls them back
      // out), so the first index where both are set is the correct, and
      // only, sensible starting point.
      const firstCompleteIndex = built.findIndex((snapshot) => snapshot.player1 && snapshot.player2);
      setIndex(firstCompleteIndex === -1 ? 0 : firstCompleteIndex);
      setLoading(false);
    })().catch((err) => {
      if (cancelled) return;
      console.error('[useReplayPlayback] Failed to load replay:', err);
      setError(err instanceof Error ? err.message : 'Failed to load this replay.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [duelId, currentUid]);

  // Auto-advance one step at a time while playing; stops itself at the end
  // rather than looping back to the start.
  useEffect(() => {
    if (!isPlaying || !snapshots) return;
    if (index >= snapshots.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setIndex((current) => Math.min(current + 1, snapshots.length - 1));
    }, STEP_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isPlaying, index, snapshots]);

  const current = snapshots?.[index] ?? null;

  return {
    loading,
    error,
    meta,
    current,
    index,
    total: snapshots?.length ?? 0,
    isPlaying,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    seek: (targetIndex: number) =>
      setIndex(Math.max(0, Math.min(targetIndex, (snapshots?.length ?? 1) - 1))),
  };
}
