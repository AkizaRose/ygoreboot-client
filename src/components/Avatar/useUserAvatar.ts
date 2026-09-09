import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { DEFAULT_AVATAR_ID } from './avatars';

interface UseUserAvatarResult {
  avatarId: string;
  loading: boolean;
  setAvatarId: (newAvatarId: string) => Promise<void>;
}

// Lives in Firestore (users/{uid}.avatarId), not Firebase Auth's own
// photoURL field — photoURL is meant for a real, stable external image
// url (e.g. from an OAuth provider), which a local bundled asset
// (resolved to a build-hashed path via avatars.ts) isn't.
export function useUserAvatar(): UseUserAvatarResult {
  const { currentUser } = useAuth();
  const [avatarId, setAvatarIdState] = useState<string>(DEFAULT_AVATAR_ID);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setAvatarIdState(DEFAULT_AVATAR_ID);
      setLoading(false);
      return;
    }

    setLoading(true);
    // onSnapshot rather than a one-off getDoc, matching useSavedDecks —
    // keeps this in sync if the avatar is ever changed from elsewhere
    // (e.g. another tab).
    const unsubscribe = onSnapshot(doc(db, 'users', currentUser.uid), (snapshot) => {
      const data = snapshot.data() as { avatarId?: string } | undefined;
      // A user who hasn't chosen one yet simply has no avatarId field at
      // all in Firestore — this is what makes default.png "the default"
      // in practice, without needing to write anything at signup time.
      setAvatarIdState(data?.avatarId ?? DEFAULT_AVATAR_ID);
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  const setAvatarId = async (newAvatarId: string) => {
    if (!currentUser) return;
    // merge: true rather than updateDoc — users/{uid} should always
    // already exist by the time someone's logged in (created at
    // signup), but this stays safe even in an edge case where it
    // somehow doesn't, rather than throwing.
    await setDoc(doc(db, 'users', currentUser.uid), { avatarId: newAvatarId }, { merge: true });
  };

  return { avatarId, loading, setAvatarId };
}
