import { z } from 'zod';
import { LEAD_RECORD_FIELDS } from '@travel-crm/contracts';
import { domainAuthHeader } from '../utils/cloudRunAuth.js';
import { ROUTE_PARAM_RULES } from '../ai/routeParams.js';
import { serializeToolResult } from '../ai/prompts/managementAnswer.v2.js';

// ─── Domain tool registry ─────────────────────────────────────────────────
// The model selects from this fixed, allowlisted tool vocabulary; the server
// executes each tool under the caller's forwarded x-user-* identity and
// returns bounded, allowlisted results. The model never receives database
// credentials, raw SQL, or arbitrary URLs — only these named tools.
//
// Every tool declares its bound NEXT TO ITS SCHEMA, and the execution layer
// enforces it before a result can reach the prompt:
//
//   projection        the allowlisted fields a row may carry
//   rowCap            the most rows that may leave the tool
//   resultByteBudget  the most bytes `serializeToolResult` may produce for it
//
// The prompt splices every tool result into the next request and
// `serializeToolResult` stringifies whatever it is handed, so an unbounded
// list is the first thing in this system that can blow the prompt. A tool
// added without all three declarations is an unbounded tool.
//
// Platform auth is per TARGET service, never a constant: `fetchJson` derives
// both the request URL and the ID-token audience from the base it is handed.
// A tool for another service built on a hardcoded audience would present a
// lead-audience token to that service, pass locally (K_SERVICE unset makes
// `domainAuthHeader` return `{}`) and be rejected at the Cloud Run edge with
// a 403 deployed — surfacing as `notAuthorized`.

// Service base URLs are read at CALL time, not import time, so a test or a
// deployment can point a tool at another host without re-importing the module
// (the collection engine reads its source URLs the same way).
function leadServiceUrl() {
  return process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
}

function billingServiceUrl() {
  return process.env.BILLING_SERVICE_URL || 'http://localhost:3006';
}

function analyticsServiceUrl() {
  return process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3009';
}

function packageServiceUrl() {
  return process.env.PACKAGE_SERVICE_URL || 'http://localhost:3003';
}

// The engine's own ceiling for a page of records (collectionEngine
// `maxFetchRows`). No tool may emit more rows than this, so a tool result can
// never outgrow the read a page adapter already performs.
export const MAX_TOOL_ROWS = 1_000;

// A list tool's page when the model does not ask for one. Deliberately smaller
// than the cap: the model is answering a question, not paging a table.
const DEFAULT_LIST_LIMIT = 50;

// Measured with the exact serializer the prompt uses, so the declared bound
// and the guarantee cannot drift apart.
const LIST_RESULT_BYTE_BUDGET = 64_000;
const RECORD_RESULT_BYTE_BUDGET = 8_000;

// The lead field allowlist keeps tool output bounded to CRM record facts.
const LEAD_PROJECTION = [...LEAD_RECORD_FIELDS];

// Billing fields that answer "what is overdue and what is still outstanding".
// Drawn from the descriptor's invoice allowlist; `overdue` is DERIVED below and
// is not an upstream field. `status` is deliberately absent — the document
// lifecycle never receives `partial`/`overdue`, so payment truth is read from
// `paymentStatus` only.
const INVOICE_PROJECTION = [
  'id',
  'invoiceNumber',
  'customerEmail',
  'leadId',
  'currency',
  'paymentStatus',
  'totalAmount',
  'paidAmount',
  'outstandingAmount',
  'dueDate',
  'overdue',
];

// A document that was never issued (draft) or has been withdrawn (cancelled) is
// not late money. `status` is the issuance lifecycle — draft/sent/viewed/
// cancelled, per the billing descriptor's field trap 1 — which is exactly the
// question being asked here, and a different one from payment truth (that stays
// `paymentStatus`). Stated as the two values to EXCLUDE rather than the three to
// include, because billing-service's own `status IN ('sent','partial','overdue')`
// (invoice.controller.js:259, billing.controller.js:45) silently misses `viewed`.
const INVOICE_UNISSUED_STATUSES = ['draft', 'cancelled'];

function project(record, fields) {
  const out = {};
  for (const field of fields) out[field] = record?.[field] ?? null;
  return out;
}

