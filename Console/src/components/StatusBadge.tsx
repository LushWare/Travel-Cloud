import type { AgencyStatus } from '../lib/api';

const STYLE: Record<AgencyStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success/10 text-success ring-success/30' },
  trial: { label: 'Trial', className: 'bg-accent text-primary ring-primary/30' },
  past_due: { label: 'Unpaid', className: 'bg-warning/10 text-warning ring-warning/30' },
  suspended: { label: 'Suspended', className: 'bg-destructive/10 text-destructive ring-destructive/30' },
  pending_deletion: { label: 'Deleting', className: 'bg-muted text-muted-foreground ring-border' },
  deleted: { label: 'Deleted', className: 'bg-muted text-muted-foreground ring-border' },
};

export const STATUS_LABEL = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.label])) as Record<AgencyStatus, string>;

export default function StatusBadge({ status }: { status: AgencyStatus }) {
  const { label, className } = STYLE[status] ?? STYLE.active;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      {label}
    </span>
  );
}
