import { vi } from 'vitest';

// Unit tests never read the live agency Settings; a test that needs meal prices mocks them.
vi.mock('../src/config/pricingDefaults.js', () => ({
  getLinePricing: vi.fn().mockResolvedValue({}),
  _resetCache: vi.fn(),
}));
