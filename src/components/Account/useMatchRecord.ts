import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';

export interface MatchRecord {
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
}

interface UseMatchRecordResult extends MatchRecord {
  loading: boolean;
}

// Read-only — nothing in this app writes matchWins/matchLosses/
// matchDraws through this hook. Those three fields on this same
// users/{uid} document (see useUserAvatar's own comment on why avatarId
// lives there too) are written by useMultiplayerDuel's own account-stats
// effect instead, the moment a match's outcome is decided — this hook
// just displays the running total AccountPage shows, in real time,
// via the same onSnapshot-not-getDoc pattern useUserAvatar uses so it
// stays current if a duel finishes in another tab.
export function useMatchRecord(): UseMatchRecordResult {
  const { currentUser } = useAuth();
  const [record, setRecord] = useState<MatchRecord>({
    matchWins: 0,
    matchLosses: 0,
    matchDraws: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setRecord({ matchWins: 0, matchLosses: 0, matchDraws: 0 });
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(doc(db, 'users', currentUser.uid), (snapshot) => {
      const data = snapshot.data() as Partial<MatchRecord> | undefined;
      // A player who hasn't finished a match yet simply has none of
      // these three fields in Firestore at all — same "absence just
      // means zero/default" convention as useUserAvatar's own avatarId.
      setRecord({
        matchWins: data?.matchWins ?? 0,
        matchLosses: data?.matchLosses ?? 0,
        matchDraws: data?.matchDraws ?? 0,
      });
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  return { ...record, loading };
}
