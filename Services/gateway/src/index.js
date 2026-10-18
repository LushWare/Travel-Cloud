import 'dotenv/config';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import { GoogleAuth } from 'google-auth-library';

const app = express();

app.set('trust proxy', 1);

// Request ID + structured logging (replaces morgan). Runs first so every
// downstream middleware/proxy call has req.requestId and req.log available.
app.use(correlationId);
app.use(requestLogger);

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      process.env.CLIENT_URL,
      process.env.MANAGEMENT_URL,
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:3010',
      'https://lushtravelcloud.com',
      'https://www.lushtravelcloud.com',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(null, true); // allow mobile apps with no origin
  },
  credentials: true,
}));
app.use(cookieParser());

// ─── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
// Stricter than authLimiter: each request is a real, billed Gemini call, not a login attempt.
const aiItineraryPreviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
// Higher ceiling than aiItineraryPreviewLimiter: a single conversation to
// "ready" plus a couple of follow-up messages is several billed Gemini
// calls, not one — 30/15min gives roughly 3x a typical conversation's
// turn count while still bounding cost per IP.
const itineraryChatLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const recommendationsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
app.use(globalLimiter);

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() })
);

// ─── Service URLs ──────────────────────────────────────────────────────────────
const SERVICES = {
  auth:         process.env.AUTH_SERVICE_URL         || 'http://localhost:3001',
  user:         process.env.USER_SERVICE_URL          || 'http://localhost:3002',
  package:      process.env.PACKAGE_SERVICE_URL       || 'http://localhost:3003',
  lead:         process.env.LEAD_SERVICE_URL          || 'http://localhost:3004',
  booking:      process.env.BOOKING_SERVICE_URL       || 'http://localhost:3005',
  billing:      process.env.BILLING_SERVICE_URL       || 'http://localhost:3006',
  flight:       process.env.FLIGHT_SERVICE_URL        || 'http://localhost:3010',
  career:       process.env.CAREER_SERVICE_URL        || 'http://localhost:3007',
  notification: process.env.NOTIFICATION_SERVICE_URL  || 'http://localhost:3008',
  analytics:    process.env.ANALYTICS_SERVICE_URL     || 'http://localhost:3009',
  assistant:    process.env.ASSISTANT_SERVICE_URL     || 'http://localhost:3011',
  recommendations: process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:3013',
  voice:        process.env.VOICE_SERVICE_URL         || 'http://localhost:3012',
};

// ─── Public routes (no JWT required) ──────────────────────────────────────────
const PUBLIC_PATTERNS = [
  // Auth
  [/^\/api\/v1\/auth\/(register|login|login-step[12]|resend-otp|forgot-password|reset-temp-password|verify-email)/, 'ALL'],
  [/^\/api\/v1\/auth\/reset-password\//, 'ALL'],
  // Public package browsing — explicit paths only; admin/AI sub-routes remain protected
  [/^\/api\/v1\/packages\/?(\?.*)?$/,           'GET'], // list
  [/^\/api\/v1\/packages\/featured\//,           'GET'], // featured
  [/^\/api\/v1\/packages\/stats\//,              'GET'], // stats
  [/^\/api\/v1\/packages\/search\//,             'GET'], // search
  [/^\/api\/v1\/packages\/category\//,           'GET'], // by category
  [/^\/api\/v1\/packages\/[^/]+\/?(\?.*)?$/,    'GET'], // single package view /:id
  [/^\/api\/v1\/reviews/, 'GET'],
  // Public forms
  [/^\/api\/v1\/bookings\/website$/, 'POST'],
  [/^\/api\/v1\/bookings\/recent$/, 'GET'],
  [/^\/api\/v1\/leads\/website-contact$/, 'POST'],
  [/^\/api\/v1\/customized-packages\/website$/, 'POST'],
  [/^\/api\/v1\/manual-itineraries\/website$/, 'POST'],
  [/^\/api\/v1\/packages\/generate-itinerary-preview$/, 'POST'],
  [/^\/api\/v1\/packages\/itinerary-chat$/, 'POST'],
  [/^\/api\/v1\/packages\/wizard-turn$/, 'POST'],
  [/^\/api\/v1\/packages\/generate-day-preview$/, 'POST'],
  [/^\/api\/v1\/packages\/generate-days-preview$/, 'POST'],
  [/^\/api\/v1\/assistant\/turn$/, 'POST'],
  [/^\/api\/v1\/assistant\/events$/, 'POST'],
  [/^\/api\/v1\/careers\/apply$/, 'POST'],
  [/^\/api\/v1\/vacancies\/?$/, 'GET'],
  // NOTE: /api/v1/vacancies/admin/all is deliberately NOT public. It was listed
  // here and the downstream route was registered above its own auth gate, which
  // together made the admin vacancy list reachable without a token at all.
  // Upload public
  [/^\/api\/v1\/upload\/optimize$/, 'GET'],
  // Webhooks
  [/^\/api\/v1\/webhooks\//, 'ALL'],
  // View tracking (public token-based)
  [/\/viewed$/, 'POST'],
];

const isPublicRoute = (method, path) =>
  PUBLIC_PATTERNS.some(([re, m]) => re.test(path) && (m === 'ALL' || m === method));

// ─── JWT verification ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (isPublicRoute(req.method, req.path)) return next();

  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Forward user context to downstream services via headers
    req.headers['x-user-id']            = decoded.id;
    req.headers['x-user-role']          = decoded.role;
    req.headers['x-user-email']         = decoded.email;
    req.headers['x-user-name']          = decoded.name;
    req.headers['x-user-permissions']   = JSON.stringify(decoded.permissions || []);
    req.headers['x-user-is-super-admin'] = String(decoded.isSuperAdmin || false);
    // Strip client-supplied internal key to prevent privilege escalation
    delete req.headers['x-service-key'];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        status: 'fail',
        code: 'UNAUTHENTICATED',
        message: 'Token expired. Please login again.',
        ...(req.requestId && { requestId: req.requestId }),
      });
    }
    return res.status(401).json({
      success: false,
      status: 'fail',
      code: 'UNAUTHENTICATED',
      message: 'Invalid token.',
      ...(req.requestId && { requestId: req.requestId }),
    });
  }
});

