import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { createVerifier } from './access-check.mjs';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'trusted', alg: 'RS256' };
const issuer = 'https://example.cloudflareaccess.com';
const audience = 'inkos-application';
const email = 'owner@example.com';
const keys = createLocalJWKSet({ keys: [jwk] });
const verify = createVerifier({ issuer, audience, email, keys });
async function token(overrides = {}, signer = privateKey) {
  return new SignJWT({ email, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'trusted' })
    .setIssuer(overrides.iss ?? issuer).setAudience(overrides.aud ?? audience)
    .setIssuedAt().setExpirationTime(overrides.exp ?? '1h').sign(signer);
}
test('accepts signed owner token for this exact application', async () => {
  assert.equal((await verify(await token())).email, email);
});
test('rejects missing and malformed assertions', async () => {
  for (const value of [undefined, '', 'garbage']) await assert.rejects(() => verify(value));
});
test('rejects wrong application, issuer, owner, and expired token', async () => {
  for (const changes of [{ aud: 'other-app' }, { iss: 'https://evil.example' }, { email: 'other@example.com' }, { exp: 1 }]) {
    const invalid = await token(changes);
    await assert.rejects(() => verify(invalid));
  }
});
test('rejects forged signatures', async () => {
  const attacker = await generateKeyPair('RS256');
  const forged = await token({}, attacker.privateKey);
  await assert.rejects(() => verify(forged));
});
test('rejects invalid Access issuer configuration', () => {
  for (const bad of ['http://example.cloudflareaccess.com', 'https://evil.example', 'https://example.cloudflareaccess.com/path']) {
    assert.throws(() => createVerifier({ issuer: bad, audience, email, keys }));
  }
});
