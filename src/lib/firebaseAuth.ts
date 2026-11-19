import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  cachedAuth = getAuth(cachedApp);
  // Best-effort persistence setup; non-fatal in strict sandboxed iframes
  setPersistence(cachedAuth, browserLocalPersistence).catch(() => {});
  return cachedAuth;
}

export async function signInWithGooglePopup(): Promise<{
  idToken: string;
  email: string | null;
  displayName: string | null;
}> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken(true);
  return {
    idToken,
    email: result.user.email,
    displayName: result.user.displayName,
  };
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

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in popup was closed before completing. Please try again.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup was blocked by your browser. Please allow popups for this site and click Continue with Google again.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Google Sign-In is not yet authorized for "${host}". Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains, or sign in with Email & Password below.`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google Sign-In is currently disabled in Firebase Console → Authentication → Sign-in method.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while contacting Google Sign-In. Please check your connection and try again.';
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists with this email using a different sign-in method. Please sign in with Email & Password.';
  }
  if (code) {
    return `Google Sign-In failed (${code}). Please try again or use Email & Password.`;
  }
  return rawMessage || 'Unable to sign in with Google right now. Please try again.';
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
