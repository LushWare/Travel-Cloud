export const MIN_REASON = 5;

/** Says how much more to write, so a greyed-out button is never a mystery. */
export default function ReasonHint({ id, reason, note }: { id: string; reason: string; note?: string }) {
  const missing = MIN_REASON - reason.trim().length;
  return (
    <p id={id} className={`mt-1 text-xs ${missing > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
      {missing > 0
        ? `Write at least ${MIN_REASON} characters (${missing} more).`
        : note ?? 'Recorded in the agency\'s audit log.'}
    </p>
  );
}
