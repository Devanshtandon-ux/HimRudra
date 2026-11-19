import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
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
  return cachedAuth;
}

export async function signInWithGooglePopup(): Promise<{
  idToken: string;
  email: string | null;
  displayName: string | null;
}> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return {
    idToken,
    email: result.user.email,
    displayName: result.user.displayName,
  };
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
