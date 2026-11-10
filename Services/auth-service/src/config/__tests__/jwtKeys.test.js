import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertSigningKeyConfigured, keyIdFor, resetKeysForTests, signJwt, verifyJwt } from '../jwtKeys.js';

const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8 = (key) => key.export({ type: 'pkcs8', format: 'pem' });

beforeEach(() => {
  process.env.JWT_PRIVATE_KEY = pkcs8(ec.privateKey);
  resetKeysForTests();
});

describe('signJwt', () => {
  it('signs with ES256', () => {
    expect(jwt.decode(signJwt({ id: 'u' }, '5m'), { complete: true }).header.alg).toBe('ES256');
  });

  it('names the signing key in the token header', () => {
    expect(jwt.decode(signJwt({ id: 'u' }, '5m'), { complete: true }).header.kid).toBe(keyIdFor(ec.publicKey));
  });

  it('produces a token the matching public key verifies', () => {
    const claims = jwt.verify(signJwt({ id: 'u' }, '5m'), ec.publicKey, { algorithms: ['ES256'] });

    expect(claims.id).toBe('u');
  });

  it('marks who issued the token and who it is for', () => {
    const { iss, aud } = jwt.decode(signJwt({ id: 'u' }, '5m'));

    expect({ iss, aud }).toEqual({ iss: 'travel-crm-auth', aud: 'travel-crm' });
  });

  it('applies the requested lifetime', () => {
    const { iat, exp } = jwt.decode(signJwt({ id: 'u' }, '15m'));

    expect(exp - iat).toBe(900);
  });

  it('reads a key whose line breaks were written as \\n in an env file', () => {
    process.env.JWT_PRIVATE_KEY = pkcs8(ec.privateKey).replace(/\n/g, '\\n');

    expect(verifyJwt(signJwt({ id: 'u' }, '5m')).id).toBe('u');
  });
});

describe('verifyJwt', () => {
  it('rejects a token signed with another key', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const forged = jwt.sign({ id: 'u' }, other.privateKey, { algorithm: 'ES256', issuer: 'travel-crm-auth', audience: 'travel-crm' });

    expect(() => verifyJwt(forged)).toThrow('invalid signature');
  });

  it('rejects an old shared-secret token', () => {
    expect(() => verifyJwt(jwt.sign({ id: 'u' }, 'old-secret'))).toThrow('invalid algorithm');
  });
});

describe('key configuration', () => {
  it('refuses to start without a private key', () => {
    delete process.env.JWT_PRIVATE_KEY;

    expect(() => assertSigningKeyConfigured()).toThrow('JWT_PRIVATE_KEY is not set');
  });

  it('refuses an RSA key', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY = pkcs8(rsa.privateKey);

    expect(() => assertSigningKeyConfigured()).toThrow('EC P-256');
  });

  it('derives the same key id the gateway computes from the public key', () => {
    const { crv, kty, x, y } = ec.publicKey.export({ format: 'jwk' });
    const gatewayKid = crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');

    expect(keyIdFor(ec.publicKey)).toBe(gatewayKid);
  });
});
