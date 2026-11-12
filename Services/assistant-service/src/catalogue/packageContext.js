import { executeTool, PUBLIC_TOOL_NAMES } from '../tools/toolRegistry.js';
import { canonicalScalar, canonicalScalars, proseNumericTokens } from '../ai/groundingValidator.js';
import { getTenantId } from '../../../shared/tenancy/src/index.js';

// ─── The package context for one public turn ──────────────────────────────
// The site-wide assistant had no package data at all: its only external read
// was policy retrieval, so "tell me about the cultural journey package" was
// answered from whatever policy section happened to share a word with it. This
// module is the read that fixes that, and it is deliberately the ONLY place the
// public turn touches package data.
//
// Two shapes travel from here into a turn:
//
//   the catalogue      every published package, a bounded page of them, so the
//                      model can answer prices, compare, and pick one
//   the detail         inclusions and the day-by-day outline, fetched for one
//                      package the visitor actually named
//
// The detail fetch is deliberately narrow. `getPackageById` increments the
// package's view counter on every read, so pulling detail for the catalogue
// would count a view for every package every time anyone said hello.

export const CATALOGUE_LIMIT = 50;

// The public turn has no user identity, so it cannot resolve a vocabulary from
// one. These are the tools that answer to nobody, derived in the registry from
// the tools' own `public` marker rather than listed a second time.
export const PUBLIC_CATALOGUE_TOOLS = PUBLIC_TOOL_NAMES;

const CATALOGUE_TTL_MS = 60_000;
// The detail endpoint increments the package's view counter on every read, so
// the read is memoized: without this, a conversation about one package would
// count a view per message and inflate a figure the management tools report as
// engagement. It bounds the effect rather than removing it — the endpoint has
// no way to skip the increment.
const DETAIL_TTL_MS = 60_000;
const DETAIL_LIST_LIMIT = 10;
const DESCRIPTION_LIMIT = 200;
const DETAIL_DESCRIPTION_LIMIT = 400;

// The filters a package query may carry, matching the filter arguments both
// package tools take.
const FILTER_KEYS = ['destination', 'category', 'priceMin', 'priceMax', 'durationMin', 'durationMax', 'rating'];

// How many matching packages a browse answer names before it stops and points at
// the page instead. Enough to act on; small enough that the count and the link
// stay the point.
export const BROWSE_PREVIEW_LIMIT = 3;

// Both memos are keyed by the requesting agency, so one agency's catalogue can
// never surface in another agency's conversation. Identity-less callers share
// one 'public' bucket; in production the gateway pins those to the demo agency.
const tenantKey = () => getTenantId() ?? 'public';

const catalogueCache = new Map(); // tenantKey -> { facts, at }
const detailCache = new Map(); // `${tenantKey}|${packageId}` -> { detail, at }

/** Test seam: drops the memoized catalogue, matching `_resetPolicyDocumentsCache`. */
export function _resetPackageCatalogueCache() {
  catalogueCache.clear();
}

/** Test seam: drops the memoized package details. */
export function _resetPackageDetailCache() {
  detailCache.clear();
}

const truncate = (value, limit) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

function toFact(row) {
  const price = Number(row?.sellPrice ?? row?.basePrice ?? 0);
  const durationDays = Number(row?.durationDays ?? 0);
  return {
    id: typeof row?.id === 'string' ? row.id : '',
    title: truncate(row?.title, 120),
    destination: truncate(row?.destination, 80),
    durationDays: Number.isFinite(durationDays) ? durationDays : 0,
    category: typeof row?.category === 'string' ? row.category : '',
    price: Number.isFinite(price) ? price : 0,
    currency: typeof row?.currency === 'string' && row.currency ? row.currency : 'USD',
    rating: Number.isFinite(Number(row?.rating)) ? Number(row.rating) : 0,
    numReviews: Number.isFinite(Number(row?.numReviews)) ? Number(row.numReviews) : 0,
    description: truncate(row?.description, DESCRIPTION_LIMIT),
  };
}

/**
 * The published catalogue, memoized for a minute with stale-on-failure.
 *
 * A turn must never fail because package-service is slow or down: the caller
 * gets `[]`, the prompt simply carries no catalogue block, and the assistant
 * behaves exactly as it did before this module existed. A failed read is NOT
 * cached, so one bad minute does not blind every visitor for the next one.
 */
