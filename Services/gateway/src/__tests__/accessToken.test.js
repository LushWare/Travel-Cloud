import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createAccessTokenVerifier, loadPublicKeys } from '../accessToken.js';

const newKeyPair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = (publicKey) => publicKey.export({ type: 'spki', format: 'pem' });
const kidOf = (publicKey) => [...loadPublicKeys(pem(publicKey)).keys()][0];

const ours = newKeyPair();
const attacker = newKeyPair();
const CLAIMS = { id: 'user-1', role: 'admin' };

const sign = (privateKey, { kid = kidOf(ours.publicKey), issuer = 'travel-crm-auth', audience = 'travel-crm' } = {}) =>
  jwt.sign(CLAIMS, privateKey, { algorithm: 'ES256', keyid: kid, issuer, audience, expiresIn: '5m' });

const verifier = (legacySecret) => createAccessTokenVerifier({ publicKeys: loadPublicKeys(pem(ours.publicKey)), legacySecret });

describe('access token verification', () => {
  it('accepts a token signed by auth-service', () => {
    expect(verifier()(sign(ours.privateKey)).id).toBe('user-1');
  });

  it('rejects a token signed with any other key', () => {
    expect(() => verifier()(sign(attacker.privateKey))).toThrow();
  });

  it('rejects a token signed with another key under our key id', () => {
    expect(() => verifier()(sign(attacker.privateKey, { kid: kidOf(ours.publicKey) }))).toThrow('invalid signature');
  });

  it('rejects a token whose key id is unknown', () => {
    expect(() => verifier()(sign(ours.privateKey, { kid: 'other' }))).toThrow('Unknown signing key');
  });

  it('rejects a token issued by someone else', () => {
    expect(() => verifier()(sign(ours.privateKey, { issuer: 'evil' }))).toThrow('jwt issuer invalid');
  });

  it('rejects a token meant for another audience', () => {
    expect(() => verifier()(sign(ours.privateKey, { audience: 'other-app' }))).toThrow('jwt audience invalid');
  });

  it('rejects an unsigned token', () => {
    const unsigned = jwt.sign(CLAIMS, null, { algorithm: 'none' });

    expect(() => verifier('legacy')(unsigned)).toThrow('Unsupported token');
  });

  it('rejects an HMAC token forged with the public key as its secret', () => {
    const forged = jwt.sign(CLAIMS, 'not-the-secret', { algorithm: 'HS256' });

    expect(() => verifier('legacy-secret')(forged)).toThrow('invalid signature');
  });

  it('accepts an old shared-secret token while the legacy secret is configured', () => {
    const legacy = jwt.sign(CLAIMS, 'legacy-secret', { algorithm: 'HS256' });

    expect(verifier('legacy-secret')(legacy).id).toBe('user-1');
  });

  it('rejects old shared-secret tokens once the legacy secret is removed', () => {
    const legacy = jwt.sign(CLAIMS, 'legacy-secret', { algorithm: 'HS256' });

    expect(() => verifier(undefined)(legacy)).toThrow('Unsupported token');
  });

  it('reports an expired token as expired', () => {
    const expired = jwt.sign({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 10 }, ours.privateKey, {
      algorithm: 'ES256', keyid: kidOf(ours.publicKey), issuer: 'travel-crm-auth', audience: 'travel-crm',
    });

    expect(() => verifier()(expired)).toThrow(jwt.TokenExpiredError);
  });
});

describe('loadPublicKeys', () => {
  it('loads several keys so a key can be replaced without logging anyone out', () => {
    const keys = loadPublicKeys(`${pem(ours.publicKey)}\n${pem(attacker.publicKey)}`);

    expect(keys.size).toBe(2);
  });

  it('reads keys whose line breaks were written as \\n in an env file', () => {
    const escaped = pem(ours.publicKey).replace(/\n/g, '\\n');

    expect([...loadPublicKeys(escaped).keys()]).toEqual([kidOf(ours.publicKey)]);
  });

  it('returns no keys for an empty setting', () => {
    expect(loadPublicKeys('').size).toBe(0);
  });

  it('refuses an RSA key', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(() => loadPublicKeys(pem(rsa.publicKey))).toThrow('EC P-256');
  });
});
