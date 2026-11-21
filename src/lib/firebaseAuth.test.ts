import test from 'node:test';
import assert from 'node:assert/strict';
import { getFirebaseAuthErrorMessage } from './firebaseAuth.ts';

test('handles popup-blocked, popup-closed-by-user, cancelled-popup-request, and unauthorized-domain distinctly', () => {
  const blocked = getFirebaseAuthErrorMessage({ code: 'auth/popup-blocked' });
  const closed = getFirebaseAuthErrorMessage({ code: 'auth/popup-closed-by-user' });
  const cancelled = getFirebaseAuthErrorMessage({ code: 'auth/cancelled-popup-request' });
  const unauthorized = getFirebaseAuthErrorMessage({ code: 'auth/unauthorized-domain' });

  assert.match(blocked, /Popup was blocked/i);
  assert.match(closed, /closed before completing/i);
  assert.doesNotMatch(closed, /blocked/i);
  assert.match(cancelled, /already open|interrupted/i);
  assert.doesNotMatch(cancelled, /blocked/i);
  assert.match(unauthorized, /not yet authorized for this domain/i);
  assert.doesNotMatch(unauthorized, /blocked/i);
});

test('never displays a popup-blocked message for unrelated Firebase authentication failures', () => {
  const unrelatedCodes = [
    'auth/operation-not-allowed',
    'auth/network-request-failed',
    'auth/account-exists-with-different-credential',
    'auth/invalid-api-key',
    'auth/app-not-authorized',
    'auth/internal-error',
    'auth/too-many-requests',
  ];

  for (const code of unrelatedCodes) {
    const msg = getFirebaseAuthErrorMessage({ code });
    assert.doesNotMatch(msg, /popup was blocked/i, `Unexpected popup-blocked text for ${code}`);
  }

  const generic = getFirebaseAuthErrorMessage(new Error('Backend server returned HTTP 500'));
  assert.equal(generic, 'Backend server returned HTTP 500');
  assert.doesNotMatch(generic, /popup was blocked/i);
});
