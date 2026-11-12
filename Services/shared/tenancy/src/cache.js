import { getTenantId } from './context.js';

export function createTenantCache({ ttlMs, maxEntries = 1000 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('createTenantCache needs a positive ttlMs');
  const entries = new Map(); // tenantId -> { value, expiresAt }

  const evictIfFull = () => {
    if (entries.size < maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  };

  return {
    get() {
      const tenantId = getTenantId();
      const entry = tenantId ? entries.get(tenantId) : undefined;
      return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
    },
    getStale() {
      const tenantId = getTenantId();
      return tenantId ? entries.get(tenantId)?.value : undefined;
    },
    set(value) {
      const tenantId = getTenantId();
      if (!tenantId) return;
      evictIfFull();
      entries.set(tenantId, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
  };
}
