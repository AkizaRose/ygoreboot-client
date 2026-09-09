import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updateEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

interface AuthContextValue {
  currentUser: User | null;
  // True only until the first onAuthStateChanged callback fires — lets
  // callers avoid flashing a "not logged in" state before Firebase has
  // had a chance to check for an existing session.
  loading: boolean;
  signUp: (username: string, email: string, password: string) => Promise<void>;
  logIn: (username: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  // Both require the CURRENT password specifically — Firebase needs
  // actual proof of identity for security-sensitive changes like these,
  // and password is the only thing it can verify that way. Re-entering
  // the already-known current email wouldn't work as identity proof on
  // its own (anyone could type a known email), so even changeEmail
  // itself needs the password, not the current email, as its
  // confirmation input.
  changeEmail: (currentPassword: string, newEmail: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function usernameDocId(username: string): string {
  return username.trim().toLowerCase();
}

// A small, deliberately Firebase-error-shaped helper — lets AuthPage's
// existing error-code switch handle these the same way it already
// handles genuine Firebase errors, rather than needing separate code
// paths just for these two cases.
function authStyleError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// Proves the current password is correct before allowing a
// security-sensitive change (email, password) to proceed — required by
// Firebase itself for these operations (they fail with
// auth/requires-recent-login otherwise if the session isn't freshly
// authenticated), and good practice regardless.
async function reauthenticate(user: User, currentPassword: string): Promise<void> {
  if (!user.email) {
    throw authStyleError('auth/user-not-found', 'Something went wrong. Please try again.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signUp = async (username: string, email: string, password: string) => {
    const trimmedUsername = username.trim();
    const usernameRef = doc(db, 'usernames', usernameDocId(trimmedUsername));

    // Fast, cheap check first — catches the overwhelmingly common case
    // (an already-registered username) before an auth account is ever
    // created. This alone can't fully guarantee uniqueness by itself
    // (two people could both pass it for the same username within the
    // same instant) — the actual guarantee comes from the reservation
    // write below, which Firestore Security Rules only allow to succeed
    // if the username doc doesn't already exist, atomically with the
    // write itself.
    const existingReservation = await getDoc(usernameRef);
    if (existingReservation.exists()) {
      throw authStyleError('auth/username-already-in-use', 'That username is already taken.');
    }

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    try {
      // The username -> email mapping here is what makes username-only
      // login possible: resolving a username to the email
      // signInWithEmailAndPassword actually needs has to happen while
      // signed out, which means this document can't require
      // authentication to read (see the comment on this collection in
      // firestore.rules for the trade-off that implies).
      await setDoc(usernameRef, { uid: user.uid, email });
      await setDoc(doc(db, 'users', user.uid), { username: trimmedUsername });
      await updateProfile(user, { displayName: trimmedUsername });
    } catch (err) {
      // The reservation lost the race — someone else grabbed this exact
      // username in the narrow window between the check above and here.
      // Don't leave a zombie auth account with no claimed username
      // behind; clean it up and report it the same as the common case.
      await user.delete().catch(() => {
        // If even cleanup fails, there's nothing more to safely do here
        // — the orphaned account is harmless (no username, unreachable
        // via login) but not worth crashing over.
      });
      console.error('[AuthContext] Username reservation failed after account creation:', err);
      throw authStyleError('auth/username-already-in-use', 'That username is already taken.');
    }
  };

  const logIn = async (username: string, password: string) => {
    const usernameDoc = await getDoc(doc(db, 'usernames', usernameDocId(username)));
    if (!usernameDoc.exists()) {
      // Deliberately the same generic message/code an incorrect
      // password gets — this form shouldn't reveal whether a username
      // exists at all, just that these specific credentials didn't work.
      throw authStyleError('auth/user-not-found', 'Incorrect username or password.');
    }
    const { email } = usernameDoc.data() as { email: string };
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logOut = async () => {
    await signOut(auth);
  };

  const changeEmail = async (currentPassword: string, newEmail: string) => {
    const user = auth.currentUser;
    if (!user) {
      throw authStyleError('auth/user-not-found', 'You must be logged in to do this.');
    }
    await reauthenticate(user, currentPassword);
    await updateEmail(user, newEmail);

    // The username -> email mapping that username-based login relies on
    // lives in Firestore, entirely separately from Firebase Auth's own
    // record of this account's email — without updating it here too,
    // logging in by username would keep resolving to the OLD email
    // indefinitely, even though the account's real email has changed.
    // Needs its own security rule permitting this specific update (see
    // firestore.rules) — usernames/{username} otherwise blocks updates
    // entirely, to keep reservations permanent once claimed.
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const { username } = userDoc.data() as { username: string };
      await updateDoc(doc(db, 'usernames', usernameDocId(username)), { email: newEmail });
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const user = auth.currentUser;
    if (!user) {
      throw authStyleError('auth/user-not-found', 'You must be logged in to do this.');
    }
    await reauthenticate(user, currentPassword);
    await updatePassword(user, newPassword);
  };

  return (
    <AuthContext.Provider
      value={{ currentUser, loading, signUp, logIn, logOut, changeEmail, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}