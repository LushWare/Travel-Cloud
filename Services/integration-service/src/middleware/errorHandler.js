import logger from '../config/logger.js';

export default function errorHandler(err, req, res, _next) {
  const log = req.log || logger;
  log.error({
    ...(err.code === 'TENANT_CONTEXT_MISSING'
      ? { alertType: 'missing_tenant_context', errorCode: err.code }
      : {}),
    errorName: err.name,
    requestId: req.requestId,
  }, 'Integration request failed');
  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
    ...(req.requestId && { requestId: req.requestId }),
  });
}
