import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';

export interface LiveDuel {
  duelId: string;
  player1Uid: string;
  player1Username: string;
  player1AvatarId: string;
  player2Uid: string;
  player2Username: string;
  player2AvatarId: string;
}

// Real-time list of every ongoing (not yet concluded) duel, for the Duel
// Menu Page's own "Live Matches" spectator list. `matchOutcome` is set to
// null when a duel document is first created and stays null for the
// entire match — including between individual duels of a best-of-3, while
// one side is siding, etc. — and is the ONE thing every single conclusion
// path (admitting defeat and deciding the match, a draw being accepted, a
// forfeit via the Exit button, or the 60-second disconnect timeout) sets
// to a non-null value in the exact same write that ends the match (see
// useMultiplayerDuel.ts's own handleExitConfirm/handleAdmitDefeatConfirm/
// handleAcceptDraw/disconnect-timeout write sites). So `matchOutcome ==
// null` alone is already a complete, reliable "this match is still live"
// signal — no separate status field needed. Both players' usernames/
// avatarIds are written into the SAME initial setDoc that also sets
// matchOutcome: null (see useMultiplayerDuel.ts's own initialization
// effect), so they're always present together from the moment a duel
// first appears here; nothing here ever needs a separate per-user lookup.
export function useLiveDuels(): { duels: LiveDuel[]; loading: boolean } {
  const [duels, setDuels] = useState<LiveDuel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const liveDuelsQuery = query(collection(db, 'duels'), where('matchOutcome', '==', null));
    const unsubscribe = onSnapshot(liveDuelsQuery, (snapshot) => {
      setDuels(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as Omit<LiveDuel, 'duelId'>;
          return {
            duelId: docSnapshot.id,
            player1Uid: data.player1Uid,
            player1Username: data.player1Username,
            player1AvatarId: data.player1AvatarId,
            player2Uid: data.player2Uid,
            player2Username: data.player2Username,
            player2AvatarId: data.player2AvatarId,
          };
        }),
      );
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { duels, loading };
}
