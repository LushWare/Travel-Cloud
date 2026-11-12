import AppError from '../utils/appError.js';
import * as staff from '../db/staff.js';
import { hashToken } from '../security/tokens.js';
import { IDLE_MINUTES, SESSION_COOKIE } from '../controllers/auth.controller.js';

/**
 * Lets a request through only with a live console session. Agency logins and any identity headers
 * are ignored: the only proof accepted here is the console's own session cookie.
 *
 * While someone still has a temporary password, only the routes that set a new one are open
 * (`allowPendingPasswordChange`); everything else is refused on the server, not just hidden.
 */
export const platformSession = ({ allowPendingPasswordChange = false } = {}) => async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await staff.findLiveSession(hashToken(token), { idleMinutes: IDLE_MINUTES }) : null;
    if (!session) return next(new AppError('Your session has expired. Please sign in again.', 401));
    await staff.touchSession(session.sessionId);
    req.platformSessionId = session.sessionId;
    req.platformUser = {
      id: session.id, email: session.email, name: session.name, role: session.role,
      mustChangePassword: Boolean(session.mustChangePassword),
    };
    if (req.platformUser.mustChangePassword && !allowPendingPasswordChange) {
      return next(new AppError('Set your own password before continuing.', 403, { code: 'PASSWORD_CHANGE_REQUIRED' }));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

/** The default for every console route. */
export const requirePlatformSession = platformSession();

/** Limits a route to the given platform roles. */
export const requirePlatformRole = (...roles) => (req, res, next) =>
  (roles.includes(req.platformUser?.role) ? next() : next(new AppError("You don't have permission to do that.", 403)));
