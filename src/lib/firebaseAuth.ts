import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  inMemoryPersistence,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedGoogleProvider: GoogleAuthProvider | null = null;

function resolveFirebaseWebConfig() {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim() || firebaseConfig.apiKey;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || firebaseConfig.authDomain;
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId;
  const appId = env.VITE_FIREBASE_APP_ID?.trim() || firebaseConfig.appId;
  return {
    ...firebaseConfig,
    apiKey,
    authDomain,
    projectId,
    appId,
  };
}

function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedApp = getApps().length > 0 ? getApps()[0] : initializeApp(resolveFirebaseWebConfig());
  try {
    cachedAuth = initializeAuth(cachedApp, {
      persistence: [browserLocalPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Auth was already initialized on this FirebaseApp instance
    cachedAuth = getAuth(cachedApp);
  }
  return cachedAuth;
}

function getGoogleProvider(): GoogleAuthProvider {
  if (!cachedGoogleProvider) {
    cachedGoogleProvider = new GoogleAuthProvider();
    cachedGoogleProvider.setCustomParameters({ prompt: 'select_account' });
  }
  return cachedGoogleProvider;
}

// Eagerly warm Firebase Auth & provider in the browser so the user's button click
// invokes signInWithPopup() synchronously without initialization or setPersistence delays.
if (typeof window !== 'undefined') {
  try {
    getFirebaseAuth();
    getGoogleProvider();
  } catch {
    // Defer error reporting until user explicitly attempts Google Sign-In
  }
}

/**
 * Starts Google Sign-In popup synchronously within the caller's user-gesture click handler.
 * There are intentionally NO awaits or async persistence calls before signInWithPopup().
 */
export function signInWithGooglePopup(): Promise<{
  idToken: string;
  email: string | null;
  displayName: string | null;
}> {
  const auth = getFirebaseAuth();
  const provider = getGoogleProvider();
  const popupPromise = signInWithPopup(auth, provider, browserPopupRedirectResolver);

  return popupPromise.then(async (result) => {
    const idToken = await result.user.getIdToken(true);
    return {
      idToken,
      email: result.user.email,
      displayName: result.user.displayName,
    };
  });
}

export function getFirebaseAuthErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message?: unknown }).message)
      : '';

  switch (code) {
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and click Continue with Google again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in window was closed before completing. Please click Continue with Google to try again.';
    case 'auth/cancelled-popup-request':
      return 'A previous Google sign-in window is already open or was interrupted. Please close any open sign-in window and try again.';
    case 'auth/unauthorized-domain':
      return 'Google Sign-In is not yet authorized for this domain in Firebase Authentication settings. Please contact support or sign in with Email & Password below.';
    case 'auth/operation-not-allowed':
      return 'Google Sign-In is currently disabled in Firebase Console → Authentication → Sign-in method.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Google Sign-In. Please check your connection and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Please sign in with Email & Password.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'Firebase authentication configuration is invalid for this site. Please sign in with Email & Password below.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts right now. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This Google account has been disabled. Please contact HimRudra support.';
    default:
      if (code) {
        return `Google Sign-In failed (${code}). Please try again or use Email & Password.`;
      }
      return rawMessage || 'Unable to sign in with Google right now. Please try again.';
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    if (getApps().length > 0) {
      const auth = getFirebaseAuth();
      await signOut(auth);
    }
  } catch {
    // Non-fatal if Firebase session wasn't active
  }
}
