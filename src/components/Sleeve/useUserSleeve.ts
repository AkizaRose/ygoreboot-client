import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { DEFAULT_SLEEVE_ID } from './sleeves';

interface UseUserSleeveResult {
  sleeveId: string;
  loading: boolean;
  setSleeveId: (newSleeveId: string) => Promise<void>;
}

// Lives in Firestore (users/{uid}.sleeveId), same document and same
// pattern as useUserAvatar's own avatarId — see that file's own comment
// for the full reasoning (a local bundled asset resolved to a
// build-hashed path isn't what Firebase Auth's own photoURL is meant
// for, so this doesn't live there either).
export function useUserSleeve(): UseUserSleeveResult {
  const { currentUser } = useAuth();
  const [sleeveId, setSleeveIdState] = useState<string>(DEFAULT_SLEEVE_ID);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setSleeveIdState(DEFAULT_SLEEVE_ID);
      setLoading(false);
      return;
    }

    setLoading(true);
    // onSnapshot rather than a one-off getDoc, matching useUserAvatar —
    // keeps this in sync if the sleeve is ever changed from elsewhere
    // (e.g. another tab).
    const unsubscribe = onSnapshot(doc(db, 'users', currentUser.uid), (snapshot) => {
      const data = snapshot.data() as { sleeveId?: string } | undefined;
      // A user who hasn't chosen one yet simply has no sleeveId field at
      // all in Firestore — this is what makes 1_Default.png "the
      // default" in practice, without needing to write anything at
      // signup time.
      setSleeveIdState(data?.sleeveId ?? DEFAULT_SLEEVE_ID);
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  const setSleeveId = async (newSleeveId: string) => {
    if (!currentUser) return;
    // merge: true rather than updateDoc — users/{uid} should always
    // already exist by the time someone's logged in (created at
    // signup), but this stays safe even in an edge case where it
    // somehow doesn't, rather than throwing.
    await setDoc(doc(db, 'users', currentUser.uid), { sleeveId: newSleeveId }, { merge: true });
  };

  return { sleeveId, loading, setSleeveId };
}
