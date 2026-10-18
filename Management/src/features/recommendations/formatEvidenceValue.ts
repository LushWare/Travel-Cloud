export function formatEvidenceValue(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }
  }
  return value == null ? 'Not recorded' : String(value);
}