import { useEffect, useState } from 'react';
import { ref, onValue as onRtdbValue, onDisconnect, set as setRtdbValue, remove } from 'firebase/database';
import { rtdb } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { useUserAvatar } from '../Avatar/useUserAvatar';

export interface DuelSpectator {
  uid: string;
  username: string;
  avatarId: string;
}

// Realtime Database, not Firestore, for the same reason useMultiplayerDuel.ts's
// own presence/{uid} already uses it: onDisconnect() is armed SERVER-SIDE, so
// a spectator who closes the tab, loses their connection, or crashes still
// gets cleaned up automatically — a Firestore-only "spectators" subcollection
// would need every viewer to write their own removal on the way out, which a
// dropped connection or crashed tab never gets the chance to do.
//
// Both players AND every spectator subscribe to the SAME duelSpectators/{duelId}
// list (see the first effect below) — the Multiplayer Duel Field Page's own
// spectator box, in the left-hand column, is what actually renders it, for
// whoever's viewing. Only a spectator (never a player) ever writes their own
// entry into it (the second effect below), gated on `isSpectator`.
export function useDuelSpectators(
  duelId: string | undefined,
  isSpectator: boolean,
): { spectators: DuelSpectator[] } {
  const { currentUser } = useAuth();
  const { avatarId: myAvatarId } = useUserAvatar();
  const [spectators, setSpectators] = useState<DuelSpectator[]>([]);

  useEffect(() => {
    if (!duelId) return;
    const listRef = ref(rtdb, `duelSpectators/${duelId}`);
    const unsubscribe = onRtdbValue(listRef, (snapshot) => {
      const value = snapshot.val() as Record<string, { username: string; avatarId: string }> | null;
      setSpectators(
        value
          ? Object.entries(value).map(([uid, data]) => ({
              uid,
              username: data.username,
              avatarId: data.avatarId,
            }))
          : [],
      );
    });
    return () => unsubscribe();
  }, [duelId]);

  useEffect(() => {
    if (!isSpectator || !duelId || !currentUser || !currentUser.displayName) return;
    const myRef = ref(rtdb, `duelSpectators/${duelId}/${currentUser.uid}`);
    // Same "re-arm onDisconnect every time this client's own RTDB
    // connection comes back up" pattern as useMultiplayerDuel.ts's own
    // presence effect — onDisconnect() only ever covers the CURRENT
    // connection, not one re-established after a brief network blip.
    const unsubscribe = onRtdbValue(ref(rtdb, '.info/connected'), (snapshot) => {
      if (snapshot.val() !== true) return;
      onDisconnect(myRef)
        .remove()
        .then(() => {
          setRtdbValue(myRef, { username: currentUser.displayName, avatarId: myAvatarId });
        })
        .catch((err) => {
          console.error('[useDuelSpectators] Failed to register spectator presence:', err);
        });
    });
    return () => {
      unsubscribe();
      // Covers the ordinary case (navigating away, closing the Exit
      // button) — an unmount alone doesn't drop the underlying RTDB
      // connection (other tabs, or this same one navigating elsewhere,
      // may still be using it), so onDisconnect's own removal never
      // fires on its own for a graceful exit; this is what actually
      // takes this spectator off the list immediately instead of only
      // once their whole browser/connection eventually goes away.
      remove(myRef).catch(() => {});
    };
  }, [isSpectator, duelId, currentUser, myAvatarId]);

  return { spectators };
}