// Projects, caps and byte-bounds a row list into the shape a tool returns.
// Byte accounting uses `serializeToolResult` (the same envelope the prompt
// serializes) and reserves the truncation flag's bytes up front, so a trimmed
// result still fits its declared budget. Rows are dropped from the tail, and
// `truncated` is set whenever anything was dropped — a silent partial list
// would let the model state a wrong count.
function boundResult(tool, records) {
  const projected = records.slice(0, tool.rowCap).map((record) => project(record, tool.projection));
  const baseBytes = Buffer.byteLength(serializeToolResult(tool.name, { data: [] }), 'utf8');
  const flagOverhead =
    Buffer.byteLength(serializeToolResult(tool.name, { data: [], truncated: true }), 'utf8') - baseBytes;
  let bytes = baseBytes + flagOverhead;
  let kept = 0;
  for (const row of projected) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + (kept > 0 ? 1 : 0);
    if (bytes + rowBytes > tool.resultByteBudget) break;
    bytes += rowBytes;
    kept += 1;
  }
  const truncated = records.length > tool.rowCap || kept < projected.length;
  const data = projected.slice(0, kept);
  return truncated ? { data, truncated: true } : { data };
}

// Fetches one JSON envelope from `baseUrl`+`path` under the caller's forwarded
// identity. `baseUrl` supplies the token audience as well as the origin.
// A 3xx is refused (`redirect: 'error'`), never followed: following one would
// re-send the caller's forwarded x-user-* identity to whatever origin the
// target service names — undici strips `Authorization` cross-origin but keeps
// custom headers. `signal` bounds the read to the ask loop's remaining budget.
async function fetchJson(baseUrl, path, ctx, signal) {
  const auth = await domainAuthHeader(baseUrl);
  const url = new URL(path, baseUrl).toString();
  const res = await fetch(url, {
    headers: { ...ctx.headers, 'content-type': 'application/json', ...auth },
    redirect: 'error',
    signal,
  });
  if (res.status === 403 || res.status === 404) {
    return { notAuthorized: true };
  }
  if (!res.ok) {
    return { unavailable: true };
  }
  const json = await res.json();
  // `total` is the envelope's match count, which the list endpoints report
  // independently of the page they were asked for. Carried through because it
  // is the only authoritative count in this system — a tool that needs one must
  // read it here rather than recompute it from a page of rows. Callers that do
  // not ask for it are unaffected.
  const total = Number(json?.total);
  return { data: json?.data ?? null, ...(Number.isFinite(total) ? { total } : {}) };
}

const getLeadTool = {
  name: 'getLead',
  description: 'Fetch one lead record (id, status, assignment, name, destination, budget).',
  argsSchema: z.object({ leadId: z.string().min(1).max(255) }).strict(),
  projection: LEAD_PROJECTION,
  rowCap: 1,
  resultByteBudget: RECORD_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(leadServiceUrl(), `/api/v1/leads/${encodeURIComponent(args.leadId)}`, ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getLeadTool, result.data ? [result.data] : []);
  },
};

const listLeadsTool = {
  name: 'listLeads',
  description:
    'List leads (id, status, owner, name, destination, budget, timestamps). Use `limit` to bound how many are returned.',
  argsSchema: z.object({ limit: z.number().int().min(1).max(MAX_TOOL_ROWS).optional() }).strict(),
  projection: LEAD_PROJECTION,
  rowCap: MAX_TOOL_ROWS,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const limit = args.limit ?? DEFAULT_LIST_LIMIT;
    const result = await fetchJson(leadServiceUrl(), `/api/v1/leads?limit=${limit}`, ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    const rows = Array.isArray(result.data) ? result.data : [];
    return boundResult(listLeadsTool, rows);
  },
};