export async function loadPackageCatalogue({ signal } = {}) {
  const entry = catalogueCache.get(tenantKey());
  if (entry && Date.now() - entry.at < CATALOGUE_TTL_MS) return entry.facts;

  let result = null;
  try {
    result = await executeTool('listPackages', { limit: CATALOGUE_LIMIT }, {}, PUBLIC_CATALOGUE_TOOLS, signal);
  } catch {
    return entry?.facts ?? [];
  }

  if (!result || result.error || result.unavailable || result.notAuthorized) {
    return entry?.facts ?? [];
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const facts = rows.map(toFact).filter((fact) => fact.id && fact.title);
  catalogueCache.set(tenantKey(), { facts, at: Date.now() });
  return facts;
}

/**
 * Inclusions and the day-by-day outline for one package.
 *
 * Never cached and never batched: the endpoint counts a view per read, so it is
 * only ever called for a package the visitor named by name.
 */
export async function loadPackageDetail(id, { signal } = {}) {
  if (!id) return null;

  const cacheKey = `${tenantKey()}|${id}`;
  const cached = detailCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.detail;

  let result = null;
  try {
    result = await executeTool('getPackageDetail', { id }, {}, PUBLIC_CATALOGUE_TOOLS, signal);
  } catch {
    return null;
  }

  if (!result || result.error || result.unavailable || result.notAuthorized) return null;
  const record = Array.isArray(result.data) ? result.data[0] : null;
  if (!record || typeof record !== 'object') return null;

  // A failed read is deliberately not cached, so one bad minute does not blind
  // the rest of the conversation.
  detailCache.set(cacheKey, { detail: record, at: Date.now() });
  return record;
}

/**
 * The packages matching these filters, and how many match in total.
 *
 * One read answers both, because the service reports the whole match count in
 * the envelope independently of the `limit` applied to the rows: a preview and
 * the number beside it can therefore never describe different filter sets.
 *
 * The count comes from the service's own envelope total, never from the model
 * and never from counting a page of rows — a stated count the visitor can check
 * against the filtered page must not be able to disagree with it. A failure
 * returns `{ packages: [], total: null }` so the caller can leave the model's
 * own reply in place rather than compose a sentence it cannot back.
 */
export async function loadFilteredPackages(filters = {}, { limit = BROWSE_PREVIEW_LIMIT, signal } = {}) {
  const args = { limit };
  for (const key of FILTER_KEYS) {
    if (filters?.[key] !== undefined && filters[key] !== null) args[key] = filters[key];
  }

  let result = null;
  try {
    result = await executeTool('listPackages', args, {}, PUBLIC_CATALOGUE_TOOLS, signal);
  } catch {
    return { packages: [], total: null };
  }

  if (!result || result.error || result.unavailable || result.notAuthorized) {
    return { packages: [], total: null };
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const total = Number(result.total);
  return {
    packages: rows.map(toFact).filter((fact) => fact.id && fact.title),
    total: Number.isFinite(total) && total >= 0 ? total : null,
  };
}

/**
 * How much of a title has to be present before we call the turn a package
 * question. Measured against the phrasing in the report: "the cultural journey
 * package" covers two of "Japan Cultural Journey"'s three words (0.67, a match),
 * while "tell me about dubai packages" covers none of it and "sri lanka
 * packages" covers two of "Sri Lanka Heritage Explorer"'s four (0.5, not a
 * match — that is a destination browse, and it stays one).
 */
const TITLE_MATCH_COVERAGE = 0.6;

const titleWords = (value) => {
  const words = (typeof value === 'string' ? value.toLowerCase().match(/[a-z0-9]+/g) : null) || [];
  return [...new Set(words.filter((word) => word.length >= 3))];
};

/**
 * The package whose title the visitor named, or null.
 *
 * Deliberately NOT `matchDeclaredValue`: that matches a label as one contiguous
 * phrase, which is exactly right for a one-word destination slug and returns
 * nothing here. "Japan Cultural Journey" never appears in "the cultural journey
 * package" as a phrase, so the phrase matcher was measured returning null for
 * the very question this module exists to answer. People name a package by its
 * most distinctive words, not by its full title, so this scores word coverage.
 *
 * Words must match whole (`india` must not fire inside `indiana`), most of the
 * title must be present, and a tie goes to the longer, more specific title.
 */
export function matchPackage(text, packages = []) {
  const message = typeof text === 'string' ? text.toLowerCase() : '';
  if (!message.trim()) return null;

  const candidates = (Array.isArray(packages) ? packages : []).filter((p) => p?.id && p?.title);
  let best = null;
  let bestCoverage = 0;

  for (const pkg of candidates) {
    const words = titleWords(pkg.title);
    if (!words.length) continue;

    const hits = words.filter((word) =>
      new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(message),
    ).length;

    // A one-word title needs its one word; anything longer needs at least two,
    // so a single generic word cannot pull a package into an unrelated turn.
    if (hits < Math.min(2, words.length)) continue;

    const coverage = hits / words.length;
    if (coverage < TITLE_MATCH_COVERAGE) continue;
    if (coverage > bestCoverage || (coverage === bestCoverage && best && pkg.title.length > best.title.length)) {
      best = pkg;
      bestCoverage = coverage;
    }
  }

  return best;
}

/**
 * The package the conversation is currently about, or null.
 *
 * A follow-up almost never repeats the package's title — "tell me more about
 * it", "more about days" — so resolving the subject from the current message
 * alone finds nothing on exactly the turns that want the detail. The client
 * already reports the packages it has put in front of the visitor, most recent
 * last, so the subject is available without a word of it being re-named.
 *
 * Walks backwards because the most recently shown package is the subject.
 * Ids are client-supplied and therefore untrusted: an id that is not in the
 * catalogue is skipped rather than looked up, and a malformed list is empty.
 */
export function lastShownPackage(packages = [], shownIds = []) {
  const list = Array.isArray(packages) ? packages : [];
  const ids = Array.isArray(shownIds) ? shownIds : [];

  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const found = list.find((pkg) => pkg?.id === ids[i]);
    if (found) return found;
  }

  return null;
}

const money = (value, currency = 'USD') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown currency code is not worth losing the sentence over.
    return String(Math.round(amount));
  }
};

