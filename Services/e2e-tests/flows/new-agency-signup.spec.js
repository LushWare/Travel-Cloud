import { describe, it, expect, afterAll } from 'vitest';
import { adminDbConfigured, closeAdminDb, removeTestAgency, setSignupCode, signupApprovalRequired } from '../helpers/agency-db.js';

// A brand-new agency, from sign-up to a paid invoice, through the real Gateway. This is the SaaS
// promise: someone we have never met signs up and can sell a trip the same day, with their own
// numbering, settings and data, seeing nothing of any other agency.
//
// Creates its own throwaway agency ("[E2E-<run>] …", owner e2e-<run>+owner@travelcrm.test) and
// removes it afterwards (helpers/agency-db.js). Skipped unless E2E_ADMIN_DATABASE_URL is set,
// because the emailed sign-up code and the cleanup both need the admin connection.

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000/api/v1';
const runId = (process.env.E2E_RUN_ID || `local${Date.now()}`).replace(/[^A-Za-z0-9-]/g, '');
const ownerEmail = `e2e-${runId}+owner@travelcrm.test`;
const agencyName = `[E2E-${runId}] North Star Travel`;
const CODE = '246810';

let session = '';
let tenantId;

/** Calls the Gateway as the new owner, carrying their login cookie. */
async function call(method, path, body) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-request-id': `e2e-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      ...(session && { authorization: `Bearer ${session}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
  return { status: res.status, body: json, headers: res.headers };
}

const accessTokenFrom = (headers) => {
  const cookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  const access = cookies.map((c) => c.match(/^token=([^;]+)/)).find(Boolean);
  return access ? decodeURIComponent(access[1]) : '';
};

describe.skipIf(!adminDbConfigured()).sequential('a new agency, from sign-up to a paid invoice', () => {
  let leadId;
  let selectionId;
  let quotationId;
  let invoiceId;

  it('offers the Growth plan to sign up for', async () => {
    const res = await call('GET', '/auth/signup-plans');

    expect(res.status).toBe(200);
    expect(res.body.data.map((plan) => plan.key)).toContain('growth');
  });

  it('creates the agency and asks for the emailed code', async () => {
    const res = await call('POST', '/auth/agency-signup', {
      agencyName, ownerName: 'Alex Owner', email: ownerEmail, password: 'E2e-password-123', planKey: 'growth',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ email: ownerEmail, verificationRequired: true });
  });

  it('opens the agency once the email is confirmed', async () => {
    expect(await signupApprovalRequired(), 'turn off "Require approval for new sign-ups" in the Console for this test').toBe(false);
    await setSignupCode(ownerEmail, CODE);

    const res = await call('POST', '/auth/agency-signup/verify', { email: ownerEmail, code: CODE });

    expect(res.status).toBe(200);
    session = accessTokenFrom(res.headers);
    expect(session).not.toBe('');
    tenantId = res.body.data.user.tenant.id;
    expect(res.body.data.user.tenant.name).toBe(agencyName);
  });

  it('starts on its own 14-day Growth trial', async () => {
    const res = await call('GET', '/admin/plan');

    expect(res.status).toBe(200);
    expect(res.body.data.plan.key).toBe('growth');
  });

  it('sees no lead from any other agency', async () => {
    const res = await call('GET', '/leads?limit=100');

    expect(res.status).toBe(200);
    const rows = Array.isArray(res.body.data) ? res.body.data : res.body.data?.leads ?? [];
    expect(rows).toEqual([]);
  });

  it('fills in the company details documents need', async () => {
    const res = await call('PUT', '/admin/settings', {
      companyName: agencyName,
      companyAddress: '1 Harbour Road, Colombo',
      contactEmail: ownerEmail,
      contactPhone: '+94110000000',
      bankName: 'E2E Bank',
      bankAccountName: 'North Star Travel',
      bankAccountNumber: '000111222',
    });

    expect(res.status).toBe(200);
  });

  it('creates its first lead', async () => {
    const res = await call('POST', '/leads', {
      name: `[E2E-${runId}] First Customer`, email: `e2e-${runId}+lead@travelcrm.test`, phone: '+10000000002',
      destination: 'Kandy', numberOfTravelers: 2, message: 'New-agency E2E lead',
    });

    expect(res.status).toBe(201);
    leadId = res.body.data.id;
  });

  it('prices a manual trip for the lead', async () => {
    const selection = await call('POST', `/leads/${leadId}/packages`, { isManual: true });
    expect(selection.status).toBe(201);
    selectionId = selection.body.data.id;
    expect((await call('PUT', `/leads/${leadId}/packages/${selectionId}/itinerary`, { days: [] })).status).toBe(200);

    const res = await call('POST', `/leads/${leadId}/packages/${selectionId}/pricing/apply`, {
      lines: [{ category: 'package', description: 'Trip', basis: 'FIXED', quantity: 1, estimatedUnitPrice: 1000 }],
    });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.pricing.sellSubtotal)).toBeGreaterThan(0);
  });

  it('turns the price into a quotation', async () => {
    const res = await call('POST', `/leads/${leadId}/packages/${selectionId}/quote`);

    expect(res.status).toBe(200);
    quotationId = res.body.data.quotation.id;
    expect(res.body.data.quotation.quotationNumber).toBeTruthy();
  });

  it('turns the accepted quotation into an invoice numbered from its own sequence', async () => {
    expect((await call('POST', `/billing/quotations/${quotationId}/accept`)).status).toBe(200);

    const res = await call('POST', `/billing/quotations/${quotationId}/convert`, {});

    expect(res.status).toBe(201);
    invoiceId = res.body.data.id;
    // A new agency's first invoice: its counter starts at 1, not after Lush's invoices.
    expect(res.body.data.invoiceNumber).toMatch(/0*1$/);
  });

  it('records full payment against the invoice', async () => {
    const invoice = await call('GET', `/billing/invoices/${invoiceId}`);
    const outstanding = Number(invoice.body.data.outstandingAmount);
    expect(outstanding).toBeGreaterThan(0);

    const res = await call('POST', '/billing/receipts', {
      invoiceId, amount: outstanding, paymentMethod: 'cash', paymentType: 'full-payment', notes: 'New-agency E2E payment',
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.data.amount)).toBe(outstanding);
  });

  it('shows the invoice as paid', async () => {
    const res = await call('GET', `/billing/invoices/${invoiceId}`);

    expect(Number(res.body.data.outstandingAmount)).toBe(0);
  });

  afterAll(async () => {
    try {
      await removeTestAgency({ tenantId, ownerEmail });
    } finally {
      await closeAdminDb();
    }
  });
});
