import { describe, it, expect } from 'vitest';
import {
  CATALOGUE_VERSION,
  allToolNames,
  capabilitySummary,
  mayUseTool,
  toolsForActor,
} from '../catalogue.js';
import { ASSISTANT_TOOL_ACCESS } from '@travel-crm/contracts';
import { PUBLIC_TOOL_NAMES, toolNames } from '../../tools/toolRegistry.js';

describe('the catalogue covers the registry', () => {
  it('accounts for every registered tool, so one cannot arrive reachable by nobody', () => {
    // A tool in the registry and in neither vocabulary would be invisible both to
    // every actor and to the public turn, and nothing else would say so. The
    // registry is therefore exactly the union of the management vocabulary and
    // the public tools; the management half alone would now be the wrong
    // assertion, because the public catalogue tools are deliberately reachable
    // with no actor identity at all.
    expect([...allToolNames(), ...PUBLIC_TOOL_NAMES].sort()).toEqual(toolNames().sort());
  });

  it('stamps a version', () => {
    expect(CATALOGUE_VERSION).toBe('tool-catalogue.v1');
  });
});

describe('toolsForActor', () => {
  it('gives a superadmin everything, matching the platform-wide bypass', () => {
    expect(toolsForActor({ role: 'salesRep', isSuperAdmin: true }).sort()).toEqual(allToolNames().sort());
    expect(toolsForActor({ isSuperAdmin: true }).sort()).toEqual(allToolNames().sort());
  });

  it('gives a salesRep the tools their role can reach at the target routes', () => {
    const tools = toolsForActor({ role: 'salesRep' });

    expect(tools).toContain('getLead');
    expect(tools).toContain('listLeads');
    expect(tools).toContain('listInvoices');
  });

  it('gives an admin the tools a salesRep cannot reach, and withholds the personal one', () => {
    const admin = toolsForActor({ role: 'admin' });
    const salesRep = toolsForActor({ role: 'salesRep' });

    // The route behind each of these authorizes admin only...
    expect(admin).toContain('getPackagePerformance');
    expect(admin).toContain('getSalesPerformance');
    expect(salesRep).not.toContain('getPackagePerformance');
    expect(salesRep).not.toContain('getSalesPerformance');
    // ...and this one rejects an admin, which is why it is not an argument on the
    // team tool: the asymmetry is the route's, not the catalogue's invention.
    expect(salesRep).toContain('getMyPerformance');
    expect(admin).not.toContain('getMyPerformance');
  });

  it('gives a salesRep the cross-site reads their routes allow', () => {
    const tools = toolsForActor({ role: 'salesRep' });

    expect(tools).toContain('getDashboardSnapshot');
    expect(tools).toContain('getLeadAnalytics');
    expect(tools).toContain('searchPackages');
  });

  it('fails closed for a role with no declared access', () => {
    expect(toolsForActor({ role: 'customer' })).toEqual([]);
  });

  it('fails closed for an unknown or missing role rather than guessing', () => {
    expect(toolsForActor({ role: 'auditor' })).toEqual([]);
    expect(toolsForActor({})).toEqual([]);
    expect(toolsForActor()).toEqual([]);
    expect(toolsForActor({ role: undefined, isSuperAdmin: false })).toEqual([]);
  });
});

describe('mayUseTool', () => {
  it('answers per tool', () => {
    expect(mayUseTool({ role: 'salesRep' }, 'listLeads')).toBe(true);
    expect(mayUseTool({ role: 'customer' }, 'listLeads')).toBe(false);
    expect(mayUseTool({ role: 'customer', isSuperAdmin: true }, 'listLeads')).toBe(true);
  });
});

describe('capabilitySummary', () => {
  it('names what the actor can read, in the operator\'s words', () => {
    // Coarse subjects, deduped and sorted, so several tools reading the same thing
    // produce one noun rather than a tool inventory.
    expect(capabilitySummary({ role: 'salesRep' })).toBe(
      'company performance, invoices, leads, packages and your performance',
    );
    expect(capabilitySummary({ role: 'admin' })).toBe('company performance, invoices, leads and packages');
    expect(capabilitySummary({ isSuperAdmin: true })).toBe(
      'company performance, invoices, leads, packages and your performance',
    );
  });

  it('returns null for an actor who can read nothing, which must stay distinguishable from empty prose', () => {
    expect(capabilitySummary({ role: 'customer' })).toBeNull();
    expect(capabilitySummary({})).toBeNull();
  });

  it('labels every tool, so a newly granted tool cannot vanish from the capability line', () => {
    // A tool with no label contributes nothing, and the summary would quietly
    // under-describe what the scope can answer — the exact failure this line
    // exists to prevent.
    for (const [tool, roles] of Object.entries(ASSISTANT_TOOL_ACCESS)) {
      expect(capabilitySummary({ role: roles[0] }), `${tool} has no label`).not.toBeNull();
    }
  });
});
