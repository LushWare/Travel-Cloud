import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export const JWT_ISSUER = 'travel-crm-auth';
export const JWT_AUDIENCE = 'travel-crm';
const ALGORITHM = 'ES256';

let keys;

/** RFC 7638 thumbprint, so the gateway can derive the same key id from the public key alone. */
export function keyIdFor(publicKey) {
  const { crv, kty, x, y } = publicKey.export({ format: 'jwk' });
  return crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
}

function loadKeys() {
  if (keys) return keys;
  const pem = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!pem) throw new Error('JWT_PRIVATE_KEY is not set. Run `node Services/create-login-keys.mjs`.');
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('JWT_PRIVATE_KEY must be an EC P-256 private key.');
  }
  const publicKey = crypto.createPublicKey(privateKey);
  keys = { privateKey, publicKey, kid: keyIdFor(publicKey) };
  return keys;
}

export const assertSigningKeyConfigured = () => {
  loadKeys();
};

export function signJwt(claims, expiresIn) {
  const { privateKey, kid } = loadKeys();
  return jwt.sign(claims, privateKey, {
    algorithm: ALGORITHM, keyid: kid, expiresIn, issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
}

export function verifyJwt(token) {
  return jwt.verify(token, loadKeys().publicKey, {
    algorithms: [ALGORITHM], issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
}

export function resetKeysForTests() {
  keys = undefined;
}