// Billing has no endpoint that can order by dueDate (`getAllInvoices` hardcodes
// `createdAt: 'desc'` and takes no sort parameter) and the one dueDate-ascending
// query (`getOverdueInvoices`) gates on the document `status` field, which never
// receives `partial`/`overdue` — so that query would silently miss every
// part-paid invoice. The tool therefore reads a capped page and does its own
// filtering and ordering: unpaid/partial only, dueDate ascending, with the
// overdue flag derived from dueDate at read time (never trusted from a stored
// status).
const listInvoicesTool = {
  name: 'listInvoices',
  description:
    'List invoices that are unpaid or part-paid (id, number, customer, amounts, payment status, due date, overdue flag), most overdue first. Cancelled invoices are never included, and `overdue` means the document was issued — not a draft, not cancelled — and its due date has passed: the same invoices the page counts as overdue, so these numbers match it. Reads the WHOLE book by default and needs no page context. When it read the whole book the result also carries `total` and `overdueTotal` — the invoice counts an answer may state. Pass `leadId` ONLY when the question names one specific lead — never to narrow an invoice question down to whatever lead happens to be on screen, which returns nothing and reads as "invoices are unavailable". Use `limit` to bound how many are returned.',
  argsSchema: z
    .object({
      limit: z.number().int().min(1).max(MAX_TOOL_ROWS).optional(),
      // The model reached for this argument constantly — "which of this lead's
      // invoices are overdue" is a real question and the endpoint for it already
      // existed. Without it the call was rejected, the model repeated it
      // identically, and the loop burned its budget on schema errors before
      // producing nothing.
      // Its way of saying "no lead in particular" is an empty string (or null),
      // and rejecting that costs the whole answer: live, `{ leadId: "" }` made the
      // loop repeat the identical call three times and then report "tool calls
      // failed due to invalid arguments" for a plain "tell me about those
      // invoices". Absent and empty mean the same thing to the endpoint, so both
      // read the whole book.
      leadId: z.preprocess(
        (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value),
        z.string().min(1).max(255).optional(),
      ),
    })
    .strict(),
  projection: INVOICE_PROJECTION,
  rowCap: MAX_TOOL_ROWS,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const url = args.leadId
      ? `/api/v1/billing/invoices/lead/${encodeURIComponent(args.leadId)}`
      : `/api/v1/billing/invoices?limit=${MAX_TOOL_ROWS}`;
    const result = await fetchJson(billingServiceUrl(), url, ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    const now = Date.now();
    // The by-lead endpoint returns one record rather than a list, so a single
    // object is wrapped rather than silently discarded as "no rows".
    const raw = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    const rows = raw
      .filter((row) => row?.paymentStatus === 'unpaid' || row?.paymentStatus === 'partial')
      // A cancelled document is not money anyone can chase, and billing's own
      // counts leave it out. Counting it as overdue is how this tool told an
      // operator there were 23 overdue invoices when the invoices page, reading
      // the same table, said 15.
      .filter((row) => row?.status !== 'cancelled' && !row?.cancelledAt)
      .map((row) => {
        // Parse each dueDate once and carry the numeric value for the sort
        // below — re-parsing both operands per comparison cost 2·n·log n
        // Date.parse calls over a 1000-row page.
        const dueAt = Date.parse(row?.dueDate);
        // "Overdue" is billing-service's definition, not this tool's: its stat
        // cards and GET /invoices/overdue both require an issued document, so a
        // draft that was never sent to the customer cannot be a late payment —
        // and a second definition here is how the copilot ended up contradicting
        // the page the question is about.
        const overdue =
          Number.isFinite(dueAt) && dueAt < now && !INVOICE_UNISSUED_STATUSES.includes(row?.status);
        return { ...row, overdue, dueAt };
      });
    rows.sort(byDueDateAscending);
    const limit = args.limit ?? DEFAULT_LIST_LIMIT;
    const selected = rows.slice(0, limit);
    const bounded = boundResult(listInvoicesTool, selected);

    // A count is citable ONLY when it is the whole count, and `boundResult` cannot
    // see either drop: the paymentStatus filter above and this caller-limit slice
    // both run BEFORE it, so `records.length > rowCap` is already false by the time
    // it looks. That is how a partial list could be presented as complete — the
    // failure boundResult's own comment says it exists to prevent. Completeness is
    // therefore decided here, against the envelope's own total.
    const knownTotal = Number.isFinite(result.total) ? result.total : null;
    const droppedRows = selected.length < rows.length || (knownTotal !== null && raw.length < knownTotal);
    const complete = knownTotal !== null && !droppedRows && !bounded.truncated;

    return {
      ...bounded,
      ...(droppedRows ? { truncated: true } : {}),
      // Present exactly when they are true, and absent otherwise: these numbers are
      // what an answer may cite, so an incomplete read must not offer any. Both are
      // exact only because `complete` means these rows ARE the whole filtered set:
      // `total` is its size, and `overdueTotal` counts the rows whose dueDate has
      // passed. "How many invoices are overdue?" cannot be answered from the rows
      // themselves — the count is a property of the set, not a value any row carries,
      // so the model could only ever guess it, and a guess is what the numeric rule
      // exists to refuse.
      ...(complete
        ? { total: rows.length, overdueTotal: rows.reduce((n, row) => n + (row.overdue ? 1 : 0), 0) }
        : {}),
    };
  },
};

