import { normalizePhone } from '../utils/phone.js';

export function resolveCallerIdentity(lookup = []) {
  const { matches, samePerson } = normalizeLookup(lookup);

  if (matches.length === 0) {
    return { outcome: 'NONE', leadId: null, variables: unknownCallerVariables() };
  }

  if (matches.length > 1 && !samePerson) {
    return { outcome: 'AMBIGUOUS', leadId: null, variables: unknownCallerVariables() };
  }

  const callerName = matches.find((m) => m.firstName)?.firstName || '';
  const live = matches.filter((m) => m.recency !== 'PAST');

  if (live.length === 0) {
    return {
      outcome: 'RETURNING',
      leadId: null,
      variables: {
        caller_known: 'true',
        caller_name: callerName,
        has_open_lead: 'false',
        status_class: '',
        destination: '',
        open_trip_count: '0',
      },
    };
  }

  const [current] = live;
  return {
    outcome: 'MATCHED',
    leadId: current.leadId ?? null,
    variables: {
      caller_known: 'true',
      caller_name: callerName,
      has_open_lead: 'true',
      status_class: current.statusClass || 'in_progress',
      destination: current.destination || '',
      open_trip_count: String(live.length),
    },
  };
}

function normalizeLookup(lookup) {
  if (Array.isArray(lookup)) return { matches: lookup, samePerson: lookup.length <= 1 };
  return {
    matches: Array.isArray(lookup?.matches) ? lookup.matches : [],
    samePerson: lookup?.samePerson === true,
  };
}

function unknownCallerVariables() {
  return {
    caller_known: 'false',
    caller_name: '',
    has_open_lead: 'false',
    status_class: '',
    destination: '',
    open_trip_count: '0',
  };
}

/**
 * Dynamic variables handed to ElevenLabs. Deliberately a whitelist built from
 * scratch rather than a spread of the lead — a field that is never assembled
 * cannot be spoken by the agent.
 */
export function buildDynamicVariables({ identity, voiceNumber }) {
  return {
    ...identity.variables,
    brand: voiceNumber?.label || 'our travel team',
    disclosure: voiceNumber?.disclosureText || '',
  };
}

export function normalizeCaller(fromNumber) {
  return normalizePhone(fromNumber);
}
