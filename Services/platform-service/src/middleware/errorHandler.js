import logger from '../config/logger.js';

// Written for a user, not an operator: shown whenever the error is not explicitly
// operational, so an unexpected throw can never describe our internals.
const GENERIC_MESSAGE = {
  400: "We couldn't process that request. Please check the details and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for.",
  409: 'That conflicts with an existing record. Please refresh and try again.',
  429: 'Too many requests. Please wait a moment and try again.',
};
const GENERIC_MESSAGE_FALLBACK = 'Something went wrong on our side. Please try again.';

const CODE_BY_STATUS = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  502: 'DEPENDENCY_UNAVAILABLE',
  503: 'DEPENDENCY_UNAVAILABLE',
  504: 'DEPENDENCY_UNAVAILABLE',
};

export default (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const operational = err.isOperational === true;

  const log = req.log || logger;
  if (statusCode >= 500) {
    log.error({ err, requestId: req.requestId, route: req.originalUrl }, 'Unhandled server error');
  } else {
    log.warn({ err: { message: err.message }, requestId: req.requestId }, `Client error: ${err.message}`);
  }

  res.status(statusCode).json({
    success: false,
    status: `${statusCode}`.startsWith('4') ? 'fail' : 'error',
    code: err.code || CODE_BY_STATUS[statusCode] || 'INTERNAL',
    message: operational ? err.message : GENERIC_MESSAGE[statusCode] || GENERIC_MESSAGE_FALLBACK,
    ...(operational && Array.isArray(err.errors) && { errors: err.errors }),
    ...(req.requestId && { requestId: req.requestId }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
