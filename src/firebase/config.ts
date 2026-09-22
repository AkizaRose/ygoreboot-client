import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

// Values come from .env (never committed — see .env.example for the
// shape). The API key itself isn't a secret Firebase expects you to
// hide; it just identifies which Firebase project a request belongs to.
// Real access control lives in Firestore Security Rules (and, for
// Realtime Database below, its own separate Rules), not here.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // Realtime Database is a separate product from Firestore, with its own
  // URL and its own Rules — added purely so useMultiplayerDuel's own
  // presence effects can use onDisconnect(), which has no Firestore
  // equivalent (see that file's own "--- Presence ---" comment for why
  // this app needs it at all). Must match the Realtime Database
  // instance's own URL exactly, as shown in the Firebase console once
  // Realtime Database is enabled for this project — typically
  // https://<project-id>-default-rtdb.<region>.firebasedatabase.app.
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

export default app;
