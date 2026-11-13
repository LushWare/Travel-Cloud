export function requireAgencyAdmin(req, res, next) {
  const role = req.headers['x-user-role'];
  const isOwner = req.headers['x-user-is-super-admin'] === 'true';
  if (!req.headers['x-user-id'] || (!isOwner && role !== 'admin' && role !== 'superAdmin')) {
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Administrator access required' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ success: false, code: 'TENANT_CONTEXT_MISSING', message: 'Agency context is required' });
  }
  return next();
}

export function requireInternalToken(req, res, next) {
  const expected = process.env.INTERNAL_EVENTS_TOKEN;
  if (!expected || req.headers['x-internal-token'] !== expected) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
  }
  return next();
}
