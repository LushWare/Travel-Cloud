import { useState } from 'react';
import { LIFECYCLE_STATUS_LABELS } from './LeadStatusBadge';
import type { LifecycleStatus } from './LeadStatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const STATUS_CHANGE_OPTIONS: { status: LifecycleStatus; label: string }[] = [
  { status: 'NEW', label: 'New' },
  { status: 'PENDING_VERIFICATION', label: 'Needs Rep Attention' },
  { status: 'DRAFTING', label: 'Drafting' },
  { status: 'QUOTED', label: 'Quoted' },
  { status: 'REVISION', label: 'Revision' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'BOOKING_IN_PROGRESS', label: 'Booking' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'CLOSED_LOST', label: 'Lost' },
];

const ALLOWED_STATUS_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  PENDING_VERIFICATION: ['NEW', 'CLOSED_LOST'],
  NEW: ['DRAFTING', 'CLOSED_LOST'],
  DRAFTING: ['QUOTED', 'CLOSED_LOST'],
  QUOTED: ['REVISION', 'APPROVED', 'CLOSED_LOST'],
  REVISION: ['DRAFTING', 'QUOTED', 'APPROVED', 'CLOSED_LOST'],
  APPROVED: ['BOOKING_IN_PROGRESS', 'CLOSED_LOST'],
  BOOKING_IN_PROGRESS: ['CONFIRMED', 'BOOKING_FAILED'],
  CONFIRMED: ['CANCELLED'],
  CLOSED_LOST: [],
  BOOKING_FAILED: ['BOOKING_IN_PROGRESS', 'REVISION', 'CLOSED_LOST'],
  CANCELLED: [],
};

const TRANSITION_REQUIREMENTS: Partial<Record<LifecycleStatus, string>> = {
  QUOTED: 'Requires a selling price greater than zero.',
  APPROVED: 'Requires a verified payment covering the deposit.',
  CONFIRMED: 'Requires actual flight and hotel costs.',
  CLOSED_LOST: 'Requires a loss reason.',
};

interface StatusChangeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  lead: { name: string; lifecycleStatus?: LifecycleStatus } | null;
  // Unused - StatusChangeDialog reads LIFECYCLE_STATUS_LABELS/INFO directly
  // rather than these; kept in the signature since the caller (LeadManagement
  // page) still passes them and dropping them isn't this migration's scope.
  statusLabels?: Record<string, string>;
  statusColors?: Record<string, string>;
  onStatusChange: (lead: any, status: LifecycleStatus, lostReason?: string) => void;
}

const StatusChangeDialog = ({ isOpen, onClose, lead, onStatusChange }: StatusChangeDialogProps) => {
  const [lostReason, setLostReason] = useState('');
  const [pendingStatus, setPendingStatus] = useState<LifecycleStatus | null>(null);

  if (!lead) return null;

  const handleChange = (status: LifecycleStatus) => {
    setPendingStatus(status);
    setLostReason('');
  };

  const handleConfirmChange = () => {
    if (!pendingStatus || (pendingStatus === 'CLOSED_LOST' && !lostReason.trim())) return;
    onStatusChange(lead, pendingStatus, pendingStatus === 'CLOSED_LOST' ? lostReason.trim() : undefined);
    setPendingStatus(null);
    setLostReason('');
  };

  const handleCancelChange = () => {
    setPendingStatus(null);
    setLostReason('');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setLostReason('');
      setPendingStatus(null);
      onClose();
    }
  };

  const currentStatus = lead.lifecycleStatus || 'NEW';
  const currentLabel = LIFECYCLE_STATUS_LABELS[currentStatus] || currentStatus;

  const getRestrictionReason = (status: LifecycleStatus) => {
    if (status === currentStatus) return 'This is the current status.';
    if (status === 'PENDING_VERIFICATION') {
      return 'Intake-only status; claim the lead to move it to New.';
    }
    if (currentStatus === 'CLOSED_LOST') return 'Closed Lost is a final status.';
    if (currentStatus === 'CANCELLED') return 'Cancelled is a final status.';
    if (!ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(status)) {
      return `Cannot move from ${currentLabel} to ${LIFECYCLE_STATUS_LABELS[status]} directly.`;
    }
    return undefined;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Update Status</DialogTitle>
          <DialogDescription>{lead.name}</DialogDescription>
        </DialogHeader>

        {pendingStatus ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <p className="font-medium text-foreground">Are you sure?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Change status from {currentLabel} to {STATUS_CHANGE_OPTIONS.find(({ status }) => status === pendingStatus)?.label}?
              </p>
            </div>
            {pendingStatus === 'CLOSED_LOST' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Loss Reason <span className="text-destructive">*</span>
                </label>
                <Textarea
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Why was this lead lost?"
                  rows={2}
                />
                {!lostReason.trim() && (
                  <p className="mt-1 text-xs text-destructive">Loss reason is required</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {STATUS_CHANGE_OPTIONS.map(({ status, label }) => {
              const restrictionReason = getRestrictionReason(status);
              const disabled = Boolean(restrictionReason);
              const requirement = !disabled && TRANSITION_REQUIREMENTS[status];

              return (
                <button
                  key={status}
                  onClick={() => handleChange(status)}
                  disabled={disabled}
                  className={`min-h-[76px] w-full rounded-lg border-2 px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70 sm:px-3 ${
                    currentStatus === status
                      ? 'border-primary bg-primary/10 text-primary'
                      : disabled
                        ? 'border-border bg-muted/40 text-muted-foreground'
                        : 'border-border text-foreground hover:border-ring hover:bg-muted'
                  }`}
                >
                  <span className="block font-medium">{label}</span>
                  {(restrictionReason || requirement) && (
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {restrictionReason || requirement}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {pendingStatus ? (
            <>
              <Button variant="outline" onClick={handleCancelChange} className="w-full">
                Cancel
              </Button>
              <Button
                variant={pendingStatus === 'CLOSED_LOST' ? 'destructive' : 'default'}
                onClick={handleConfirmChange}
                disabled={pendingStatus === 'CLOSED_LOST' && !lostReason.trim()}
                className="w-full"
              >
                {pendingStatus === 'CLOSED_LOST' ? 'Confirm Closed Lost' : 'Confirm'}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleOpenChange(false)} className="w-full">
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StatusChangeDialog;
