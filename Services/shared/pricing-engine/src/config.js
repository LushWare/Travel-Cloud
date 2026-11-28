// No built-in prices: meal prices, margins and transport rates come from the
// agency's Settings (OrganizationSettings.pricingDefaults) or the day itself.
export const DEFAULTS = {
  defaultGroupSize: 1,
};

export function withDefaults(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}
