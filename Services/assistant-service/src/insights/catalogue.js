import { ASSISTANT_TOOL_ACCESS } from '@travel-crm/contracts';

// ─── Who may reach which tool ─────────────────────────────────────────────
// Capability follows the QUESTION and the ACTOR, not the page the operator
// happens to be standing on.
//
// What this replaced: `adapter.askTools(scope)` returned a page's tool list, so
// the same operator asking the same question got different capability depending on
// which screen they were on. A question spanning two domains was unanswerable from
// either. The page still decides what is VOLUNTEERED without being asked (that is
// what keeps the panel quiet); it no longer decides what may be ASKED.
//
// The map itself lives in `@travel-crm/contracts` next to the wire enums, and it
// mirrors the guard on the target route. Being narrower than the route is safe:
// a tool absent from an actor's vocabulary is a visible absence, never a 403
// halfway through an answer. The domain service's own checks still run under the
// caller's forwarded identity.

export const CATALOGUE_VERSION = 'tool-catalogue.v1';

// What each tool reads, in the operator's words. A drift test asserts every
// accessible tool has a label, because an unlabelled one would vanish from the
// capability line below without anything saying so.
// Deliberately coarse SUBJECTS rather than one label per tool: several tools read
// the same thing, and `capabilitySummary` dedupes, so the limitation sentence stays
// a readable list ("company performance, invoices, leads and packages") instead of
// enumerating nine tool names at an operator who just wanted an answer.
const TOOL_LABELS = {
  getLead: 'leads',
  listLeads: 'leads',
  getLeadAnalytics: 'leads',
  listInvoices: 'invoices',
  getPackagePerformance: 'packages',
  searchPackages: 'packages',
  getDashboardSnapshot: 'company performance',
  getSalesPerformance: 'company performance',
  getMyPerformance: 'your performance',
};

/**
 * The readable subjects for an actor, as prose: "invoices and leads".
 *
 * Returns null when the actor can read nothing, which is a different answer from
 * an empty string and has to stay distinguishable.
 *
 * This exists to answer the only question a failed ask leaves an operator with:
 * "then what CAN you tell me here?" It is server-authored on purpose — the model
 * cannot state its own limits, because a claim citing no evidence is rejected by
 * the validator, and the one party that cannot invent a capability is the one
 * that should describe it.
 */
export function capabilitySummary(actor = {}) {
  const labels = [...new Set(toolsForActor(actor).map((name) => TOOL_LABELS[name]).filter(Boolean))].sort();
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Every tool name the registry knows about, in a stable order. */
export function allToolNames() {
  return Object.keys(ASSISTANT_TOOL_ACCESS);
}

/**
 * The tools an actor may use. A superadmin gets everything, because every service
 * in this platform treats `isSuperAdmin` as a bypass of `authorize(...)`.
 *
 * An unrecognised role gets NOTHING rather than a guess: fail closed, and the
 * actor sees an explicit "not available for your role" rather than a panel that
 * quietly cannot do anything.
 */
export function toolsForActor({ role, isSuperAdmin } = {}) {
  if (isSuperAdmin) return allToolNames();
  if (!role) return [];
  return Object.entries(ASSISTANT_TOOL_ACCESS)
    .filter(([, roles]) => roles.includes(role))
    .map(([name]) => name);
}

export function mayUseTool(actor, toolName) {
  return toolsForActor(actor).includes(toolName);
}
