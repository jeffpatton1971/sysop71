import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeAuthorization, callbackCode, scopes, redirectUri } from '../../scripts/authorize-youtube';

const client = '123-example.apps.googleusercontent.com';
test('authorization requests exact read-only scopes, offline access, and a bound PKCE challenge', () => {
  const result = makeAuthorization(client);
  const url = new URL(result.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), scopes.join(' '));
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(result.verifier).digest('base64url'));
  assert.notEqual(result.state, makeAuthorization(client).state);
  assert.ok(!result.url.includes(result.verifier));
});
test('only a callback bound to this sign-in can supply the code', () => {
  const { state } = makeAuthorization(client);
  assert.equal(callbackCode(new URL(`http://localhost/?state=${state}&code=example`), state), 'example');
  assert.throws(() => callbackCode(new URL('http://localhost/?state=other&code=example'), state));
  assert.throws(() => callbackCode(new URL(`http://localhost/?state=${state}&error=access_denied`), state));
  assert.throws(() => callbackCode(new URL(`http://localhost/?state=${state}&code=a&code=b`), state));
  assert.throws(() => callbackCode(new URL(`http://localhost/?state=${state}`), state));
});
