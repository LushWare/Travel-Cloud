import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { FORBIDDEN } from '../constants/httpStatus.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';
import { composeNotifications } from './compose.js';
import { NOTIFICATION_SIGNAL_KEYS } from './rules.js';
import { fetchBusinessSignals } from './signalsClient.js';
import { loadNotificationState, markNotificationsSeen } from './state.js';

const SIGNAL_TIMEOUT_MS = 12_000;
const MANAGEMENT_ROLES = new Set(['admin', 'superAdmin', 'salesRep']);

function notificationsEnabled() {
  return process.env.MANAGEMENT_NOTIFICATIONS_ENABLED === 'true';
}

function notFound(res) {
  return res.status(404).json({ success: false, message: 'Not found' });
}

function assertManagementRole(user) {
  if (!user?.isSuperAdmin && !MANAGEMENT_ROLES.has(user?.role)) {
    throw new AppError('Not authorized', FORBIDDEN);
  }
}

async function readCurrent(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
  try {
    const data = await fetchBusinessSignals(req, controller.signal);
    return {
      scope: data.scope,
      currency: data.currency,
      signals: data.signals,
      unavailableSignals: [],
    };
  } catch (error) {
    logger.warn({ err: error, actorId: req.user.id }, 'Business notification signals unavailable');
    return {
      scope: req.user.role === 'salesRep' && !req.user.isSuperAdmin ? 'own' : 'org',
      currency: process.env.BUSINESS_REPORTING_CURRENCY || 'USD',
      signals: {},
      unavailableSignals: [...NOTIFICATION_SIGNAL_KEYS],
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function currentNotifications(req) {
  const [reading, priorState] = await Promise.all([
    readCurrent(req),
    loadNotificationState({ prisma, actorId: req.user.id }),
  ]);
  const composed = composeNotifications({
    signals: reading.signals,
    scope: reading.scope,
    currency: reading.currency,
    priorState,
    unavailableSignals: reading.unavailableSignals,
  });
  return { ...reading, ...composed };
}

export const getManagementNotifications = asyncHandler(async (req, res) => {
  if (!notificationsEnabled()) return notFound(res);
  assertManagementRole(req.user);

  const result = await currentNotifications(req);
  return res.json({
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      scope: result.scope,
      currency: result.currency,
      notifications: result.notifications,
      unreadCounts: result.unreadCounts,
      unavailableSignals: result.unavailableSignals,
    },
  });
});

export const updateManagementNotifications = asyncHandler(async (req, res) => {
  if (!notificationsEnabled()) return notFound(res);
  assertManagementRole(req.user);

  const { keys, action } = req.body;
  let materialValuesByKey = new Map();
  if (action !== 'read') {
    const current = await currentNotifications(req);
    materialValuesByKey = new Map(
      current.notifications
        .filter((notification) => keys.includes(notification.key))
        .map((notification) => [notification.key, notification.materialValue]),
    );
  }

  const updated = await markNotificationsSeen({
    prisma,
    actorId: req.user.id,
    keys,
    action,
    materialValuesByKey,
  });
  return res.json({ success: true, data: { updated } });
});
