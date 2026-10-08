import { useEffect, useState, type ReactNode } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../auth/AuthContext';
import { CardLayoutContext } from './CardLayoutContext';
import { DEFAULT_CARD_LAYOUT, isCardLayoutId, type CardLayoutId } from './cardLayouts';

// Lives in Firestore (users/{uid}.cardLayout), same document and same
// pattern as useUserSleeve/useUserAvatar — a user who hasn't chosen yet
// simply has no cardLayout field, which is what makes "modern" the
// default without writing anything at signup.
//
// Unlike the card sleeve, this is a purely *viewer-side* preference: it's
// never written into a duel document or sent to the opponent. Every card
// image this viewer sees — their own, their opponent's, both players'
// when spectating, a replay, the deck builder, the card browser — is drawn
// in whichever layout THIS viewer picked. That's why it's a single app-wide
// context read by CardImage (the one component every card image already
// goes through) rather than something threaded through the duel state.
//
// The last-known value is also mirrored into localStorage, purely so the
// very first render after a page load (before Firestore's first snapshot
// arrives) already uses the right layout instead of flashing Modern first
// for Classic users. Firestore stays the source of truth: every snapshot
// overwrites it.
const CACHE_KEY_PREFIX = 'cardLayout:';

function readCachedLayout(uid: string | null): CardLayoutId {
  if (!uid) return DEFAULT_CARD_LAYOUT;
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + uid);
    return isCardLayoutId(cached) ? cached : DEFAULT_CARD_LAYOUT;
  } catch {
    return DEFAULT_CARD_LAYOUT;
  }
}

function writeCachedLayout(uid: string, layout: CardLayoutId) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + uid, layout);
  } catch {
    // Storage unavailable (private window, blocked site data) — the
    // cache is only a nicety, so just skip it.
  }
}

export function CardLayoutProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid ?? null;

  const [state, setState] = useState<{ uid: string | null; layout: CardLayoutId }>(() => ({
    uid,
    layout: readCachedLayout(uid),
  }));

  // Logging in/out (or switching accounts) swaps in that account's own
  // cached layout immediately, during render, rather than a render later
  // via an effect — otherwise one frame would still show the previous
  // account's layout.
  if (state.uid !== uid) {
    setState({ uid, layout: readCachedLayout(uid) });
  }

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, 'users', uid),
      (snapshot) => {
        const data = snapshot.data() as { cardLayout?: unknown } | undefined;
        const next = isCardLayoutId(data?.cardLayout) ? data.cardLayout : DEFAULT_CARD_LAYOUT;
        setState({ uid, layout: next });
        writeCachedLayout(uid, next);
      },
      (err) => {
        console.error('[CardLayoutProvider] Failed to read card layout:', err);
      },
    );
  }, [uid]);

  const setCardLayout = async (newLayout: CardLayoutId) => {
    if (!uid) return;
    // merge: true rather than updateDoc — see useUserSleeve's own comment.
    // The snapshot listener above also fires immediately for this local
    // write (before the server confirms it), so the UI switches layouts
    // instantly rather than after a round trip.
    await setDoc(doc(db, 'users', uid), { cardLayout: newLayout }, { merge: true });
  };

  return (
    <CardLayoutContext.Provider value={{ layout: state.layout, setCardLayout }}>
      {children}
    </CardLayoutContext.Provider>
  );
}
