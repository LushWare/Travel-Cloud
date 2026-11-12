import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const JWT_SECRET = 'gateway-test-secret';
const signingKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUBLIC_PEM = signingKeys.publicKey.export({ type: 'spki', format: 'pem' });
const SERVICES = ['AUTH', 'USER', 'PACKAGE', 'LEAD', 'BOOKING', 'BILLING', 'FLIGHT', 'CAREER',
  'NOTIFICATION', 'ANALYTICS', 'ASSISTANT', 'RECOMMENDATION', 'VOICE', 'PLATFORM'];

let echoServer;
let app;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  const echo = express();
  echo.use((req, res) => res.json({ headers: req.headers }));
  echoServer = http.createServer(echo);
  await new Promise((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
  const echoUrl = `http://127.0.0.1:${echoServer.address().port}`;

  for (const name of SERVICES) process.env[`${name}_SERVICE_URL`] = echoUrl;
  Object.assign(process.env, {
    JWT_SECRET,
    JWT_PUBLIC_KEYS: PUBLIC_PEM,
    CLIENT_URL: 'https://client.example.com',
    MANAGEMENT_URL: 'https://manage.example.com',
    CONSOLE_URL: 'https://console.example.com',
    CORS_ALLOWED_ORIGINS: 'https://extra.example.com, https://second.example.com',
  });

  ({ default: app } = await import('../index.js'));
});

afterAll(() => new Promise((resolve) => echoServer.close(resolve)));

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

const { kid } = (() => {
  const { crv, kty, x, y } = signingKeys.publicKey.export({ format: 'jwk' });
  return { kid: crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url') };
})();

const tokenFor = (claims) => jwt.sign(claims, signingKeys.privateKey, {
  algorithm: 'ES256', keyid: kid, issuer: 'travel-crm-auth', audience: 'travel-crm', expiresIn: '5m',
});

describe('inbound identity headers', () => {
  it.each([
    ['x-user-id', 'attacker'],
    ['x-user-role', 'admin'],
    ['x-user-is-super-admin', 'true'],
    ['x-user-permissions', '["manage_admins"]'],
    ['x-platform-role', 'platform_admin'],
    ['x-ctx', 'forged'],
    ['x-service-key', 'guess'],
    ['x-internal-token', 'guess'],
  ])('does not forward client-supplied %s on a public route', async (header, value) => {
    const res = await request(app).get('/api/v1/packages').set(header, value);

    expect(res.status).toBe(200);
    expect(res.body.headers[header]).toBeUndefined();
  });

  it('forwards the role from the verified token instead of a forged x-user-role', async () => {
    const token = tokenFor({ id: 'user-1', role: 'salesRep', email: 'rep@test.com', name: 'Rep', permissions: [] });

    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-role', 'admin');

    expect(res.body.headers['x-user-role']).toBe('salesRep');
  });

  it('forwards the super-admin flag from the verified token instead of a forged one', async () => {
    const token = tokenFor({ id: 'user-1', role: 'salesRep', email: 'rep@test.com', name: 'Rep', permissions: [] });

    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-is-super-admin', 'true');

    expect(res.body.headers['x-user-is-super-admin']).toBe('false');
  });

  it('keeps unrelated x- headers such as x-file-name', async () => {
    const res = await request(app).get('/api/v1/packages').set('x-file-name', 'photo.jpg');

    expect(res.body.headers['x-file-name']).toBe('photo.jpg');
  });

  it('rejects a protected route when only forged identity headers are sent', async () => {
    const res = await request(app).get('/api/v1/leads').set('x-user-id', 'attacker').set('x-user-role', 'admin');

    expect(res.status).toBe(401);
  });
});

describe('access tokens', () => {
  it('rejects the half-login token issued before the OTP step', async () => {
    const tempToken = tokenFor({ userId: 'user-1', tempAuth: true });

    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${tempToken}`);

    expect(res.status).toBe(401);
  });

  it('still accepts an old shared-secret login during the switch-over', async () => {
    const legacy = jwt.sign({ id: 'user-1', role: 'admin', email: 'a@test.com', name: 'A', permissions: [] }, JWT_SECRET, { expiresIn: '5m' });

    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${legacy}`);

    expect(res.body.headers['x-user-id']).toBe('user-1');
  });

  it('rejects a login signed with a key other than auth-service\'s', async () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const forged = jwt.sign({ id: 'user-1', role: 'admin' }, other.privateKey, {
      algorithm: 'ES256', keyid: kid, issuer: 'travel-crm-auth', audience: 'travel-crm',
    });

    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token without a user id', async () => {
    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(401);
  });

  it('accepts the access token from the token cookie', async () => {
    const token = tokenFor({ id: 'user-1', role: 'admin', email: 'a@test.com', name: 'A', permissions: [] });

    const res = await request(app).get('/api/v1/leads').set('Cookie', `token=${token}`);

    expect(res.body.headers['x-user-id']).toBe('user-1');
  });

  it.each(['/api/v1/auth/refresh', '/api/v1/auth/logout'])('lets %s through without an access token', async (path) => {
    const res = await request(app).post(path);

    expect(res.status).toBe(200);
  });

  it('forwards the refresh cookie to the auth service', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', 'refresh_token=abc');

    expect(res.body.headers.cookie).toBe('refresh_token=abc');
  });
});

