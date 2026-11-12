// The console talks only to /api/v1/platform/* through the gateway. Its session lives in an
// http-only cookie the browser sends automatically; nothing is kept in local storage.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/api/v1' : 'https://api.lushtravelcloud.com/api/v1');

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  role: 'platform_admin' | 'support';
  mustChangePassword?: boolean;
};

export type PlatformStaff = {
  id: string;
  email: string;
  name: string;
  role: PlatformUser['role'];
  isActive: boolean;
  authenticatorSetupRequired: boolean;
  setupPurpose: 'invite' | 'authenticator_reset' | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type StaffSetupInfo = {
  email: string;
  name: string;
  purpose: 'invite' | 'authenticator_reset';
  requiresPassword: boolean;
  secret: string;
  otpauthUri: string;
};

export const MIN_PASSWORD_LENGTH = 12;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type AgencyStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'pending_deletion' | 'deleted';
export type AgencySort = 'name' | 'created' | 'activity' | 'staff';

export type AgencyRow = {
  id: string; name: string; slug: string; status: AgencyStatus; createdAt: string;
  ownerName: string | null; ownerEmail: string | null;
  staff: number; admins: number; salesReps: number; vendors: number;
  lastActivityAt: string | null;
  // Null means no plan: the agency gets everything, unlimited, until one is assigned.
  planName?: string | null;
};

export type AgencyDetail = {
  agency: { id: string; name: string; slug: string; status: AgencyStatus; region: string; createdAt: string };
  isPublicSite: boolean;
  people: {
    total: number;
    byRole: { owners: number; admins: number; salesReps: number; vendors: number };
    byStatus: { active: number; invited: number; suspended: number };
  };
  owners: { name: string; email: string; status: string; lastLogin: string | null }[];
  usage: Record<'leads' | 'quotations' | 'invoices' | 'bookings' | 'packages', { total: number; thisMonth: number }>;
  activity: { lastActivityAt: string | null; activeUsers7d: number; activeUsers30d: number };
  setup: { companyDetails: boolean; logo: boolean; bankDetails: boolean };
  history: { id: string; action: string; summary: string; actorEmail: string | null; createdAt: string }[];
  plan: AgencyPlan;
};

export type PlanEntitlements = {
  staff_seats: number | null;
  packages: number | null;
  features: Record<'ai_itinerary_builder', boolean>;
};

export type PlanVersion = {
  id: string;
  planId: string;
  version: number;
  name: string;
  description: string | null;
  priceMinorUnits: number | null;
  currency: string;
  billingInterval: 'monthly' | 'annual' | null;
  entitlements: PlanEntitlements;
  isCurrent: boolean;
  assignments: number;
};

export type PlanCatalogItem = {
  id: string;
  key: string;
  archivedAt: string | null;
  createdAt: string;
  versions: PlanVersion[];
};

export type AgencyPlan = {
  assignment: null | {
    planVersionId: string;
    priceMinorUnits: number | null;
    currency: string;
    assignedAt: string;
    assignedById: string | null;
    planId: string;
    key: string;
    version: number;
    name: string;
    description: string | null;
    billingInterval: string | null;
    entitlements: PlanEntitlements;
    isCurrent: boolean;
  };
  overrides: { id: string; entitlementKey: string; value: number | boolean; reason: string; changedById: string | null; updatedAt: string }[];
  resolved: {
    plan: { id: string; key: string | null; versionId: string; version: number; name: string; description: string | null; priceMinorUnits: number | null; currency: string; billingInterval: string | null } | null;
    entitlements: PlanEntitlements;
    source: Record<string, 'default' | 'plan' | 'override'>;
  };
};

export type PlanInput = Omit<PlanVersion, 'id' | 'planId' | 'version' | 'isCurrent' | 'assignments'>;

export type Page<T> = { rows: T[]; pagination: { page: number; limit: number; total: number; pages: number } };

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

export async function platformRequest<T>(path: string, init: { method?: string; body?: unknown; withPagination?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/platform${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(payload?.message || FALLBACK_MESSAGE, res.status);
  return (init.withPagination ? { rows: payload?.data, pagination: payload?.pagination } : payload?.data) as T;
}

/** The one-time link that opens Management as a view-only help session (auth-service redeems it). */
export const helpAccessUrl = (code: string) => `${API_BASE_URL}/auth/help-access/redeem?code=${encodeURIComponent(code)}`;

export const agencyApi = {
  list: (query: { search?: string; status?: AgencyStatus | ''; sort?: AgencySort; page?: number; limit?: number }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
    return platformRequest<Page<AgencyRow>>(`/agencies?${params}`, { withPagination: true });
  },
  get: (id: string) => platformRequest<AgencyDetail>(`/agencies/${encodeURIComponent(id)}`),
  assignPlan: (id: string, input: { planVersionId: string; priceMinorUnits?: number | null; currency?: string; reason: string }) =>
    platformRequest<unknown>(`/agencies/${encodeURIComponent(id)}/plan`, { method: 'PUT', body: input }),
  setOverride: (id: string, key: string, input: { value: number | boolean; reason: string }) =>
    platformRequest<unknown>(`/agencies/${encodeURIComponent(id)}/overrides/${encodeURIComponent(key)}`, { method: 'PUT', body: input }),
  removeOverride: (id: string, key: string, reason: string) =>
    platformRequest<unknown>(`/agencies/${encodeURIComponent(id)}/overrides/${encodeURIComponent(key)}`, { method: 'DELETE', body: { reason } }),
  suspend: (id: string, reason: string) =>
    platformRequest<{ agency: { status: AgencyStatus } }>(`/agencies/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: { reason } }),
  startHelp: (id: string, reason: string, minutes: 15 | 30) =>
    platformRequest<{ grantId: string; expiresAt: string; code: string }>(`/agencies/${encodeURIComponent(id)}/help-access`, { method: 'POST', body: { reason, minutes } }),
  restore: (id: string, reason: string) =>
    platformRequest<{ agency: { status: AgencyStatus } }>(`/agencies/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { reason } }),
};

export const plansApi = {
  list: () => platformRequest<PlanCatalogItem[]>('/plans'),
  create: (input: PlanInput & { key: string }) => platformRequest<PlanCatalogItem>('/plans', { method: 'POST', body: input }),
  createVersion: (id: string, input: PlanInput) => platformRequest<PlanVersion>(`/plans/${encodeURIComponent(id)}/versions`, { method: 'POST', body: input }),
  duplicate: (id: string, input: { key: string; name: string }) => platformRequest<PlanCatalogItem>(`/plans/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: input }),
  archive: (id: string) => platformRequest<{ id: string; archived: true }>(`/plans/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
};

export const authApi = {
  me: () => platformRequest<{ user: PlatformUser }>('/auth/me'),
  login: (email: string, password: string) =>
    platformRequest<{ mfaRequired: true; challenge: string }>('/auth/login', { method: 'POST', body: { email, password } }),
  verifyCode: (challenge: string, code: string) =>
    platformRequest<{ user: PlatformUser }>('/auth/mfa', { method: 'POST', body: { challenge, code } }),
  logout: () => platformRequest<unknown>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    platformRequest<{ user: PlatformUser }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  getStaffSetup: (token: string) => platformRequest<StaffSetupInfo>('/auth/setup/details', { method: 'POST', body: { token } }),
  completeStaffSetup: (token: string, code: string, password?: string) =>
    platformRequest<{ completed: boolean }>('/auth/setup', { method: 'POST', body: { token, code, ...(password ? { password } : {}) } }),
};

export const staffApi = {
  list: () => platformRequest<PlatformStaff[]>('/staff'),
  invite: (input: { email: string; name: string; role: PlatformStaff['role'] }) =>
    platformRequest<PlatformStaff>('/staff', { method: 'POST', body: input }),
  resendInvite: (id: string) => platformRequest<PlatformStaff>(`/staff/${encodeURIComponent(id)}/resend-invite`, { method: 'POST' }),
  changeRole: (id: string, role: PlatformStaff['role']) =>
    platformRequest<PlatformStaff>(`/staff/${encodeURIComponent(id)}/role`, { method: 'PUT', body: { role } }),
  resetAuthenticator: (id: string) => platformRequest<PlatformStaff>(`/staff/${encodeURIComponent(id)}/reset-authenticator`, { method: 'POST' }),
  deactivate: (id: string) => platformRequest<PlatformStaff>(`/staff/${encodeURIComponent(id)}/deactivate`, { method: 'POST' }),
  delete: (id: string) => platformRequest<{ id: string; email: string; name: string; role: PlatformStaff['role']; deleted: true }>(`/staff/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
