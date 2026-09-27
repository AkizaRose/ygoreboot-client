import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, where, type Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import type { PlayerRole } from '../Matchmaking/useMultiplayerDuel';

export type ReplayResult = 'win' | 'loss' | 'draw';

export interface ReplayHistoryEntry {
  duelId: string;
  opponentUsername: string;
  opponentAvatarId: string;
  matchCompletedAt: Timestamp;
  result: ReplayResult;
  myRole: PlayerRole;
}

// A "match" is a single duels/{duelId} document — duelNumber increments IN
// PLACE within it across up to 3 duels of a best-of-3 (see DuelDoc's own
// comment), so one Firestore document really does correspond to one whole
// match, and one row here per document is exactly "one row per match" as
// intended, with no separate grouping step needed.
//
// Only matches that have actually finished show up here: matchCompletedAt
// is only ever stamped (see MultiplayerDuelFieldPage's own match-outcome
// handlers) once matchOutcome is genuinely decided, and orderBy on a field
// automatically excludes documents that don't have it set at all — so an
// in-progress duel this account is currently playing simply never matches
// either query below, without needing a separate `where` clause for it.
//
// Two separate queries (one for player1Uid, one for player2Uid), merged
// and re-sorted client-side, rather than a single OR query — simpler to
// reason about, and each one only needs its own single-field composite
// index (Firestore will prompt for these — <field>Uid + matchCompletedAt —
// the first time this page loads against a fresh project; the console
// error it throws links directly to create them).
export function useReplayHistory() {
  const { currentUser } = useAuth();
  const [entries, setEntries] = useState<ReplayHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const duelsRef = collection(db, 'duels');
    const asPlayer1 = query(
      duelsRef,
      where('player1Uid', '==', currentUser.uid),
      orderBy('matchCompletedAt', 'desc'),
    );
    const asPlayer2 = query(
      duelsRef,
      where('player2Uid', '==', currentUser.uid),
      orderBy('matchCompletedAt', 'desc'),
    );

    Promise.all([getDocs(asPlayer1), getDocs(asPlayer2)])
      .then(([snap1, snap2]) => {
        if (cancelled) return;
        const merged: ReplayHistoryEntry[] = [];
        for (const [snapshot, myRole] of [
          [snap1, 'player1'],
          [snap2, 'player2'],
        ] as const) {
          for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();
            if (!data.matchCompletedAt || !data.matchOutcome) continue;
            const opponentRole = myRole === 'player1' ? 'player2' : 'player1';
            const won =
              (myRole === 'player1' && data.matchOutcome.type === 'player1WinsMatch') ||
              (myRole === 'player2' && data.matchOutcome.type === 'player2WinsMatch');
            const draw = data.matchOutcome.type === 'matchDraw';
            merged.push({
              duelId: docSnapshot.id,
              opponentUsername: data[`${opponentRole}Username`] ?? 'Unknown Player',
              opponentAvatarId: data[`${opponentRole}AvatarId`] ?? '',
              matchCompletedAt: data.matchCompletedAt,
              result: draw ? 'draw' : won ? 'win' : 'loss',
              myRole,
            });
          }
        }
        merged.sort((a, b) => b.matchCompletedAt.toMillis() - a.matchCompletedAt.toMillis());
        setEntries(merged);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useReplayHistory] Failed to load replay history:', err);
        setError('Failed to load your match history.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  return { entries, loading, error };
}
