import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth, type User } from 'firebase/auth';

/**
 * Public Firebase *web* config comes from Vite env vars (.env.local, git-ignored).
 * These identifiers are not secrets, but we still keep them out of the repo so
 * each team member / judge can point the app at their own project.
 */
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export interface FirebaseHandles {
  app: FirebaseApp;
  appCheck: AppCheck | null;
  db: Firestore;
  auth: Auth;
}

let handles: FirebaseHandles | null = null;

export function getFirebase(): FirebaseHandles | null {
  if (!isFirebaseConfigured) return null;
  if (handles) return handles;

  const app = initializeApp(firebaseConfig);

  // --- App Check -----------------------------------------------------------
  // Dev: the debug provider is enabled by setting this global *before* init.
  // Either a fixed token from .env.local (registered in the console) or `true`
  // to have the SDK print a new debug token to the console.
  if (env.DEV || env.VITE_APPCHECK_DEBUG === 'true') {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  let appCheck: AppCheck | null = null;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (siteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    console.warn('[Pinpoint] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY not set — App Check is NOT active. Cloud AI calls will be rejected if enforcement is on.');
  }

  // --- Firestore with offline persistence (writes queue while offline) -----
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  // --- Anonymous auth (no login for judges) --------------------------------
  const auth = getAuth(app);

  handles = { app, appCheck, db, auth };
  return handles;
}

/** Resolves with the anonymous user; works offline if a session was cached earlier. */
export function ensureSignedIn(): Promise<User | null> {
  const h = getFirebase();
  if (!h) return Promise.resolve(null);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(h.auth, (user) => {
      if (user) {
        unsub();
        resolve(user);
      }
    });
    if (!h.auth.currentUser && navigator.onLine) {
      signInAnonymously(h.auth).catch((e) => {
        console.warn('[Pinpoint] anonymous sign-in failed', e);
        unsub();
        resolve(null);
      });
    } else if (!navigator.onLine) {
      setTimeout(() => {
        unsub();
        resolve(h.auth.currentUser);
      }, 1500);
    }
  });
}
