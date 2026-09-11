import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase/config';

export interface DuelHost {
  uid: string;
  username: string;
  avatarId: string;
}

// Real-time list of everyone currently hosting a duel — every signed-in
// user sees the same list, live, via onSnapshot on the whole collection
// (no pagination or limit; fine at this app's scale). Ordered by
// createdAt so the list has a stable, predictable order (earliest host
// first) rather than shuffling as documents change.
export function useDuelHosts(): { hosts: DuelHost[]; loading: boolean } {
  const [hosts, setHosts] = useState<DuelHost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hostsQuery = query(collection(db, 'duelHosts'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(hostsQuery, (snapshot) => {
      setHosts(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data() as { uid: string; username: string; avatarId: string };
          return { uid: data.uid, username: data.username, avatarId: data.avatarId };
        }),
      );
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { hosts, loading };
}
