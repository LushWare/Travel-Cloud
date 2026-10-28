import { domainAuthHeader } from '../utils/cloudRunAuth.js';

const BASE = () => process.env.PACKAGE_SERVICE_URL || 'http://localhost:3003';
const TIMEOUT_MS = 3000;
const MAX_RESULTS = 5;
export const PACKAGE_PRICE_SNAPSHOT = Symbol.for('packagePriceSnapshot');

export async function searchPackages(query, requestId) {
  const q = String(query || '').trim();
  if (!q) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE()}/api/v1/packages/search/query?q=${encodeURIComponent(q)}`, {
      headers: {
        ...(await domainAuthHeader(BASE())),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.slice(0, MAX_RESULTS).map((p) => {
      const result = {
        packageId: p.id,
        title: p.title,
        destination: p.destination,
        durationDays: p.durationDays ?? null,
        summary: p.description ? String(p.description).slice(0, 400) : null,
      };
      const priceSnapshot = Number(p.sellPrice);
      Object.defineProperty(result, PACKAGE_PRICE_SNAPSHOT, {
        value: Number.isFinite(priceSnapshot) ? priceSnapshot : null,
      });
      return result;
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
