// Run with: node --test Services/create-login-keys.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from '../Services/auth-service/node_modules/dotenv/lib/main.js';
import { envQuoted, generateLoginKeyPair, nextPublicKeys, setEnvValue, writeLocalKeys } from './create-login-keys.mjs';

function servicesDir({ auth = '', gateway = '' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'login-keys-'));
  mkdirSync(path.join(dir, 'auth-service'));
  mkdirSync(path.join(dir, 'gateway'));
  writeFileSync(path.join(dir, 'auth-service', '.env'), auth);
  writeFileSync(path.join(dir, 'gateway', '.env'), gateway);
  return dir;
}

const envOf = (dir, service) => parse(readFileSync(path.join(dir, service, '.env'), 'utf8'));

test('generates an EC P-256 key pair whose halves belong together', () => {
  const { privatePem, publicPem } = generateLoginKeyPair();
  const signature = crypto.sign('sha256', Buffer.from('x'), privatePem);

  assert.equal(crypto.createPrivateKey(privatePem).asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert.equal(crypto.verify('sha256', Buffer.from('x'), publicPem, signature), true);
});

test('writes keys that dotenv reads back as the original PEM', () => {
  const keyPair = generateLoginKeyPair();
  const dir = servicesDir();

  writeLocalKeys({ servicesDir: dir, keyPair });

  assert.equal(envOf(dir, 'auth-service').JWT_PRIVATE_KEY, keyPair.privatePem);
  assert.equal(envOf(dir, 'gateway').JWT_PUBLIC_KEYS, keyPair.publicPem);
});

test('keeps the other settings in each .env file', () => {
  const dir = servicesDir({ auth: 'PORT=3001\n', gateway: 'PORT=3000\nJWT_SECRET=old\n' });

  writeLocalKeys({ servicesDir: dir });

  assert.equal(envOf(dir, 'auth-service').PORT, '3001');
  assert.equal(envOf(dir, 'gateway').JWT_SECRET, 'old');
});

test('never puts the private key in the gateway file', () => {
  const keyPair = generateLoginKeyPair();
  const dir = servicesDir();

  writeLocalKeys({ servicesDir: dir, keyPair });

  assert.equal(readFileSync(path.join(dir, 'gateway', '.env'), 'utf8').includes('PRIVATE KEY'), false);
});

test('refuses to replace an existing key without --rotate', () => {
  const dir = servicesDir();
  writeLocalKeys({ servicesDir: dir });

  assert.throws(() => writeLocalKeys({ servicesDir: dir }), /--rotate/);
});

test('on rotation the gateway keeps the previous public key so current logins stay valid', () => {
  const first = generateLoginKeyPair();
  const second = generateLoginKeyPair();
  const dir = servicesDir();
  writeLocalKeys({ servicesDir: dir, keyPair: first });

  writeLocalKeys({ servicesDir: dir, keyPair: second, rotate: true });

  assert.equal(envOf(dir, 'gateway').JWT_PUBLIC_KEYS, `${first.publicPem}\n${second.publicPem}`);
  assert.equal(envOf(dir, 'auth-service').JWT_PRIVATE_KEY, second.privatePem);
});

test('keeps only one previous public key across repeated rotations', () => {
  const [a, b, c] = [generateLoginKeyPair(), generateLoginKeyPair(), generateLoginKeyPair()];

  const value = nextPublicKeys(`${a.publicPem}\n${b.publicPem}`, c.publicPem, { rotate: true });

  assert.equal(value, `${b.publicPem}\n${c.publicPem}`);
});

test('replaces an empty placeholder line instead of adding a second one', () => {
  const body = setEnvValue('A=1\nJWT_PRIVATE_KEY=\nB=2\n', 'JWT_PRIVATE_KEY', envQuoted('k'));

  assert.equal(body, 'A=1\nJWT_PRIVATE_KEY="k"\nB=2\n');
});