function byDueDateAscending(left, right) {
  const a = left?.dueAt;
  const b = right?.dueAt;
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  // A row with no parseable dueDate sorts last rather than first: an unknown
  // date is not the most overdue one.
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return a - b;
}

// ─── Cross-site reads ─────────────────────────────────────────────────────
// These are what let a question be answered from any page rather than only the
// one the operator is standing on. Each calls a route that already exists, under
// the caller's forwarded identity, and each is gated in `ASSISTANT_TOOL_ACCESS`
// by the same roles that route's own guard requires.
//
// The analytics payloads are aggregates the service has ALREADY computed, which
// is why their projections name the aggregate groups rather than individual
// fields: `project` copies an allowlisted key's value verbatim, and the service's
// own `LIMIT 10` bounds what is inside each group.
//
// Two payloads are deliberately narrowed to exclude `recentLeads`/`recentBookings`
// (`/dashboard/stats` and the personal-performance route). Those rows carry
// customer EMAIL addresses, and a model prompt is not a place for them; they are
// also record-level detail rather than cross-site intelligence. If either is
// wanted later it needs a field-level projection first, not a wider allowlist.
//
// The byte budget for all six is the LIST budget, not the RECORD one: a wrapped
// aggregate is a single row, and `boundResult` drops tail rows to fit, so a
// budget that one payload exceeded would drop the entire result rather than trim
// it.
const timeRangeSchema = z.enum(['daily', 'weekly', 'monthly', 'annual']);

// The company-wide picture, and the single most useful answer to "how are we
// doing" from a page that carries none of it.
const getDashboardSnapshotTool = {
  name: 'getDashboardSnapshot',
  description:
    'Read the company snapshot: lead, booking, revenue and package totals, plus leads by status. Lifetime figures, not a time window. A salesRep sees their own book; an admin sees the company.',
  argsSchema: z.object({}).strict(),
  projection: ['leads', 'bookings', 'revenue', 'packages', 'leadsByStatus'],
  rowCap: 5,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(analyticsServiceUrl(), '/api/v1/dashboard/stats', ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getDashboardSnapshotTool, result.data ? [result.data] : []);
  },
};

// Lead analytics across the company: totals, the trend, status and platform
// distribution, and the top destinations and countries by lead volume and
// conversion — the cross-site counterpart to the page's own lead rows.
const getLeadAnalyticsTool = {
  name: 'getLeadAnalytics',
  description:
    'Read lead analytics: totals by stage, the trend over the window, status and platform distribution, and the top destinations and countries by lead volume and conversion rate. A salesRep is scoped to their own leads.',
  argsSchema: z.object({ timeRange: timeRangeSchema.optional() }).strict(),
  projection: [
    'stats',
    'trend',
    'statusDistribution',
    'categoryDistribution',
    'topCountries',
    'topDestinations',
    'priceRangeDistribution',
  ],
  rowCap: 7,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(analyticsServiceUrl(), analyticsPath('/leads/overview', args), ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getLeadAnalyticsTool, result.data ? [result.data] : []);
  },
};

// Package performance: the questions that had no answer at all before this —
// which packages are asked about, which convert, and where the catalogue is
// concentrated by destination.
const getPackagePerformanceTool = {
  name: 'getPackagePerformance',
  description:
    'Read package performance: totals for itineraries, inquiries and conversions, the trend, performance by destination, and the most-inquired packages by name. Use this for "best performing packages" or "where is the catalogue concentrated".',
  argsSchema: z.object({ timeRange: timeRangeSchema.optional() }).strict(),
  projection: ['stats', 'trend', 'destinationPerformance', 'mostInquired'],
  rowCap: 4,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(analyticsServiceUrl(), analyticsPath('/packages/overview', args), ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getPackagePerformanceTool, result.data ? [result.data] : []);
  },
};

