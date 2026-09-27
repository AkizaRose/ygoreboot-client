import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { CardInstance, PlacedCard } from '../../types/CardInstance';
import type { PlayerRole, TurnPhase } from '../Matchmaking/useMultiplayerDuel';

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
}

export interface ReplaySnapshot {
  duelNumber: number;
  turnPlayer: PlayerRole | null;
  currentPhase: TurnPhase | null;
  turnEnding: boolean;
  turnNumber: number;
  // null until that player's very first frame arrives (should be
  // essentially immediately, from the opening-hand-dealt frame — see
  // MultiplayerDuelFieldPage's own comment on recordedOpeningHandForDuelRef).
  player1: ReplayPlayerState | null;
  player2: ReplayPlayerState | null;
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
        player1: null,
        player2: null,
      };
      for (const frame of frames) {
        const next: ReplaySnapshot = { ...running, duelNumber: frame.duelNumber ?? running.duelNumber };
        if (frame.kind === 'player' && (frame.role === 'player1' || frame.role === 'player2')) {
          next[frame.role as PlayerRole] = { publicState: frame.publicState, hand: frame.hand };
        } else if (frame.kind === 'shared' && frame.shared) {
          Object.assign(next, frame.shared);
        }
        running = next;
        built.push(running);
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