// ─── Cloud Run backend auth ────────────────────────────────────────────────────
// Backend Cloud Run services are deployed with allow_unauthenticated = false;
// only the gateway's service account holds run.invoker. Each proxied request
// therefore needs a Google-signed ID token for the target service's audience.
const googleAuth = new GoogleAuth();
const idTokenClients = new Map();

const getAuthHeader = async (target) => {
  if (!process.env.K_SERVICE) return null; // not running on Cloud Run (local/dev/CI) — behave exactly as today
  if (!idTokenClients.has(target)) {
    idTokenClients.set(target, await googleAuth.getIdTokenClient(target));
  }
  const client = idTokenClients.get(target);
  const headers = await client.getRequestHeaders(target);
  return headers['Authorization'];
};

// ─── Proxy factory ─────────────────────────────────────────────────────────────
// pathRewrite restores req.originalUrl because Express strips the mount prefix
// from req.url before passing control to the middleware (e.g. app.use('/api/v1/auth/login', ...)
// makes req.url === '/' inside the handler). Services expect the full path.
const proxy = (target) => {
  const middleware = createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (_path, req) => req.originalUrl,
    on: {
      proxyReq: (proxyReq, req) => {
        if (req.cloudRunAuthHeader) proxyReq.setHeader('Authorization', req.cloudRunAuthHeader);
      },
      proxyRes: (proxyRes) => {
        // Strip service-level CORS headers so the gateway's cors() middleware wins.
        // Services set their own Access-Control-Allow-Origin (often hardcoded to one
        // origin); leaving those headers in the proxied response would override the
        // gateway's correctly-reflected origin and block other allowed clients.
        delete proxyRes.headers['access-control-allow-origin'];
        delete proxyRes.headers['access-control-allow-credentials'];
        delete proxyRes.headers['access-control-allow-methods'];
        delete proxyRes.headers['access-control-allow-headers'];
      },
      error: (err, req, res) => {
        (req.log || logger).error({ err, target, requestId: req.requestId }, 'Proxy error');
        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            status: 'error',
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'Service temporarily unavailable',
            ...(req.requestId && { requestId: req.requestId }),
          });
        }
      },
    },
  });
  return async (req, res, next) => {
    try {
      req.cloudRunAuthHeader = await getAuthHeader(target);
    } catch (err) {
      (req.log || logger).error({ err, target, requestId: req.requestId }, 'Failed to mint Cloud Run ID token');
    }
    return middleware(req, res, next);
  };
};

// ─── Route table ───────────────────────────────────────────────────────────────
const V1 = '/api/v1';

