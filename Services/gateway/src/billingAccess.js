const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOGOUT_PATH = '/api/v1/auth/logout';
const BILLING_PATH = /^\/api\/v1\/auth\/billing(?:\/|$)/;
const BILLING_RECOVERY_PATH = /^\/api\/v1\/auth\/billing(?:\/|$)/;
const SUSPENDED_BILLING_READS = new Set(['/api/v1/auth/me', '/api/v1/auth/billing']);

export function billingAccessFailure(method, path, user) {
  if (!user?.tenantStatus) return null;
  if (path === LOGOUT_PATH) return null;

  if (user.tenantStatus === 'suspended') {
    if (user.billingSuspended && (
      SUSPENDED_BILLING_READS.has(path)
      || (method === 'POST' && BILLING_RECOVERY_PATH.test(path))
    )) return null;
    return {
      code: 'AGENCY_SUSPENDED',
      message: 'This agency is suspended. Contact the agency owner or support for help.',
    };
  }

  if (['pending_deletion', 'deleted'].includes(user.tenantStatus)) {
    return {
      code: 'AGENCY_UNAVAILABLE',
      message: 'This agency is unavailable.',
    };
  }

  if (user.ro && !SAFE_METHODS.has(method) && !(method === 'POST' && BILLING_PATH.test(path))) {
    return {
      code: 'AGENCY_READ_ONLY',
      message: 'Your agency is read-only while its subscription is past due. Update billing to restore changes.',
    };
  }
  return null;
}
