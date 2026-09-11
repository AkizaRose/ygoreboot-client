import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, deleteDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { useUserAvatar } from '../Avatar/useUserAvatar';
import { DEFAULT_AVATAR_ID } from '../Avatar/avatars';
import type { DuelHost } from './useDuelHosts';

interface DuelInvite {
  joinerUid: string;
  joinerUsername: string;
  joinerAvatarId: string;
  duelId: string;
}

interface UseDuelHostingResult {
  isHosting: boolean;
  startHosting: (deckId: string) => Promise<void>;
  stopHosting: () => Promise<void>;
  joinHost: (host: DuelHost, deckId: string) => Promise<void>;
}

export function useDuelHosting(): UseDuelHostingResult {
  const { currentUser } = useAuth();
  const { avatarId } = useUserAvatar();
  const navigate = useNavigate();
  const [isHosting, setIsHosting] = useState(false);

  // Read from the unmount-cleanup effect below, which intentionally only
  // runs once (empty dependency array) — a plain closure over
  // currentUser from that first render would go stale if the user's
  // auth state ever changed during this component's lifetime, so this
  // ref is what lets that cleanup see who's ACTUALLY logged in at the
  // moment it fires, not who was logged in when the component first
  // mounted.
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  // Remembers which deck we chose when we started hosting — needed
  // later, whenever the invite listener below actually fires (could be
  // moments or minutes later), since useMultiplayerDuel needs to know
  // which deck to build OUR OWN starting state from once the duel
  // actually begins.
  const hostingDeckIdRef = useRef<string | null>(null);

  // Listens for an invite arriving at our OWN uid — i.e. someone joining
  // the duel we're hosting. On arrival: read who's joining and which
  // duel to open, clean up both our own hosting listing and the
  // now-consumed invite (this is what re-opens our uid to host again
  // later — see firestore.rules' create-only rule on duelInvites), and
  // navigate to the duel page with enough state (role, opponent
  // identity, our own deck choice) for useMultiplayerDuel to take over
  // from there.
  useEffect(() => {
    if (!currentUser) return;

    const inviteRef = doc(db, 'duelInvites', currentUser.uid);
    const unsubscribe = onSnapshot(inviteRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const invite = snapshot.data() as DuelInvite;

      setIsHosting(false);
      // Best-effort — even if either delete fails, the invite has
      // already been read and acted on, which is what actually matters
      // for getting both players into the duel.
      deleteDoc(doc(db, 'duelHosts', currentUser.uid)).catch(() => {});
      deleteDoc(inviteRef).catch(() => {});

      navigate(`/duel/multiplayer/${invite.duelId}`, {
        state: {
          role: 'player1',
          myDeckId: hostingDeckIdRef.current,
          opponentInfo: {
            uid: invite.joinerUid,
            username: invite.joinerUsername,
            avatarId: invite.joinerAvatarId,
          },
        },
      });
    });

    return unsubscribe;
  }, [currentUser, navigate]);

  const startHosting = useCallback(
    async (deckId: string) => {
      if (!currentUser || !currentUser.displayName) return;
      hostingDeckIdRef.current = deckId;
      await setDoc(doc(db, 'duelHosts', currentUser.uid), {
        uid: currentUser.uid,
        username: currentUser.displayName,
        avatarId: avatarId ?? DEFAULT_AVATAR_ID,
        createdAt: serverTimestamp(),
      });
      setIsHosting(true);
    },
    [currentUser, avatarId],
  );

  const stopHosting = useCallback(async () => {
    if (!currentUser) return;
    await deleteDoc(doc(db, 'duelHosts', currentUser.uid));
    setIsHosting(false);
  }, [currentUser]);

  // Stops hosting if the player navigates away to a different page
  // within the app without explicitly cancelling first. This can't
  // catch every way a hosting session can end — closing the tab outright
  // or losing connection leaves the listing behind either way, since
  // Firestore has no built-in presence/disconnect detection the way
  // Realtime Database does — but it covers the common, well-behaved
  // case, and is a reasonable starting point for what's meant to be the
  // basic architecture here, not the final word on it.
  useEffect(() => {
    return () => {
      const user = currentUserRef.current;
      if (user) {
        deleteDoc(doc(db, 'duelHosts', user.uid)).catch(() => {});
      }
    };
  }, []);

  const joinHost = useCallback(
    async (host: DuelHost, deckId: string) => {
      if (!currentUser || !currentUser.displayName) return;
      const duelId = crypto.randomUUID();
      try {
        // The create-only security rule on duelInvites/{hostUid} is what
        // actually guarantees only one joiner can ever win this — this
        // try/catch is just how the UI finds out whether it was us.
        await setDoc(doc(db, 'duelInvites', host.uid), {
          joinerUid: currentUser.uid,
          joinerUsername: currentUser.displayName,
          joinerAvatarId: avatarId ?? DEFAULT_AVATAR_ID,
          duelId,
          createdAt: serverTimestamp(),
        });
      } catch {
        throw new Error('That player was just matched with someone else. Please try another.');
      }

      navigate(`/duel/multiplayer/${duelId}`, {
        state: {
          role: 'player2',
          myDeckId: deckId,
          opponentInfo: { uid: host.uid, username: host.username, avatarId: host.avatarId },
        },
      });
    },
    [currentUser, avatarId, navigate],
  );

  return { isHosting, startHosting, stopHosting, joinHost };
}
