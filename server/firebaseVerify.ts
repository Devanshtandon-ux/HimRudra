import crypto from 'node:crypto';
import firebaseAppletConfig from '../firebase-applet-config.json' with { type: 'json' };
import { adminAuth } from '../src/lib/firebase-admin.ts';

export interface VerifiedGoogleIdentity {
  localId: string;
  email: string;
  displayName?: string;
  emailVerified: boolean;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> | null = null;
let certsExpiresAt = 0;

function getFirebaseProjectConfig() {
  return {
    apiKey:
      process.env.FIREBASE_API_KEY?.trim() ||
      process.env.VITE_FIREBASE_API_KEY?.trim() ||
      firebaseAppletConfig.apiKey ||
      '',
    projectId:
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
      firebaseAppletConfig.projectId ||
      '',
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN?.trim() ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ||
      firebaseAppletConfig.authDomain ||
      '',
  };
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < certsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as T;
}

async function verifyJwtWithGoogleCerts(
  idToken: string,
  projectId: string
): Promise<VerifiedGoogleIdentity | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  if (header.alg !== 'RS256' || !header.kid) {
    return null;
  }

  const certs = await fetchGooglePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    return null;
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const normalizedSig = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const paddedSig = normalizedSig + '='.repeat((4 - (normalizedSig.length % 4)) % 4);
  const signatureBuf = Buffer.from(paddedSig, 'base64');

  const isValidSig = verifier.verify(certPem, signatureBuf);
  if (!isValidSig) {
    return null;
  }

  const payload = decodeBase64UrlJson<{
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  }>(payloadB64);

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (
    !payload.sub ||
    !payload.email ||
    payload.aud !== projectId ||
    payload.iss !== expectedIssuer ||
    !payload.exp ||
    payload.exp <= nowSec
  ) {
    return null;
  }

  return {
    localId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    displayName: payload.name?.trim() || undefined,
    emailVerified: Boolean(payload.email_verified),
  };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
  const trimmed = idToken.trim();
  const { apiKey, projectId, authDomain } = getFirebaseProjectConfig();

  if (!projectId && !apiKey) {
    throw new Error('Firebase authentication is not configured on the server.');
  }

  // 0. Primary: Official Firebase Admin SDK token verification
  try {
    const decoded = await adminAuth.verifyIdToken(trimmed);
    if (decoded.uid && decoded.email) {
      return {
        localId: decoded.uid,
        email: decoded.email.trim().toLowerCase(),
        displayName: typeof decoded.name === 'string' ? decoded.name.trim() || undefined : undefined,
        emailVerified: Boolean(decoded.email_verified),
      };
    }
  } catch (adminErr) {
    console.warn('Firebase Admin verifyIdToken fallback triggered:', adminErr);
  }

  // 1. Secondary: Cryptographic RS256 verification via Google's official public X.509 certs
  // (works reliably on Vercel & servers even if API key has HTTP referrer restrictions)
  if (projectId) {
    try {
      const verified = await verifyJwtWithGoogleCerts(trimmed, projectId);
      if (verified) {
        return verified;
      }
    } catch (certErr) {
      console.warn('Google X.509 certificate verification fallback triggered:', certErr);
    }
  }

  // 2. Fallback: Firebase Identity Toolkit accounts:lookup REST endpoint
  if (apiKey) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authDomain) {
      headers.Referer = `https://${authDomain}/`;
    }
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ idToken: trimmed }),
      }
    );

    if (lookupRes.ok) {
      const lookupJson = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          displayName?: string;
          emailVerified?: boolean;
        }>;
      };
      const fbUser = lookupJson.users?.[0];
      if (fbUser?.email && fbUser?.localId) {
        return {
          localId: fbUser.localId,
          email: fbUser.email.trim().toLowerCase(),
          displayName: fbUser.displayName?.trim() || undefined,
          emailVerified: Boolean(fbUser.emailVerified),
        };
      }
    }
  }

  throw new Error('Could not verify Google account credentials. Please try again.');
}
