/**
 * Phase 1 gate: one agency can never reach another agency's data.
 *
 * Needs the Phase 1 migrations applied and `node Services/seed-demo.mjs` run, which gives
 * acme-tours and globe-dmc each their own copy of the same book of business (same customer
 * names, package slugs and invoice numbers). An acme-tours admin then tries to list, open,
 * edit, delete, search and download globe-dmc's records; every attempt must come back empty
 * or "not found", and globe-dmc's records must be unchanged afterwards.
 *
 * Writes nothing on success. A failure here means an isolation bug, not a flaky test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { apiClient } from '../helpers/api-client.js';

const ACME = 'acmeAdmin';
const GLOBE = 'globeAdmin';

// Lists come back in several shapes; the records are the array of objects with an id.
function rowsOf(body) {
  const data = body?.data ?? body;
  if (Array.isArray(data)) return data;
  for (const value of Object.values(data || {})) {
    if (Array.isArray(value) && value.length && value.every((r) => r && typeof r === 'object' && 'id' in r)) return value;
  }
  return [];
}
// The seed's consultant really is a member of both agencies, so appears in both staff lists.
const SHARED_EMAILS = new Set(['consultant@lushtravelcloud.com']);
const idsOf = (body) => rowsOf(body).filter((r) => !SHARED_EMAILS.has(r.email)).map((r) => r.id);

const RESOURCES = [
  { name: 'lead', list: '/leads?limit=100', item: (id) => `/leads/${id}`, update: { notes: 'isolation probe' } },
  { name: 'quotation', list: '/billing/quotations?limit=100', item: (id) => `/billing/quotations/${id}`, pdf: (id) => `/billing/quotations/${id}/pdf` },
  { name: 'invoice', list: '/billing/invoices?limit=100', item: (id) => `/billing/invoices/${id}`, pdf: (id) => `/billing/invoices/${id}/pdf`, update: { notes: 'isolation probe' } },
  { name: 'receipt', list: '/billing/receipts?limit=100', item: (id) => `/billing/receipts/${id}`, pdf: (id) => `/billing/receipts/${id}/pdf` },
  { name: 'voucher', list: '/billing/vouchers?limit=100', item: (id) => `/billing/vouchers/${id}`, pdf: (id) => `/billing/vouchers/${id}/pdf` },
  // booking-service has no single-booking route; the staff list is /bookings/recent.
  { name: 'booking', list: '/bookings/recent?limit=50' },
  { name: 'package', list: '/packages?limit=100', item: (id) => `/packages/${id}` },
  { name: 'staff account', list: '/admin/users?limit=100', item: (id) => `/admin/users/${id}` },
];

const globe = {};
const acme = {};
const listStatus = {};

// One list at a time: firing them all at once queues requests behind each service's few database connections.
beforeAll(async () => {
  for (const r of RESOURCES) {
    const g = await apiClient.get(r.list, { role: GLOBE });
    const a = await apiClient.get(r.list, { role: ACME });
    globe[r.name] = idsOf(g.body);
    acme[r.name] = idsOf(a.body);
    listStatus[r.name] = { globe: g.status, acme: a.status };
  }
}, 240_000);

describe('tenant isolation: acme-tours cannot reach globe-dmc', () => {
  it.each(RESOURCES.map((r) => [r.name]))('globe-dmc has %s records to probe (seed-demo.mjs has run)', (name) => {
    expect(listStatus[name].globe, `listing globe-dmc ${name} records failed (429 = gateway rate limit, wait 15 min)`).toBe(200);
    expect(globe[name].length, `run node Services/seed-demo.mjs first: globe-dmc has no ${name} records`).toBeGreaterThan(0);
  });

  it.each(RESOURCES.map((r) => [r.name]))('acme-tours sees its own %s records, none of globe-dmc\'s', (name) => {
    expect(listStatus[name].acme, `listing acme-tours ${name} records failed`).toBe(200);
    expect(acme[name].length).toBeGreaterThan(0);
    expect(acme[name].filter((id) => globe[name].includes(id))).toEqual([]);
  });

  // The owner's 200 proves the route exists, so acme-tours' 404 means "not yours", not "no such route".
  it.each(RESOURCES.filter((r) => r.item).map((r) => [r.name, r]))('opening a globe-dmc %s answers 404', async (_name, r) => {
    const url = r.item(globe[r.name][0]);
    const own = await apiClient.get(url, { role: GLOBE });

    const res = await apiClient.get(url, { role: ACME });

    expect(own.status).toBe(200);
    expect(res.status).toBe(404);
  });

  it.each(RESOURCES.filter((r) => r.update).map((r) => [r.name, r]))('editing a globe-dmc %s answers 404 and changes nothing', async (_name, r) => {
    const target = globe[r.name][0];
    const before = await apiClient.get(r.item(target), { role: GLOBE });

    const res = await apiClient.put(r.item(target), { role: ACME, body: r.update });
    const after = await apiClient.get(r.item(target), { role: GLOBE });

    expect(res.status).toBe(404);
    expect(after.body?.data).toEqual(before.body?.data);
  });

  it('deleting a globe-dmc lead answers 404 and the lead survives', async () => {
    const target = globe.lead[0];

    const res = await apiClient.delete(`/leads/${target}`, { role: ACME });
    const after = await apiClient.get(`/leads/${target}`, { role: GLOBE });

    expect(res.status).toBe(404);
    expect(after.status).toBe(200);
  });

  it.each(RESOURCES.filter((r) => r.pdf).map((r) => [r.name, r]))('downloading the PDF of a globe-dmc %s answers 404', async (_name, r) => {
    const res = await apiClient.get(r.pdf(globe[r.name][0]), { role: ACME });

    expect(res.status).toBe(404);
  });

  it.each([
    ['invoices', (id) => `/billing/invoices/lead/${id}`],
    ['receipts', (id) => `/billing/receipts/lead/${id}`],
    ['vouchers', (id) => `/billing/vouchers/lead/${id}`],
    ['quotations', (id) => `/billing/quotations/lead/${id}`],
  ])('the %s of a globe-dmc lead are invisible to acme-tours', async (_name, path) => {
    const res = await apiClient.get(path(globe.lead[0]), { role: ACME });

    expect(res.status === 404 || rowsOf(res.body).length === 0).toBe(true);
  });

  it('searching for a name both agencies have returns only acme-tours\' own leads', async () => {
    const lead = await apiClient.get(`/leads/${globe.lead[0]}`, { role: GLOBE });
    const name = lead.body?.data?.name ?? lead.body?.data?.lead?.name;
    expect(name, 'globe-dmc lead has a name to search for').toBeTruthy();

    const res = await apiClient.get(`/leads/search?query=${encodeURIComponent(name)}`, { role: ACME });

    expect(idsOf(res.body).filter((id) => globe.lead.includes(id))).toEqual([]);
  });

  it('acme-tours\' dashboard counts only its own leads', async () => {
    const res = await apiClient.get('/dashboard/stats', { role: ACME });
    const total = Number(res.body?.data?.leads?.total);

    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeLessThan(acme.lead.length + globe.lead.length);
  });

  it('a forged agency header does not switch acme-tours into globe-dmc', async () => {
    const res = await apiClient.get(`/leads/${globe.lead[0]}`, {
      role: ACME,
      headers: { 'x-tenant-id': '00000000-0000-4000-8000-000000000003' },
    });

    expect(res.status).toBe(404);
  });
});
