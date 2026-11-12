import { describe, it, expect } from 'vitest';
import { isModuleOff, moduleLockReason } from '../planModules';

describe('planModules', () => {
  it('reports a module listed in planModulesOff as off', () => {
    expect(isModuleOff({ planModulesOff: ['vendors'] }, 'vendors')).toBe(true);
  });

  it('reports a module not listed as on', () => {
    expect(isModuleOff({ planModulesOff: ['vendors'] }, 'finance_docs')).toBe(false);
  });

  it.each([null, undefined, {}, { planModulesOff: 'vendors' }])('treats %j as every module on', (user) => {
    expect(isModuleOff(user as never, 'vendors')).toBe(false);
  });

  it('describes a switched-off record module as view only', () => {
    expect(moduleLockReason({ planModulesOff: ['finance_docs'] }, 'finance_docs')).toMatch(/^View only/);
  });

  it('describes switched-off full analytics without "view only"', () => {
    expect(moduleLockReason({ planModulesOff: ['analytics_full'] }, 'analytics_full')).toMatch(/^Your agency's plan/);
  });

  it('gives no reason for an included module', () => {
    expect(moduleLockReason({ planModulesOff: [] }, 'whatsapp')).toBeNull();
  });
});
