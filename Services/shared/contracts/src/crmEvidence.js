export const LEAD_RECORD_FIELDS = [
  'id',
  'lifecycleStatus',
  'assignedToId',
  'name',
  'destination',
  'budget',
  'createdAt',
  'updatedAt',
];

export function leadEvidenceId(leadId, field) {
  return `lead:${leadId}:${field}`;
}

export function pageEvidenceId(pageKey, recordKind, recordId, field) {
  return `${pageKey}:${recordKind}:${recordId}:${field}`;
}