export type LifecycleStatus =
  | 'NEW'
  | 'PENDING_VERIFICATION'
  | 'DRAFTING'
  | 'QUOTED'
  | 'REVISION'
  | 'APPROVED'
  | 'BOOKING_IN_PROGRESS'
  | 'CONFIRMED'
  | 'CLOSED_LOST'
  | 'BOOKING_FAILED'
  | 'CANCELLED';

export const LIFECYCLE_STATUSES: LifecycleStatus[] = [
  'NEW', 'PENDING_VERIFICATION', 'DRAFTING', 'QUOTED', 'REVISION', 'APPROVED',
  'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CLOSED_LOST', 'BOOKING_FAILED', 'CANCELLED',
];

// Signal Console semantic tokens grouped by what each status actually means,
// not one-hue-per-status: muted = not yet formalized, primary = actively in
// motion, warning = needs rep attention, success = positive milestone,
// destructive = terminal/negative. Only 5 tokens exist for 10 real statuses,
// so pairs share meaning deliberately rather than each getting a unique hue.
export const LIFECYCLE_STATUS_COLORS: Record<LifecycleStatus, string> = {
  NEW: 'bg-muted text-muted-foreground border-border',
  PENDING_VERIFICATION: 'bg-warning/10 text-warning border-warning/20',
  DRAFTING: 'bg-muted text-muted-foreground border-border',
  QUOTED: 'bg-primary/10 text-primary border-primary/20',
  BOOKING_IN_PROGRESS: 'bg-primary/10 text-primary border-primary/20',
  REVISION: 'bg-warning/10 text-warning border-warning/20',
  BOOKING_FAILED: 'bg-warning/10 text-warning border-warning/20',
  APPROVED: 'bg-success/10 text-success border-success/20',
  CONFIRMED: 'bg-success/10 text-success border-success/20',
  CLOSED_LOST: 'bg-destructive/10 text-destructive border-destructive/20',
  CANCELLED: 'bg-destructive/10 text-destructive border-destructive/20',
};

export const LIFECYCLE_STATUS_LABELS: Record<LifecycleStatus, string> = {
  NEW: 'New',
  PENDING_VERIFICATION: 'Needs Rep Attention',
  DRAFTING: 'Drafting',
  QUOTED: 'Quoted',
  REVISION: 'Revision',
  APPROVED: 'Approved',
  BOOKING_IN_PROGRESS: 'Booking in Progress',
  CONFIRMED: 'Confirmed',
  CLOSED_LOST: 'Closed Lost',
  BOOKING_FAILED: 'Booking Failed',
  CANCELLED: 'Cancelled',
};

export const LIFECYCLE_STATUS_INFO: Record<LifecycleStatus, string> = {
  NEW: 'Fresh lead, not yet drafted',
  PENDING_VERIFICATION: 'Unclaimed intake requiring rep attention',
  DRAFTING: 'Actively customizing itinerary and costs',
  QUOTED: 'Formal proposal sent to client',
  REVISION: 'Client requested changes to the quote',
  APPROVED: 'Client accepted terms, ready for live booking',
  BOOKING_IN_PROGRESS: 'Rep is securing live inventory',
  CONFIRMED: 'All inventory booked, invoice generated',
  CLOSED_LOST: 'Lead did not convert — reason required',
  BOOKING_FAILED: 'Booking attempt failed — needs intervention',
  CANCELLED: 'Cancelled after confirmation',
};

interface LeadStatusBadgeProps {
  status: LifecycleStatus | string;
  className?: string;
}

export default function LeadStatusBadge({ status, className = '' }: LeadStatusBadgeProps) {
  const color = LIFECYCLE_STATUS_COLORS[status as LifecycleStatus] || 'bg-muted text-muted-foreground border-border';
  const label = LIFECYCLE_STATUS_LABELS[status as LifecycleStatus] || status;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${color} ${className}`}>
      {label}
    </span>
  );
}
