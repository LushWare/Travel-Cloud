// Which routes belong to which plan module. The agency's switched-off modules arrive in the staff
// login token (`off`, set by auth-service from the agency's plan), so this check needs no database.
//
// mode 'changes': looking stays allowed and only changes are refused. A plan downgrade must never
//                 hide an agency's own invoices, vendors or bookings — they become read-only.
// mode 'all':     the module is a view in itself (reports), so looking is refused too.
//
// The services check again for actions that reach into a module from elsewhere (for example,
// turning a quotation into an invoice), so a route missing here is not the only line of defence.
export const MODULE_ROUTES = [
  { module: 'finance_docs', mode: 'changes', pattern: /^\/api\/v1\/billing\/(invoices|receipts|credit-notes|vouchers|payment-history)(\/|$)/ },
  { module: 'finance_docs', mode: 'changes', pattern: /^\/api\/v1\/invoices(\/|$)/ },
  { module: 'vendors', mode: 'changes', pattern: /^\/api\/v1\/vendors(\/|$)/ },
  { module: 'travel_booking', mode: 'changes', pattern: /^\/api\/v1\/flights(\/|$)/ },
  // The dashboard's own figures (lead and billing overview, a rep's own performance) stay in every plan.
  { module: 'analytics_full', mode: 'all', pattern: /^\/api\/v1\/analytics\/(packages|users|website|business)(\/|$)/ },
  { module: 'analytics_full', mode: 'all', pattern: /^\/api\/v1\/analytics\/salesreps\/performance(\/|$)/ },
  { module: 'analytics_full', mode: 'all', pattern: /^\/api\/v1\/analytics\/[^/]+\/export-pdf$/ },
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The module that refuses this request for an agency with these modules switched off, or null. */
export function blockedModule(method, path, switchedOff) {
  if (!Array.isArray(switchedOff) || switchedOff.length === 0) return null;
  const route = MODULE_ROUTES.find((r) => switchedOff.includes(r.module) && r.pattern.test(path));
  if (!route) return null;
  if (route.mode === 'changes' && READ_METHODS.has(method)) return null;
  return route.module;
}
