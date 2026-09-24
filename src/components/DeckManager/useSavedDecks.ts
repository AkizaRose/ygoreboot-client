import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import type { CardData } from '../../types/Card';

// Only card IDs are stored, not full card objects — smaller storage
// footprint, and a saved deck always reflects the *current* version of a
// card (stats, text, etc.) rather than freezing a stale copy from
// whenever it was saved.
export interface SavedDeck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
  side: number[];
  updatedAt: number;
  // True for at most one deck per account at a time (see setDefaultDeck
  // below, which is what enforces that) — the deck the Deck Builder auto-
  // loads on open and the Duel Menu auto-selects, and the one shown with
  // a "(default)" tag in either page's own deck dropdown. Absent/false
  // for every deck saved before this feature existed, same as any other
  // Firestore field added after the fact.
  isDefault: boolean;
}

// The pre-Firestore localStorage key — kept only so migrateLocalDecks
// below can find and import anything saved there before this account
// existed, then clear it.
const LOCAL_STORAGE_KEY = 'ygoreboot:savedDecks';

function decksCollection(uid: string) {
  return collection(db, 'users', uid, 'decks');
}

// Runs once per (freshly logged-in) user — if this browser has decks
// saved from before accounts existed, and this account doesn't already
// have decks in Firestore (e.g. from a previous migration, or from
// saving on another device), uploads them and clears the old key. Safe
// to call on every login: it's a no-op once there's nothing left under
// the old key, or once this account already has Firestore decks.
async function migrateLocalDecksIfNeeded(uid: string): Promise<void> {
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return;

  let localDecks: SavedDeck[];
  try {
    const parsed = JSON.parse(raw);
    localDecks = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[useSavedDecks] Failed to parse local decks for migration:', err);
    return;
  }

  if (localDecks.length === 0) {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return;
  }

  // Only migrate into an empty account — avoids re-uploading duplicates
  // on every future login, and avoids clobbering decks already saved to
  // this account from elsewhere.
  const existing = await getDocs(query(decksCollection(uid)));
  if (!existing.empty) {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    return;
  }

  const batch = writeBatch(db);
  for (const deck of localDecks) {
    const deckRef = doc(decksCollection(uid), deck.id || crypto.randomUUID());
    batch.set(deckRef, {
      name: deck.name,
      main: deck.main,
      extra: deck.extra,
      side: deck.side,
      updatedAt: Timestamp.fromMillis(deck.updatedAt ?? Date.now()),
    });
  }
  await batch.commit();

  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export function useSavedDecks() {
  const { currentUser } = useAuth();
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  // True until the first snapshot for the current user has actually
  // arrived — consumers that resolve a specific deck by id on mount need
  // to wait for this rather than treating "not loaded yet" the same as
  // "doesn't exist," which localStorage's synchronous read never had to
  // worry about.
  const [loading, setLoading] = useState(true);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      setSavedDecks([]);
      setLoading(false);
      return;
    }

    // Guards against the migration (or the listener it sets up)
    // resolving after this effect has already been cleaned up — e.g.
    // currentUser changing again quickly, or the component unmounting
    // while migration is still in flight.
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);

    const setup = async () => {
      try {
        await migrateLocalDecksIfNeeded(currentUser.uid);
      } catch (err) {
        console.error('[useSavedDecks] Local deck migration failed:', err);
      }
      if (cancelled) return;

      unsubscribe = onSnapshot(
        query(decksCollection(currentUser.uid)),
        (snapshot) => {
          const decks: SavedDeck[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              name: data.name as string,
              main: data.main as number[],
              extra: data.extra as number[],
              side: data.side as number[],
              updatedAt:
                data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : Date.now(),
              isDefault: data.isDefault === true,
            };
          });
          setSavedDecks(decks);
          setLoading(false);
        },
        (err) => {
          console.error('[useSavedDecks] Failed to subscribe to saved decks:', err);
          setLoading(false);
        },
      );
    };

    setup();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentUser]);

  const getSavedDeck = useCallback(
    (id: string) => savedDecks.find((deck) => deck.id === id) ?? null,
    [savedDecks],
  );

  // Overwrites the deck with a matching name if one exists, otherwise
  // creates a new entry. Either way, selects the resulting deck
  // afterward, so a subsequent Save reuses the same entry by default.
  const saveDeck = useCallback(
    async (name: string, main: CardData[], extra: CardData[], side: CardData[]) => {
      if (!currentUser) return;
      const trimmedName = name.trim();
      if (!trimmedName) return;

      const payload = {
        name: trimmedName,
        main: main.map((c) => c.id),
        extra: extra.map((c) => c.id),
        side: side.map((c) => c.id),
        updatedAt: serverTimestamp(),
      };

      const existing = savedDecks.find((deck) => deck.name === trimmedName);
      const deckId = existing?.id ?? crypto.randomUUID();

      try {
        // merge: true — payload above deliberately doesn't include
        // isDefault (saving a deck's contents has nothing to do with
        // whether it's the default one), so a plain setDoc here would
        // otherwise silently WIPE that flag on overwrite: setDoc with no
        // merge option replaces the whole document, and a field left out
        // of the new payload just doesn't exist afterward — this was the
        // bug where re-saving a deck under its own existing name cleared
        // its own "(default)" tag. merge: true instead only touches the
        // fields payload actually names, leaving isDefault (and anything
        // else not listed here) exactly as it already was.
        await setDoc(doc(decksCollection(currentUser.uid), deckId), payload, { merge: true });
        setSelectedDeckId(deckId);
      } catch (err) {
        console.error('[useSavedDecks] Failed to save deck:', err);
      }
    },
    [currentUser, savedDecks],
  );

  const renameDeck = useCallback(
    async (id: string, newName: string) => {
      if (!currentUser) return;
      const trimmedName = newName.trim();
      if (!trimmedName) return;
      try {
        await updateDoc(doc(decksCollection(currentUser.uid), id), {
          name: trimmedName,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('[useSavedDecks] Failed to rename deck:', err);
      }
    },
    [currentUser],
  );

  const deleteDeck = useCallback(
    async (id: string) => {
      if (!currentUser) return;
      try {
        await deleteDoc(doc(decksCollection(currentUser.uid), id));
        setSelectedDeckId((prev) => (prev === id ? null : prev));
      } catch (err) {
        console.error('[useSavedDecks] Failed to delete deck:', err);
      }
    },
    [currentUser],
  );

  // Marks `id` as the one default deck for this account, clearing
  // whichever deck (if any) held that flag before — at most one deck is
  // ever the default at a time, enforced here rather than left to
  // whoever calls this, so nothing downstream (the Deck Builder's own
  // auto-load, the Duel Menu's own auto-select) has to reconcile more
  // than one candidate. A single batch (rather than two separate writes)
  // so the two flags always flip together, never leaving a moment where
  // either zero or two decks are marked default if the second write were
  // to fail on its own.
  const setDefaultDeck = useCallback(
    async (id: string) => {
      if (!currentUser) return;
      const previousDefault = savedDecks.find((deck) => deck.isDefault && deck.id !== id);
      const batch = writeBatch(db);
      batch.set(doc(decksCollection(currentUser.uid), id), { isDefault: true }, { merge: true });
      if (previousDefault) {
        batch.set(
          doc(decksCollection(currentUser.uid), previousDefault.id),
          { isDefault: false },
          { merge: true },
        );
      }
      try {
        await batch.commit();
      } catch (err) {
        console.error('[useSavedDecks] Failed to set default deck:', err);
      }
    },
    [currentUser, savedDecks],
  );

  return {
    savedDecks,
    loading,
    selectedDeckId,
    setSelectedDeckId,
    getSavedDeck,
    saveDeck,
    renameDeck,
    deleteDeck,
    setDefaultDeck,
  };
}