// The sales team's numbers. Its own tool rather than an argument on the personal
// one, because the route behind it authorizes admin only.
const getSalesPerformanceTool = {
  name: 'getSalesPerformance',
  description:
    'Read every sales representative\'s performance for the window: confirmed sales and conversion rate, highest first.',
  argsSchema: z.object({ timeRange: timeRangeSchema.optional() }).strict(),
  projection: ['rep', 'sales', 'conversion'],
  rowCap: MAX_TOOL_ROWS,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(analyticsServiceUrl(), analyticsPath('/salesreps/performance', args), ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getSalesPerformanceTool, Array.isArray(result.data) ? result.data : []);
  },
};

// The caller's own book. Separate from the team tool because the route rejects an
// admin and never accepts a rep id — it is always "me".
const getMyPerformanceTool = {
  name: 'getMyPerformance',
  description:
    'Read your own performance: leads assigned, converted and pending, and your conversion rate for the window.',
  argsSchema: z.object({ timeRange: timeRangeSchema.optional() }).strict(),
  projection: ['performance'],
  rowCap: 1,
  resultByteBudget: RECORD_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(analyticsServiceUrl(), analyticsPath('/salesreps/me/performance', args), ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(getMyPerformanceTool, result.data ? [result.data] : []);
  },
};

// Catalogue content rather than performance: what a package IS. The route is
// public and forces `isActive`, so a query cannot widen the catalogue; the tool
// map still narrows it to the two management roles.
const searchPackagesTool = {
  name: 'searchPackages',
  description:
    'Search the package catalogue by free text, matching title, description or destination, ranked by rating. Returns the package\'s destination, duration, category, prices, rating, views and bookings.',
  argsSchema: z.object({ q: z.string().min(1).max(200) }).strict(),
  projection: [
    'id',
    'title',
    'destination',
    'durationDays',
    'category',
    'basePrice',
    'sellPrice',
    'currency',
    'rating',
    'numReviews',
    'views',
    'bookings',
    'isActive',
    'isFeatured',
  ],
  rowCap: MAX_TOOL_ROWS,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(
      packageServiceUrl(),
      `/api/v1/packages/search/query?q=${encodeURIComponent(args.q)}`,
      ctx,
      signal,
    );
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    return boundResult(searchPackagesTool, Array.isArray(result.data) ? result.data : []);
  },
};

// ─── Public catalogue reads ───────────────────────────────────────────────
// These three back the public-site assistant, which has no user identity at
// all. The routes behind them are public (package-service forces `isActive`
// when no user is present), so they take no role in `ASSISTANT_TOOL_ACCESS` and
// no management role can reach them; the public turn passes its own allowlist
// to `executeTool`. They live here so the outbound call still gets the per-
// target Cloud Run ID token and the result is still bounded by declaration.

// The filters a package query may carry, in one shape so `countPackages` and
// `listPackages` cannot disagree about what a filter is or which values are
// acceptable. Both send them to the same service endpoint.
const PACKAGE_FILTER_FIELDS = {
  destination: z.string().min(1).max(60).optional(),
  category: z.string().min(1).max(60).optional(),
  priceMin: z.number().min(0).max(1_000_000).optional(),
  priceMax: z.number().min(0).max(1_000_000).optional(),
  durationMin: z.number().int().min(1).max(365).optional(),
  durationMax: z.number().int().min(1).max(365).optional(),
  rating: z.number().optional(),
};

// These names are not the service's query names. `assembleWhere` reads
// `minPrice`/`maxPrice`/`minRating`; sending `priceMax` would be ignored and the
// query would silently describe the whole catalogue instead of the filtered set,
// so the three bounded numerics are mapped.
const PACKAGE_QUERY_NAMES = { priceMin: 'minPrice', priceMax: 'maxPrice', rating: 'minRating' };

