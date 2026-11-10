import { requireTenantId } from './context.js';
import { DEMO_TENANT_ID } from '../../constants/src/index.js';

const ROOT = 'travel-crm/tenants';

/** The file-storage folder for one kind of upload, inside the current agency's own folder. */
export const agencyFolder = (kind, tenantId = requireTenantId()) => `${ROOT}/${tenantId}/${kind}`;

/**
 * Whether a stored file belongs to the current agency. Files from before agencies existed sit
 * outside the tenants folder and belong to the demo agency, which owns all of that data.
 */
export function isAgencyFile(publicId, tenantId = requireTenantId()) {
  if (typeof publicId !== 'string' || publicId.includes('..')) return false;
  if (publicId.startsWith(`${ROOT}/`)) return publicId.startsWith(`${ROOT}/${tenantId}/`);
  return tenantId === DEMO_TENANT_ID;
}
