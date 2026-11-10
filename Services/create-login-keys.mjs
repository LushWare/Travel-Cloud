// Creates the login signing key pair for a local stack.
//
//   node Services/create-login-keys.mjs            # first time
//   node Services/create-login-keys.mjs --rotate   # replace the key; current sessions renew on their own
//
// The private key goes to auth-service/.env (JWT_PRIVATE_KEY), the public key to
// gateway/.env (JWT_PUBLIC_KEYS). Neither key is printed. Deployed environments
// get their keys from Terraform (infra/terraform/modules/deployment/secrets.tf).

import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PEM_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g;

export function generateLoginKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).trim(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).trim(),
  };
}

/** A PEM as one double-quoted dotenv value; dotenv turns the \n back into line breaks. */
export const envQuoted = (pem) => `"${pem.trim().replace(/\r?\n/g, '\\n')}"`;

export function readEnvValue(body, key) {
  const match = body.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n') : '';
}

export function setEnvValue(body, key, value) {
  const line = `${key}=${value}`;
  const existing = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm');
  if (existing.test(body)) return body.replace(existing, () => line);
  return `${body.replace(/\s*$/, '')}${body.trim() ? '\n' : ''}${line}\n`;
}

/** Keeps the previous public key next to the new one, so logins signed with it still pass until they expire. */
export function nextPublicKeys(currentValue, newPublicPem, { rotate }) {
  const previous = rotate ? (currentValue.match(PEM_BLOCK) || []).slice(-1) : [];
  return [...previous, newPublicPem].join('\n');
}

export function writeLocalKeys({ servicesDir = HERE, rotate = false, keyPair = generateLoginKeyPair() } = {}) {
  const authEnv = path.join(servicesDir, 'auth-service', '.env');
  const gatewayEnv = path.join(servicesDir, 'gateway', '.env');
  const authBody = existsSync(authEnv) ? readFileSync(authEnv, 'utf8') : '';
  const gatewayBody = existsSync(gatewayEnv) ? readFileSync(gatewayEnv, 'utf8') : '';

  if (readEnvValue(authBody, 'JWT_PRIVATE_KEY') && !rotate) {
    throw new Error('auth-service/.env already has JWT_PRIVATE_KEY. Use --rotate to replace it.');
  }

  const publicKeys = nextPublicKeys(readEnvValue(gatewayBody, 'JWT_PUBLIC_KEYS'), keyPair.publicPem, { rotate });
  writeFileSync(authEnv, setEnvValue(authBody, 'JWT_PRIVATE_KEY', envQuoted(keyPair.privatePem)));
  writeFileSync(gatewayEnv, setEnvValue(gatewayBody, 'JWT_PUBLIC_KEYS', envQuoted(publicKeys)));
  return { authEnv, gatewayEnv };
}

function main() {
  const rotate = process.argv.includes('--rotate');
  try {
    const { authEnv, gatewayEnv } = writeLocalKeys({ rotate });
    console.log(`✓ ${rotate ? 'Replaced' : 'Created'} the login key pair`);
    console.log(`  private key → ${path.relative(process.cwd(), authEnv)}`);
    console.log(`  public key  → ${path.relative(process.cwd(), gatewayEnv)}`);
    console.log('  Restart auth-service and the gateway.');
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