// The published catalogue, for answering questions about what exists — and, when
// a filter is given, the matching page of it. `getPackages` reports the whole
// match count independently of the `limit` it applies, so a caller that wants
// both a preview and the total asks once and gets both from the same response.
const listPackagesTool = {
  name: 'listPackages',
  public: true,
  description:
    'List the published packages (id, title, description, destination, duration, category, prices, rating, review count). Use `limit` to bound how many are returned, and the filter arguments to list only the packages that match them.',
  argsSchema: z
    .object({
      ...PACKAGE_FILTER_FIELDS,
      limit: z.number().int().min(1).max(50).optional(),
      sort: z.enum(ROUTE_PARAM_RULES.sort.values).optional(),
    })
    .strict(),
  projection: [
    'id',
    'title',
    'slug',
    'description',
    'destination',
    'durationDays',
    'category',
    'sellPrice',
    'basePrice',
    'currency',
    'rating',
    'numReviews',
    'isActive',
    'isFeatured',
  ],
  rowCap: 50,
  resultByteBudget: LIST_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const params = new URLSearchParams({ limit: String(args.limit ?? 50) });
    for (const [key, value] of Object.entries(args)) {
      if (key === 'limit' || value === undefined) continue;
      params.set(PACKAGE_QUERY_NAMES[key] ?? key, String(value));
    }
    const result = await fetchJson(packageServiceUrl(), `/api/v1/packages?${params}`, ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    const bounded = boundResult(listPackagesTool, Array.isArray(result.data) ? result.data : []);
    // Carried through so one read answers both "how many" and "which ones", and
    // the two can never describe different filter sets.
    return Number.isFinite(result.total) ? { ...bounded, total: result.total } : bounded;
  },
};

// The number that answers "how many", read from the service's own count rather
// than recomputed from a page of rows. `getPackages` reports `total` for the
// whole match independently of the `limit` it applies, so this asks for one row
// and still learns the full count.
const countPackagesTool = {
  name: 'countPackages',
  public: true,
  description:
    'Count the published packages matching a destination, category, price, duration or rating. Returns the exact total, not a page of results.',
  argsSchema: z.object({ ...PACKAGE_FILTER_FIELDS }).strict(),
  projection: ['total'],
  rowCap: 1,
  resultByteBudget: RECORD_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const params = new URLSearchParams({ limit: '1' });
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) continue;
      params.set(PACKAGE_QUERY_NAMES[key] ?? key, String(value));
    }
    const result = await fetchJson(packageServiceUrl(), `/api/v1/packages?${params}`, ctx, signal);
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    if (!Number.isFinite(result.total)) return { unavailable: true };
    return boundResult(countPackagesTool, [{ total: result.total }]);
  },
};

const DETAIL_TEXT_LIMIT = 400;
const DETAIL_LIST_LIMIT = 10;
const DETAIL_ITEM_LIMIT = 120;
const DETAIL_DAY_LIMIT = 10;

const truncate = (value, limit) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

// `inclusions`/`exclusions` are Json columns that may hold strings or objects.
const summarizeDetailList = (value) =>
  (Array.isArray(value) ? value : [])
    .slice(0, DETAIL_LIST_LIMIT)
    .map((entry) => truncate(typeof entry === 'string' ? entry : JSON.stringify(entry), DETAIL_ITEM_LIMIT))
    .filter(Boolean);

// A day's places, activities, transports and flights are a deep tree that would
// exhaust this record's byte budget and then be trimmed mid-structure by
// `boundResult`, leaving an unparseable fragment in the prompt. The outline
// keeps `dayNumber` and `title` only: enough to describe the shape of the trip.
function summarizePackageDetail(record) {
  return {
    id: record.id ?? null,
    title: truncate(record.title, DETAIL_ITEM_LIMIT) || null,
    destination: truncate(record.destination, DETAIL_ITEM_LIMIT) || null,
    durationDays: record.durationDays ?? null,
    category: record.category ?? null,
    sellPrice: record.sellPrice ?? record.basePrice ?? null,
    currency: record.currency ?? null,
    rating: record.rating ?? null,
    numReviews: record.numReviews ?? null,
    description: truncate(record.description, DETAIL_TEXT_LIMIT) || null,
    inclusions: summarizeDetailList(record.inclusions),
    exclusions: summarizeDetailList(record.exclusions),
    itinerary: (Array.isArray(record.itineraryDays) ? record.itineraryDays : [])
      .slice(0, DETAIL_DAY_LIMIT)
      .map((day) => ({
        dayNumber: day?.dayNumber ?? null,
        title: truncate(day?.title, DETAIL_ITEM_LIMIT) || null,
      }))
      .filter((day) => day.dayNumber !== null || day.title),
  };
}

