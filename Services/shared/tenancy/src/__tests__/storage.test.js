import { describe, expect, it } from 'vitest';
import { agencyFolder, isAgencyFile, runWithTenant } from '../index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DEMO = '00000000-0000-4000-8000-000000000001';

describe('agency file storage', () => {
  it('puts uploads in the agency\'s own folder', () => {
    expect(runWithTenant(A, () => agencyFolder('packages'))).toBe(`travel-crm/tenants/${A}/packages`);
  });

  it('refuses to pick a folder without an agency', () => {
    expect(() => agencyFolder('packages')).toThrow(expect.objectContaining({ code: 'TENANT_CONTEXT_MISSING' }));
  });

  it('recognises the agency\'s own files', () => {
    expect(isAgencyFile(`travel-crm/tenants/${A}/packages/x`, A)).toBe(true);
  });

  it('refuses another agency\'s files', () => {
    expect(isAgencyFile(`travel-crm/tenants/${B}/packages/x`, A)).toBe(false);
  });

  it('refuses a path that tries to climb out of the folder', () => {
    expect(isAgencyFile(`travel-crm/tenants/${A}/../${B}/x`, A)).toBe(false);
  });

  it('gives files from before agencies existed to the demo agency only', () => {
    expect(isAgencyFile('travel-crm/packages/old-image', DEMO)).toBe(true);
    expect(isAgencyFile('travel-crm/packages/old-image', A)).toBe(false);
  });

  it('refuses a missing file name', () => {
    expect(isAgencyFile(undefined, A)).toBe(false);
  });
});
