const MANAGEMENT_ROLES = new Set(['admin', 'superAdmin', 'salesRep']);

export function extractActor(req, res, next) {
  const actorId = req.headers['x-user-id'];
  const role = req.headers['x-user-role'];
  if (typeof actorId === 'string' && typeof role === 'string' && MANAGEMENT_ROLES.has(role)) {
    let permissions = [];
    try {
      const parsed = JSON.parse(req.headers['x-user-permissions'] || '[]');
      if (Array.isArray(parsed)) permissions = parsed.filter((item) => typeof item === 'string').slice(0, 64);
    } catch {
      permissions = [];
    }
    req.actor = {
      id: actorId,
      role,
      permissions,
      isSuperAdmin: req.headers['x-user-is-super-admin'] === 'true',
    };
  }
  next();
}

export function requireActor(req, res, next) {
  if (!req.actor) return res.status(401).json({ success: false, message: 'Not authorized' });
  return next();
}