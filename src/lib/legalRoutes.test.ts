import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRouteMeta,
  PRIVACY_POLICY_PATH,
  resolveAppRoute,
  TERMS_AND_CONDITIONS_PATH,
} from './legalRoutes';

test('resolveAppRoute matches privacy-policy and terms-and-conditions with normalization', () => {
  assert.equal(resolveAppRoute(PRIVACY_POLICY_PATH), 'privacy-policy');
  assert.equal(resolveAppRoute('/privacy-policy/'), 'privacy-policy');
  assert.equal(resolveAppRoute('/PRIVACY-POLICY'), 'privacy-policy');

  assert.equal(resolveAppRoute(TERMS_AND_CONDITIONS_PATH), 'terms-and-conditions');
  assert.equal(resolveAppRoute('/terms-and-conditions/'), 'terms-and-conditions');
  assert.equal(resolveAppRoute('/Terms-And-Conditions///'), 'terms-and-conditions');
});

test('resolveAppRoute defaults home, admin, and unknown paths to home', () => {
  assert.equal(resolveAppRoute('/'), 'home');
  assert.equal(resolveAppRoute(''), 'home');
  assert.equal(resolveAppRoute('/admin'), 'home');
  assert.equal(resolveAppRoute('/shop'), 'home');
});

test('getRouteMeta returns distinct titles and descriptions for each legal route', () => {
  const privacy = getRouteMeta('privacy-policy', 'Home Title', 'Home Desc');
  const terms = getRouteMeta('terms-and-conditions', 'Home Title', 'Home Desc');
  const home = getRouteMeta('home', 'Home Title', 'Home Desc');

  assert.match(privacy.title, /Privacy Policy/i);
  assert.match(terms.title, /Terms & Conditions/i);
  assert.equal(home.title, 'Home Title');
  assert.equal(home.description, 'Home Desc');
});
