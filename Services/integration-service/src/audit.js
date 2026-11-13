import { requireTenantId } from '../../shared/tenancy/src/context.js';

export async function recordIntegrationAudit(req, action, summary, integrationId, db = req.db) {
  const tenantId = requireTenantId();
  await db.query(
    `INSERT INTO crm_platform."AuditLog"
       ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId",
        summary, "ipAddress", "requestId")
     VALUES ($1, $2, $3, $4, $5, 'integration', $6, $7, $8, $9)`,
    [
      tenantId,
      req.headers['x-user-id'],
      req.headers['x-user-email'],
      req.headers['x-user-role'],
      action,
      integrationId,
      summary,
      req.headers['x-client-ip'] || req.ip,
      req.requestId || null,
    ],
  );
}
