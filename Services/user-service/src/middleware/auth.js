import AppError from '../utils/appError.js';

export const extractUser = (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (userId) {
    req.user = {
      id: userId,
      role: req.headers['x-user-role'],
      email: req.headers['x-user-email'],
      name: req.headers['x-user-name'],
      permissions: JSON.parse(req.headers['x-user-permissions'] || '[]'),
      isSuperAdmin: req.headers['x-user-is-super-admin'] === 'true',
      tenantId: req.headers['x-tenant-id'] || null,
    };
  }
  next();
};

export const requireAuth = (req, res, next) => {
  if (!req.user) return next(new AppError('Not authorized to access this route', 401));
  next();
};

export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError('Not authorized', 401));
  if (req.user.isSuperAdmin || roles.includes(req.user.role)) return next();
  next(new AppError(`Role '${req.user.role}' is not authorized to access this route`, 403));
};
