import { describe, it, expect } from 'vitest';
import { resolveCallerIdentity, buildDynamicVariables } from '../callerIdentity.service.js';

const DYNAMIC_VARIABLES = [
  'brand', 'caller_known', 'caller_name', 'destination', 'disclosure',
  'has_open_lead', 'open_trip_count', 'status_class',
];

describe('dynamic variables handed to the ElevenLabs agent', () => {
  it('sends exactly the variables the agent prompt reads, for an unknown caller', () => {
    const vars = buildDynamicVariables({
      identity: resolveCallerIdentity([]),
      voiceNumber: { label: 'Lushware Travel', disclosureText: 'Recorded.' },
    });
    expect(Object.keys(vars).sort()).toEqual(DYNAMIC_VARIABLES);
  });

  it('sends exactly the same variables for a known caller', () => {
    const vars = buildDynamicVariables({
      identity: resolveCallerIdentity([
        { leadId: 'lead-1', firstName: 'Nimal', statusClass: 'quote_sent', destination: 'Maldives' },
      ]),
      voiceNumber: { label: 'Lushware Travel', disclosureText: 'Recorded.' },
    });
    expect(Object.keys(vars).sort()).toEqual(DYNAMIC_VARIABLES);
  });

  it('sends every value as a string for prompt interpolation', () => {
    const vars = buildDynamicVariables({
      identity: resolveCallerIdentity([{ leadId: 'l', firstName: 'Nimal', statusClass: 'confirmed', destination: 'Bali' }]),
      voiceNumber: { label: 'Lushware Travel', disclosureText: 'Recorded.' },
    });
    Object.values(vars).forEach((v) => expect(typeof v).toBe('string'));
  });

  it('never sends a raw lifecycle status the agent could read aloud', () => {
    const vars = buildDynamicVariables({
      identity: resolveCallerIdentity([{ leadId: 'l', firstName: 'N', statusClass: 'quote_sent', destination: 'X' }]),
      voiceNumber: {},
    });
    ['NEW', 'PENDING_VERIFICATION', 'QUOTED', 'DRAFTING', 'APPROVED', 'CONFIRMED']
      .forEach((raw) => expect(Object.values(vars)).not.toContain(raw));
  });

  it('never sends a figure or an email in any variable', () => {
    const vars = buildDynamicVariables({
      identity: resolveCallerIdentity([{ leadId: 'l', firstName: 'Nimal', statusClass: 'quote_sent', destination: 'Maldives' }]),
      voiceNumber: { label: 'Lushware Travel' },
    });
    const joined = Object.values(vars).join(' ');
    expect(joined).not.toMatch(/\d+\.\d{2}/);
    expect(joined).not.toMatch(/@/);
  });
});
