const READ_ONLY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function billingAccessClaims(workspace, now = Date.now()) {
  const claims = {};
  if (workspace.tenantStatus) claims.tenantStatus = workspace.tenantStatus;
  if (workspace.billingSuspended) claims.billingSuspended = true;
  if (
    workspace.tenantStatus === 'past_due'
    && workspace.pastDueAt
    && now >= new Date(workspace.pastDueAt).getTime() + READ_ONLY_AFTER_MS
  ) claims.ro = true;
  return claims;
}
