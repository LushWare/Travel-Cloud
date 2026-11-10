import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const ISSUER = 'travel-crm-auth';
const AUDIENCE = 'travel-crm';
const PEM_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g;

/** RFC 7638 thumbprint; matches the key id auth-service puts in each token header. */
const keyIdFor = (publicKey) => {
  const { crv, kty, x, y } = publicKey.export({ format: 'jwk' });
  return crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
};

/** Parses one or more PEM public keys (several during a key rotation) into a kid → key map. */
export function loadPublicKeys(raw = '') {
  const keys = new Map();
  for (const pem of raw.replace(/\\n/g, '\n').match(PEM_BLOCK) || []) {
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('JWT_PUBLIC_KEYS must contain EC P-256 public keys only.');
    }
    keys.set(keyIdFor(key), key);
  }
  return keys;
}

/**
 * Returns a function that verifies an access token and returns its claims, or throws.
 * HS256 tokens are accepted only while a legacy secret is configured.
 */
export function createAccessTokenVerifier({ publicKeys, legacySecret }) {
  return (token) => {
    const header = jwt.decode(token, { complete: true })?.header;
    if (header?.alg === 'ES256') {
      const key = publicKeys.get(header.kid);
      if (!key) throw new jwt.JsonWebTokenError('Unknown signing key');
      return jwt.verify(token, key, { algorithms: ['ES256'], issuer: ISSUER, audience: AUDIENCE });
    }
    if (header?.alg === 'HS256' && legacySecret) {
      return jwt.verify(token, legacySecret, { algorithms: ['HS256'] });
    }
    throw new jwt.JsonWebTokenError('Unsupported token');
  };
}