// Auth — apply authLimiter to sensitive auth routes
app.use(`${V1}/auth/login`,          authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth/login-step1`,    authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth/login-step2`,    authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth/resend-otp`,     authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth/register`,       authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth/forgot-password`,authLimiter, proxy(SERVICES.auth));
app.use(`${V1}/auth`,                proxy(SERVICES.auth));

// User management → user-service
app.use(`${V1}/users`,      proxy(SERVICES.user));
app.use(`${V1}/admin`,      proxy(SERVICES.user));
app.use(`${V1}/sales-reps`, proxy(SERVICES.user));
app.use(`${V1}/vendors`,    proxy(SERVICES.user));

// Packages → package-service
app.use(`${V1}/packages/generate-itinerary-preview`, aiItineraryPreviewLimiter, proxy(SERVICES.package));
app.use(`${V1}/packages/itinerary-chat`, itineraryChatLimiter, proxy(SERVICES.package));
// Reuses itineraryChatLimiter (not a separate, stricter ceiling): a wizard
// walkthrough is several turns, same order of magnitude as a chat
// conversation — see docs/designs/ai-trip-planning-assistant.md.
app.use(`${V1}/packages/wizard-turn`, itineraryChatLimiter, proxy(SERVICES.package));
// Reuses itineraryChatLimiter (not a separate, stricter ceiling): per-day
// regeneration is several small calls per session, same order of magnitude
// as a chat conversation — see docs/designs/granular-ai-itinerary-generation.md.
app.use(`${V1}/packages/generate-day-preview`, itineraryChatLimiter, proxy(SERVICES.package));
app.use(`${V1}/packages/generate-days-preview`, itineraryChatLimiter, proxy(SERVICES.package));
app.use(`${V1}/packages`,    proxy(SERVICES.package));
app.use(`${V1}/reviews`,     proxy(SERVICES.package));
app.use(`${V1}/places`,      proxy(SERVICES.package));
app.use(`${V1}/activities`,  proxy(SERVICES.package));
app.use(`${V1}/hotels`,      proxy(SERVICES.package));
app.use(`${V1}/upload`,      proxy(SERVICES.package));

// Leads → lead-service
app.use(`${V1}/leads`, proxy(SERVICES.lead));
app.use(`${V1}/customized-packages`, proxy(SERVICES.lead));
app.use(`${V1}/manual-itineraries`, proxy(SERVICES.lead));

// Bookings → booking-service
app.use(`${V1}/bookings`, proxy(SERVICES.booking));

// Flights (Travelport) → flight-service
app.use(`${V1}/flights`, proxy(SERVICES.flight));

// Billing → billing-service
app.use(`${V1}/billing`,   proxy(SERVICES.billing));
app.use(`${V1}/invoices`,  proxy(SERVICES.billing));
app.use(`${V1}/payments`,  proxy(SERVICES.billing));

// Careers → career-service
app.use(`${V1}/careers`,   proxy(SERVICES.career));
app.use(`${V1}/vacancies`, proxy(SERVICES.career));

//Retell AI Voice call
app.use(`${V1}/webhooks/voice`, proxy(SERVICES.voice));

app.use(`${V1}/webhooks/duffel-flights`, proxy(SERVICES.flight));

// Webhooks & notifications → notification-service
app.use(`${V1}/webhooks`,      proxy(SERVICES.notification));
app.use(`${V1}/notifications`, proxy(SERVICES.notification));

// Analytics & dashboard → analytics-service
app.use(`${V1}/analytics`, proxy(SERVICES.analytics));
app.use(`${V1}/dashboard`, proxy(SERVICES.analytics));
app.use(`${V1}/recommendations`, recommendationsLimiter, proxy(SERVICES.recommendations));

// Site-wide floating assistant → assistant-service. Reuses itineraryChatLimiter
// (not a separate ceiling): a turn here is the same order of magnitude billed
// Gemini cost as a wizard-turn call — see docs/designs/site-wide-floating-assistant.md.
// /events is telemetry-only (no Gemini call), left on the default globalLimiter.
app.use(`${V1}/assistant/turn`, itineraryChatLimiter, proxy(SERVICES.assistant));
app.use(`${V1}/assistant`, proxy(SERVICES.assistant));

app.use(`${V1}/voice`, proxy(SERVICES.voice));
// ─── 404 ───────────────────────────────────────────────────────────────────────
// Generic rather than echoing the method and path back: the response should not
// describe the routing table to whoever asked.
app.use((req, res) =>
  res.status(404).json({
    success: false,
    status: 'fail',
    code: 'NOT_FOUND',
    message: "We couldn't find what you were looking for.",
    ...(req.requestId && { requestId: req.requestId }),
  })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'gateway started');
});

export default app;