const titleCaseSlug = (value) =>
  typeof value === 'string' && value
    ? value
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    : '';

/** One package, as the model should read it. */
function catalogueLine(fact) {
  const parts = [
    `id: ${fact.id}`,
    `"${fact.title}"`,
    fact.destination,
    fact.durationDays > 0 ? `${fact.durationDays} days` : '',
    fact.price > 0 ? money(fact.price, fact.currency) : '',
    fact.numReviews > 0 ? `rated ${fact.rating} from ${fact.numReviews} reviews` : '',
    fact.description,
  ].filter(Boolean);
  return `- ${parts.join(' | ')}`;
}

export function buildCatalogueBlock(packages = []) {
  const facts = (Array.isArray(packages) ? packages : []).filter((p) => p?.id && p?.title);
  if (!facts.length) return '';
  return `Packages that exist — answer any question about a package, its price, or which to choose from this list, and cite only these ids:\n${facts
    .map(catalogueLine)
    .join('\n')}\n`;
}

export function buildPackageDetailBlock(detail) {
  if (!detail || typeof detail !== 'object') return '';

  const lines = [];
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry) : []);

  const inclusions = list(detail.inclusions).slice(0, DETAIL_LIST_LIMIT);
  if (inclusions.length) lines.push(`- includes: ${inclusions.join('; ')}`);
  const exclusions = list(detail.exclusions).slice(0, DETAIL_LIST_LIMIT);
  if (exclusions.length) lines.push(`- excludes: ${exclusions.join('; ')}`);
  const days = (Array.isArray(detail.itinerary) ? detail.itinerary : [])
    .filter((day) => day?.title)
    .slice(0, DETAIL_LIST_LIMIT);
  if (days.length) {
    lines.push(`- day by day: ${days.map((day) => `Day ${day.dayNumber ?? '?'} ${day.title}`).join('; ')}`);
  }

  if (!lines.length) return '';
  const heading = detail.title ? `Detail for "${detail.title}"` : 'Detail for the package the visitor named';
  const description = truncate(detail.description, DETAIL_DESCRIPTION_LIMIT);
  const body = description ? [`- about: ${description}`, ...lines] : lines;
  return `${heading}:\n${body.join('\n')}\n`;
}

