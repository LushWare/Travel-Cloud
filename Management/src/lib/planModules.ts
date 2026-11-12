// Plan modules the agency's plan leaves out arrive with the signed-in user as `planModulesOff`
// (auth-service, refreshed on every page load). The server enforces them; this only explains
// them in the UI before someone runs into a refusal.

export type PlanModule = 'finance_docs' | 'whatsapp' | 'vendors' | 'travel_booking' | 'analytics_full';

// Modules whose existing records stay viewable when the plan leaves them out.
const READ_ONLY_WHEN_OFF: ReadonlySet<PlanModule> = new Set(['finance_docs', 'vendors', 'travel_booking']);

export function isModuleOff(user: { planModulesOff?: unknown } | null | undefined, module: PlanModule): boolean {
  return Array.isArray(user?.planModulesOff) && user.planModulesOff.includes(module);
}

/** The sentence explaining a switched-off module, or null when the plan includes it. */
export function moduleLockReason(user: { planModulesOff?: unknown } | null | undefined, module: PlanModule): string | null {
  if (!isModuleOff(user, module)) return null;
  return READ_ONLY_WHEN_OFF.has(module)
    ? "View only: your agency's plan doesn't include this. Ask your agency owner about upgrading."
    : "Your agency's plan doesn't include this. Ask your agency owner about upgrading.";
}