describe('agency forwarding', () => {
  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const staffIn = (tid) => tokenFor({ id: 'user-1', tid, role: 'admin', email: 'a@test.com', name: 'A', permissions: [] });

  it('forwards the agency from the verified login', async () => {
    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${staffIn(TENANT_A)}`);

    expect(res.body.headers['x-tenant-id']).toBe(TENANT_A);
  });

  it('replaces a forged agency header with the one in the login', async () => {
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${staffIn(TENANT_A)}`)
      .set('x-tenant-id', 'other-agency');

    expect(res.body.headers['x-tenant-id']).toBe(TENANT_A);
  });

  it('serves anonymous website visitors from the demo agency', async () => {
    const res = await request(app).get('/api/v1/packages');

    expect(res.body.headers['x-tenant-id']).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('ignores a forged agency header from an anonymous visitor', async () => {
    const res = await request(app).get('/api/v1/packages').set('x-tenant-id', 'other-agency');

    expect(res.body.headers['x-tenant-id']).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('shows signed-in staff their own agency on public pages', async () => {
    const res = await request(app).get('/api/v1/packages/pkg-1').set('Cookie', `token=${staffIn(TENANT_A)}`);

    expect(res.body.headers['x-tenant-id']).toBe(TENANT_A);
  });

  it.each(['/api/v1/webhooks/whatsapp', '/api/v1/webhooks/voice/post-call', '/api/v1/webhooks/duffel-flights'])(
    'marks incoming webhook %s as the demo agency, which owns the current integrations',
    async (path) => {
      const res = await request(app).post(path).set('x-tenant-id', 'other-agency');

      expect(res.body.headers['x-tenant-id']).toBe('00000000-0000-4000-8000-000000000001');
    },
  );

  it('lets the agency choice request through without a login', async () => {
    const res = await request(app).post('/api/v1/auth/select-tenant');

    expect(res.status).toBe(200);
  });
});

describe('client IP', () => {
  it('replaces a client-supplied x-client-ip with the address the gateway saw', async () => {
    const res = await request(app).get('/api/v1/packages').set('x-client-ip', '6.6.6.6');

    expect(res.body.headers['x-client-ip']).not.toBe('6.6.6.6');
    expect(res.body.headers['x-client-ip']).toMatch(/127\.0\.0\.1/);
  });
});

describe('signed-in staff on public pages', () => {
  const staffToken = () => tokenFor({ id: 'user-1', role: 'admin', email: 'a@test.com', name: 'A', permissions: [] });
  const expiredToken = () => jwt.sign(
    { id: 'user-1', role: 'admin', email: 'a@test.com', name: 'A', permissions: [], exp: Math.floor(Date.now() / 1000) - 60 },
    signingKeys.privateKey,
    { algorithm: 'ES256', keyid: kid, issuer: 'travel-crm-auth', audience: 'travel-crm' },
  );

  it('identifies a signed-in caller on a public page', async () => {
    const res = await request(app).get('/api/v1/packages/pkg-1').set('Cookie', `token=${staffToken()}`);

    expect(res.body.headers['x-user-role']).toBe('admin');
  });

  it('serves an anonymous caller on a public page', async () => {
    const res = await request(app).get('/api/v1/packages/pkg-1');

    expect(res.status).toBe(200);
    expect(res.body.headers['x-user-id']).toBeUndefined();
  });

  it('serves an invalid token on a public page as anonymous', async () => {
    const res = await request(app).get('/api/v1/packages').set('Authorization', 'Bearer not-a-token');

    expect(res.status).toBe(200);
    expect(res.body.headers['x-user-id']).toBeUndefined();
  });

  it('asks an expired staff cookie to renew instead of browsing as anonymous', async () => {
    const res = await request(app).get('/api/v1/packages').set('Cookie', `token=${expiredToken()}`);

    expect(res.status).toBe(401);
  });

  it('serves an expired website bearer token as anonymous', async () => {
    const res = await request(app).get('/api/v1/packages').set('Authorization', `Bearer ${expiredToken()}`);

    expect(res.status).toBe(200);
  });

  it('lets the renewal request through with an expired access cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `token=${expiredToken()}; refresh_token=abc`);

    expect(res.status).toBe(200);
  });

  it('does not attach identity to public form submissions', async () => {
    const res = await request(app)
      .post('/api/v1/leads/website-contact')
      .set('Authorization', `Bearer ${staffToken()}`);

    expect(res.body.headers['x-user-id']).toBeUndefined();
  });
});

describe('cross-site cookie requests', () => {
  const token = () => tokenFor({ id: 'user-1', role: 'admin', email: 'a@test.com', name: 'A', permissions: [] });

  it('blocks a cookie-authenticated write from an unknown site', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', `token=${token()}`)
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
  });

  it('blocks a refresh attempt from an unknown site', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=abc')
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
  });

  it('allows a cookie-authenticated write from Management', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Cookie', `token=${token()}`)
      .set('Origin', 'https://manage.example.com');

    expect(res.status).toBe(200);
  });

  it('allows a cookie-authenticated read from an unknown site, which CORS keeps unreadable', async () => {
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', `token=${token()}`)
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a write from an unknown site that carries no cookie', async () => {
    const res = await request(app).post('/api/v1/leads/website-contact').set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  it('allows the configured Management origin', async () => {
    const res = await request(app).get('/api/v1/packages').set('Origin', 'https://manage.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://manage.example.com');
  });

  it('allows an origin listed in CORS_ALLOWED_ORIGINS', async () => {
    const res = await request(app).get('/api/v1/packages').set('Origin', 'https://second.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://second.example.com');
  });

  it('sends no allow-origin header for an unknown origin', async () => {
    const res = await request(app).get('/api/v1/packages').set('Origin', 'https://evil.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a localhost origin on any port outside production', async () => {
    process.env.NODE_ENV = 'development';

    const res = await request(app).get('/api/v1/packages').set('Origin', 'http://localhost:61234');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:61234');
  });

  it('rejects a localhost origin in production', async () => {
    process.env.NODE_ENV = 'production';

    const res = await request(app).get('/api/v1/packages').set('Origin', 'http://localhost:5174');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests that carry no Origin header', async () => {
    const res = await request(app).get('/api/v1/packages');

    expect(res.status).toBe(200);
  });
});

describe('platform console routes', () => {
  const agencyToken = () => tokenFor({ id: 'user-1', tid: '00000000-0000-4000-8000-000000000002', role: 'superAdmin', isSuperAdmin: true, email: 'o@acme.test', name: 'Owner', permissions: [] });

  it('reaches platform-service without an agency login', async () => {
    const res = await request(app).get('/api/v1/platform/auth/me');

    expect(res.status).toBe(200);
  });

  it('never forwards an agency identity to platform-service, even for an agency owner', async () => {
    const res = await request(app).get('/api/v1/platform/agencies').set('Cookie', `token=${agencyToken()}`);

    for (const header of ['x-user-id', 'x-user-role', 'x-user-is-super-admin', 'x-tenant-id']) {
      expect(res.body.headers[header]).toBeUndefined();
    }
  });

  it('drops an agency bearer token on the way to platform-service', async () => {
    const res = await request(app).get('/api/v1/platform/agencies').set('Authorization', `Bearer ${agencyToken()}`);

    expect(res.body.headers.authorization).toBeUndefined();
  });

  it('drops forged platform headers', async () => {
    const res = await request(app).get('/api/v1/platform/agencies').set('x-platform-role', 'platform_admin').set('x-tenant-id', 'forged');

    expect(res.body.headers['x-platform-role']).toBeUndefined();
    expect(res.body.headers['x-tenant-id']).toBeUndefined();
  });

  it('blocks a console write from an unknown site', async () => {
    const res = await request(app).post('/api/v1/platform/auth/logout')
      .set('Origin', 'https://evil.example.com').set('Cookie', 'platform_session=abc');

    expect(res.status).toBe(403);
  });

  it('allows the configured console origin', async () => {
    const res = await request(app).post('/api/v1/platform/auth/logout')
      .set('Origin', 'https://console.example.com').set('Cookie', 'platform_session=abc');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://console.example.com');
  });

  it('does not treat a lookalike path as a console route', async () => {
    const res = await request(app).get('/api/v1/platformx');

    expect(res.status).toBe(401);
  });
});

describe('view-only help sessions', () => {
  const ACME = '00000000-0000-4000-8000-000000000002';
  const GRANT = '33333333-3333-4333-8333-333333333333';
  const helpToken = () => tokenFor({ id: 'p-1', tid: ACME, role: 'admin', email: 'ops@lushware.test', name: 'Lushware support · Ops', permissions: ['manage_leads'], help: GRANT, ro: true });

  it('lets a help session read agency data and tells the service it is help access', async () => {
    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${helpToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.headers['x-tenant-id']).toBe(ACME);
    expect(res.body.headers['x-platform-help-grant']).toBe(GRANT);
  });

  it.each([
    ['POST', '/api/v1/leads'],
    ['PUT', '/api/v1/leads/abc'],
    ['PATCH', '/api/v1/admin/users/abc/status'],
    ['DELETE', '/api/v1/billing/invoices/abc'],
    ['PUT', '/api/v1/admin/settings'],
  ])('refuses %s %s from a help session', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${helpToken()}`).send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HELP_ACCESS_READ_ONLY');
    expect(res.body.headers).toBeUndefined();
  });

  it('refuses a public form submission from a help session', async () => {
    const res = await request(app).post('/api/v1/leads/website-contact')
      .set('Origin', 'https://manage.example.com').set('Cookie', `token=${helpToken()}`).send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HELP_ACCESS_READ_ONLY');
  });

  it('lets a help session sign out', async () => {
    const res = await request(app).post('/api/v1/auth/logout')
      .set('Origin', 'https://manage.example.com').set('Cookie', `token=${helpToken()}`);

    expect(res.status).toBe(200);
  });

  it('still lets an ordinary agency login make changes', async () => {
    const token = tokenFor({ id: 'user-1', tid: ACME, role: 'admin', email: 'a@acme.test', name: 'A', permissions: [] });

    const res = await request(app).post('/api/v1/leads').set('Authorization', `Bearer ${token}`).send({});

    expect(res.status).toBe(200);
    expect(res.body.headers['x-platform-help-grant']).toBeUndefined();
  });

  it('ignores a forged help header from a normal login', async () => {
    const token = tokenFor({ id: 'user-1', tid: ACME, role: 'admin', email: 'a@acme.test', name: 'A', permissions: [] });

    const res = await request(app).get('/api/v1/leads').set('Authorization', `Bearer ${token}`).set('x-platform-help-grant', GRANT);

    expect(res.body.headers['x-platform-help-grant']).toBeUndefined();
  });

  it('opens the console help link without any login', async () => {
    const res = await request(app).get('/api/v1/auth/help-access/redeem?code=abc');

    expect(res.status).toBe(200);
  });
});

describe('console setup links', () => {
  it('rate-limits the staff setup endpoint like sign-in', async () => {
    const res = await request(app).post('/api/v1/platform/auth/setup/details').send({ token: 'x' });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBe('10');
  });
});