/**
 * Every value the model is allowed to state a number about.
 *
 * Built from the records themselves, so the numeric check in the controller
 * compares the model's prose against real fields rather than a hand-written
 * list. `durationDays - 1` is added because a nine-day trip is an eight-night
 * trip and both readings are correct.
 *
 * The detail is included as well as the catalogue rows, because the detail is
 * part of what the model was shown. Without it, the obvious answer to "more
 * about days" — "Day 1: Bangkok Arrival, Day 2: Floating Market" — reads as
 * invented numbers and the whole sentence is discarded, which is how a
 * question the detail block exists to answer ended up with no answer at all.
 */
export function packageFactValues(packages = [], detail = null) {
  const values = canonicalScalars(Array.isArray(packages) ? packages : []);
  for (const fact of Array.isArray(packages) ? packages : []) {
    if (Number.isFinite(fact?.durationDays) && fact.durationDays > 1) {
      values.add(String(fact.durationDays - 1));
    }
  }

  if (detail && typeof detail === 'object') {
    canonicalScalars(detail, values);
    // Digits inside the detail's own text — a day number, a "4-star" in an
    // inclusion — are numbers the model was handed, so stating them is
    // repetition of the source, not invention.
    for (const token of proseNumericTokens(JSON.stringify(detail))) {
      const canonical = canonicalScalar(token);
      if (canonical !== null) values.add(canonical);
    }
  }

  return values;
}

/**
 * "There are 3 packages under $1,000" — the sentence that makes a filtered
 * navigation an answer rather than a redirect.
 *
 * `filters.destinationLabel` carries the human name for a destination slug when
 * one is known ("uae" is "Dubai" to a visitor), because the slug is a URL value
 * and reading it aloud would be nonsense.
 */
export function countSentence(count, filters = {}, currency = 'USD') {
  const quantity = count === 1 ? 'is 1 package' : `are ${count} packages`;
  const clauses = [];

  const place = typeof filters.destinationLabel === 'string' && filters.destinationLabel
    ? filters.destinationLabel
    : titleCaseSlug(filters.destination);
  if (place) clauses.push(`in ${place}`);

  if (Number.isFinite(filters.priceMax)) clauses.push(`under ${money(filters.priceMax, currency)}`);
  if (Number.isFinite(filters.priceMin)) clauses.push(`from ${money(filters.priceMin, currency)}`);

  const { durationMin, durationMax } = filters;
  if (Number.isFinite(durationMin) && Number.isFinite(durationMax)) {
    clauses.push(`${durationMin}-${durationMax} days`);
  } else if (Number.isFinite(durationMin)) {
    clauses.push(`at least ${durationMin} days`);
  } else if (Number.isFinite(durationMax)) {
    clauses.push(`up to ${durationMax} days`);
  }

  if (Number.isFinite(filters.rating)) clauses.push(`rated ${filters.rating}+`);

  const descriptor = clauses.length ? ` ${clauses.join(' and ')}` : '';
  return `There ${quantity}${descriptor}`;
}

/** "A", "A and B", "A, B and C" — the way a person lists names aloud. */
const joinNames = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * The browse answer: the count, and the names of the packages behind it.
 *
 * The count alone told the visitor how many there were and nothing about which,
 * so the only way to find out was to leave the chat and open the list. The names
 * let them carry on in the dialog — "tell me about the second one" — while the
 * page stays one tap away, which is what the caller's link chip is for.
 *
 * When every match is named the sentence states them; when there are more than
 * `BROWSE_PREVIEW_LIMIT` it says so and points at the list, because a partial
 * list presented as the whole answer would be a quiet lie. Names come from the
 * same response as the count, so the two cannot describe different filter sets.
 */
export function countSentenceWithNames(count, filters = {}, currency = 'USD', names = []) {
  const sentence = countSentence(count, filters, currency);
  const shown = (Array.isArray(names) ? names : [])
    .filter((name) => typeof name === 'string' && name)
    .slice(0, BROWSE_PREVIEW_LIMIT);

  if (count === 0 || shown.length === 0) return `${sentence}.`;

  const list = joinNames(shown);
  return shown.length >= count
    ? `${sentence}: ${list}.`
    : `${sentence}, including ${list}. Open the list to see them all.`;
}