// What a package IS, in detail: what the price buys and how the days run.
// `getPackageById` increments the view counter, so this is only ever called for
// a package the visitor actually named — never speculatively across the
// catalogue.
const getPackageDetailTool = {
  name: 'getPackageDetail',
  public: true,
  description:
    'Read one package in full: description, what is included and excluded, and the day-by-day outline.',
  argsSchema: z.object({ id: z.string().min(1).max(255) }).strict(),
  projection: [
    'id',
    'title',
    'destination',
    'durationDays',
    'category',
    'sellPrice',
    'currency',
    'rating',
    'numReviews',
    'description',
    'inclusions',
    'exclusions',
    'itinerary',
  ],
  rowCap: 1,
  resultByteBudget: RECORD_RESULT_BYTE_BUDGET,
  async execute(ctx, args, signal) {
    const result = await fetchJson(
      packageServiceUrl(),
      `/api/v1/packages/${encodeURIComponent(args.id)}`,
      ctx,
      signal,
    );
    if (result.notAuthorized) return { notAuthorized: true };
    if (result.unavailable) return { unavailable: true };
    const record = result.data;
    if (!record || typeof record !== 'object') return boundResult(getPackageDetailTool, []);
    return boundResult(getPackageDetailTool, [summarizePackageDetail(record)]);
  },
};

/** An analytics path with the optional window the service accepts. */
function analyticsPath(path, args) {
  return args.timeRange ? `/api/v1/analytics${path}?timeRange=${args.timeRange}` : `/api/v1/analytics${path}`;
}

// getSimilarConvertedLeads and searchManagementKnowledge stay unimplemented: no
// tool-shaped endpoint backs either one (there is no similarity route anywhere,
// and policy documents are readable only with an internal token), so a tool for
// them would have to invent its own data source.
export const domainTools = [
  getLeadTool,
  listLeadsTool,
  listInvoicesTool,
  getDashboardSnapshotTool,
  getLeadAnalyticsTool,
  getPackagePerformanceTool,
  getSalesPerformanceTool,
  getMyPerformanceTool,
  searchPackagesTool,
  listPackagesTool,
  countPackagesTool,
  getPackageDetailTool,
];

// The tools that answer to no actor at all. Derived from the `public` marker on
// the tools themselves rather than listed again, so a tool cannot be added to
// the registry and forgotten here — the same way the access map cannot silently
// omit a management tool. `insights/__tests__/catalogue.test.js` asserts the
// registry is exactly the union of these and the management vocabulary.
export const PUBLIC_TOOL_NAMES = domainTools.filter((tool) => tool.public === true).map((tool) => tool.name);

const toolsByName = new Map(domainTools.map((t) => [t.name, t]));

export function getTool(name) {
  return toolsByName.get(name);
}

export function toolNames() {
  return [...toolsByName.keys()];
}

// The prompt-shaped view of a resolved tool list. Unknown names are skipped
// here; naming one in a request is answered by `executeTool`'s error, below.
export function resolveTools(names = []) {
  return names
    .map((name) => getTool(name))
    .filter(Boolean)
    .map((tool) => ({ name: tool.name, description: tool.description }));
}

/** The argument names a tool accepts, read from its own schema. */
function acceptedArguments(tool) {
  const shape = tool.argsSchema?.shape;
  if (!shape) return 'none';
  const keys = Object.keys(shape);
  return keys.length > 0 ? keys.join(', ') : 'none';
}

// Executes a model-requested tool. Returns a bounded result object; a malformed
// tool or args returns a named error so the loop can feed it back to the model.
// Resolution is against the CALLER's resolved vocabulary, never the whole
// registry: a page that does not declare a tool cannot reach it even if the
// model names it.
export async function executeTool(name, rawArgs, ctx, allowedNames = [], signal) {
  if (!allowedNames.includes(name)) return { error: `unknown tool '${name}'` };
  const tool = getTool(name);
  if (!tool) return { error: `unknown tool '${name}'` };
  const parsed = tool.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    // The accepted arguments are DERIVED from the schema, so this cannot drift
    // from what the tool actually takes. A bare "Unrecognized key" told the model
    // what was wrong but not what would be right, and live it repeated the same
    // rejected call until the loop gave up.
    return {
      error: `invalid args for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}. Accepted arguments: ${acceptedArguments(tool)}`,
    };
  }
  try {
    return await tool.execute(ctx, parsed.data, signal);
  } catch {
    return { unavailable: true };
  }
}
