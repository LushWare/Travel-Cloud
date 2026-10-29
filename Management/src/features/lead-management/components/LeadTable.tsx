import {
  MessageSquare,
  MessageCircle,
  Edit,
  FileText,
  Receipt,
  FileCheck,
  Ticket,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Phone,
  Mail,
  MapPin,
  Calendar,
  User,
  Package,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import AiLeadBadges from './AiLeadBadges';
import { Button } from '@/components/ui/button';
import { repLabelFor, repOptionId, type SalesRepOption } from '../utils/salesRepLabel';

interface LeadTableProps {
  leads: any[];
  loading: boolean;
  error: string | null;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
  onLeadClick: (lead: any) => void;
  onRemarksClick: (lead: any) => void;
  onWhatsappClick?: (lead: any) => void;
  onEditClick?: (lead: any) => void;
  onQuotationClick?: (lead: any) => void;
  onInvoiceClick?: (lead: any) => void;
  onReceiptClick?: (lead: any) => void;
  onVoucherClick?: (lead: any) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  leadsPerPage: number;
  totalLeads: number;
  highlightedLeadId?: string | null;
  onStatusClick?: (lead: any) => void;
  onSectionClick?: (lead: any) => void;
  onDeleteClick?: (lead: any) => void;
  onClaimClick?: (lead: any) => void;
  canDelete?: boolean;
  salesReps?: SalesRepOption[];
  onAssign?: (leadId: string, repId: string) => void;
  canChangeAssignment?: boolean;
  viewMode?: 'grid' | 'table';
}

const docActionClass = 'p-2 transition-colors bg-muted rounded-lg hover:bg-accent';
const docIconClass = 'w-4 h-4 text-muted-foreground';
const attentionStatusClass = 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
const bookingPendingStatusClass = 'bg-primary/10 text-primary border border-primary/20';

const menuItemClass =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted';

const needsRepAttention = (lead: any) => Boolean(
  lead?.needsRepFollowup
  || lead?.voiceNeedsRepReview
  || (lead?.lifecycleStatus === 'PENDING_VERIFICATION' && !lead?.convertedBookingId)
);

/**
 * In-cell assignment control, deliberately one 32px trigger so the Sales Rep
 * column stays narrow instead of carrying a full-width Select per row. It
 * serves both actions through the same interaction: assigning a lead that has
 * no owner, and handing one that does to somebody else. The second case is
 * admin-only, which the caller expresses by only rendering the picker when it
 * is allowed — and which the service enforces independently.
 */
const RepPicker = ({
  salesReps,
  value,
  label,
  onPick,
}: {
  salesReps: SalesRepOption[];
  value?: string;
  label: string;
  onPick: (repId: string) => void;
}) => {
  const isUnassigned = !value;
  return (
    <Popover>
      <PopoverTrigger
        className={`inline-flex h-8 max-w-[150px] items-center gap-1 rounded-lg px-2 text-sm transition-colors ${
          isUnassigned ? 'text-warning hover:bg-warning/10' : 'text-foreground hover:bg-muted'
        }`}
        aria-label={isUnassigned ? 'Assign this lead' : `Change assignee, currently ${label}`}
        title={isUnassigned ? 'Assign this lead' : `Assigned to ${label} — click to change`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {salesReps.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No sales reps available</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {salesReps.map((rep) => (
              <button
                key={repOptionId(rep)}
                type="button"
                className={menuItemClass}
                title={rep.name}
                onClick={() => onPick(repOptionId(rep))}
              >
                <span className="truncate">{rep.name}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const LeadTable = ({
  leads,
  loading,
  error,
  statusColors,
  statusLabels,
  onLeadClick,
  onRemarksClick,
  onWhatsappClick,
  onEditClick,
  onQuotationClick,
  onInvoiceClick,
  onReceiptClick,
  onVoucherClick,
  currentPage,
  totalPages,
  onPageChange,
  leadsPerPage,
  totalLeads,
  highlightedLeadId,
  onStatusClick,
  onSectionClick,
  onDeleteClick,
  onClaimClick,
  canDelete,
  salesReps,
  onAssign,
  canChangeAssignment,
  viewMode = 'grid',
}: LeadTableProps) => {
  const paginationStart = (currentPage - 1) * leadsPerPage + 1;
  const paginationEnd = Math.min(currentPage * leadsPerPage, totalLeads);

  const handleStatusClick = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    onStatusClick?.(lead);
  };

  const handleQuotationClick = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    onQuotationClick?.(lead);
  };

  const handleInvoiceClick = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    onInvoiceClick?.(lead);
  };

  const handleReceiptClick = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    onReceiptClick?.(lead);
  };

  const handleVoucherClick = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    onVoucherClick?.(lead);
  };

  const formatDateTime = (date: string | undefined) => {
    if (!date) return 'N/A';
    try {
      const d = new Date(date);
      const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return (
        <div className="max-w-[130px] truncate" title={`${dateStr} ${timeStr}`}>
          {dateStr} {timeStr}
        </div>
      );
    } catch (error) {
      return 'N/A';
    }
  };

  const formatDate = (date: string | undefined) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // `time` is not a field on the live lead model, which is why the Time column
  // has always rendered N/A; leadDateTime is the timestamp that does exist.
  const formatTime = (date: string | undefined) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getPackageDisplay = (lead: any) => {
    // Check for customized package first
    if (lead.customizedPackage?.name) {
      return {
        name: lead.customizedPackage.name,
        badge: (
          <span className="px-2 py-0.5 text-xs bg-chart-3/10 text-chart-3 rounded-full font-semibold" title="Customized Package">
            ✨ Custom
          </span>
        ),
        isCustom: true,
      };
    }

    // Check for regular package
    if (lead.package?.name || lead.packageName) {
      return { name: lead.package?.name || lead.packageName, badge: null, isCustom: false };
    }

    // Check for manual itinerary
    if (lead.manualItinerary?._id || lead.manualItinerary) {
      return {
        name: 'Manual Itinerary',
        badge: (
          <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full font-semibold" title="Manual Itinerary">
            📋 Manual
          </span>
        ),
        isCustom: false,
      };
    }

    // No package or itinerary
    return { name: 'N/A', badge: null, isCustom: false };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-muted-foreground">Loading leads...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/10">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!leads || leads.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p className="text-lg">No leads found</p>
        <p className="mt-2 text-sm">
          Try adjusting your search or filter criteria
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {leads.map((lead) => {
            const leadId = lead._id || lead.id;
            const isHighlighted = highlightedLeadId && leadId === highlightedLeadId;
            const packageInfo = getPackageDisplay(lead);
            const displayStatus = lead.lifecycleStatus;
            const showRepAttention = needsRepAttention(lead);
            const bookingPending = displayStatus === 'PENDING_VERIFICATION' && Boolean(lead.convertedBookingId);
            const statusColor = bookingPending
              ? bookingPendingStatusClass
              : statusColors[displayStatus] || statusColors.new;
            const statusLabel = bookingPending
              ? 'Booking Pending'
              : statusLabels[displayStatus] || 'New';

            return (
              <div
                key={leadId}
                onClick={() => onEditClick?.(lead)}
                className={`bg-card rounded-xl border-2 transition-all cursor-pointer group ${
                  isHighlighted ? 'border-primary ring-2 ring-primary/20 shadow-[var(--shadow-modal)]' : 'border-border hover:border-ring hover:shadow-[var(--shadow-card)]'
                }`}
              >
                {/* Card Header */}
                <div className="p-5 pb-4">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <h3 className="font-semibold text-foreground text-lg truncate group-hover:text-primary transition-colors">
                          {lead.name}
                        </h3>
                        <AiLeadBadges lead={lead} compact />
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        ID: {leadId?.slice(-8)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStatusClick?.(lead);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 ${statusColor}`}
                      >
                        {statusLabel}
                      </button>
                      {showRepAttention && displayStatus !== 'PENDING_VERIFICATION' && (
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 ${attentionStatusClass}`}>
                          Needs Rep Attention
                        </span>
                      )}
                      {displayStatus === 'PENDING_VERIFICATION' && onClaimClick && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClaimClick(lead);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20"
                          title="Claim Lead"
                        >
                          Claim
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
                              onDeleteClick?.(lead.id || lead._id);
                            }
                          }}
                          className="p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md transition-colors"
                          title="Delete Lead"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-2 mb-4">
                    {lead.phone && (
                      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{lead.phone}</span>
                      </div>
                    )}
                    {lead.email && (
                      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{lead.email}</span>
                      </div>
                    )}
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {lead.destination && (
                      <div className="flex items-center gap-2 text-muted-foreground bg-muted px-3 py-2 rounded-lg">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-xs font-medium">{lead.destination}</span>
                      </div>
                    )}
                    {lead.travelDate && (
                      <div className="flex items-center gap-2 text-muted-foreground bg-muted px-3 py-2 rounded-lg">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-xs font-medium">{formatDate(lead.travelDate)}</span>
                      </div>
                    )}
                  </div>

                  {/* Package & Rep */}
                  <div className="mt-3 space-y-2">
                    {packageInfo && (
                      <div className="flex items-center gap-2 text-sm">
                        <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground truncate">{packageInfo.name}</span>
                        {packageInfo.isCustom && (
                          <span className="px-1.5 py-0.5 bg-chart-3/10 text-chart-3 text-xs rounded font-medium shrink-0">
                            Custom
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className={`truncate ${lead.assignedToId ? 'text-muted-foreground' : 'text-warning font-medium'}`}>
                        {repLabelFor(lead.assignedToId, salesReps)}
                      </span>
                    </div>
                  </div>

                  {/* Remarks indicator */}
                  <div className="mt-3 flex items-center gap-4 flex-wrap">
                    {lead.remarks?.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemarksClick?.(lead);
                        }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{lead.remarks.length} remark{lead.remarks.length > 1 ? 's' : ''}</span>
                      </button>
                    )}
                    {(lead.phone || lead.whatsapp) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onWhatsappClick?.(lead);
                        }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-success transition-colors"
                        title="WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Document Actions Section */}
                <div className="px-5 py-4 bg-muted/50 rounded-b-xl border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Documents</p>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {/* Quotation */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuotationClick?.(lead);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2.5 bg-card border border-border rounded-lg hover:bg-primary/5 hover:border-primary/30 transition-all"
                      title="Create Quotation"
                    >
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-xs font-medium text-primary">Quote</span>
                    </button>

                    {/* Invoice */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onInvoiceClick?.(lead);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2.5 bg-card border border-border rounded-lg hover:bg-primary/5 hover:border-primary/30 transition-all"
                      title="Create Invoice"
                    >
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Receipt className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-xs font-medium text-primary">Invoice</span>
                    </button>

                    {/* Receipt */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onReceiptClick?.(lead);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2.5 bg-card border border-border rounded-lg hover:bg-primary/5 hover:border-primary/30 transition-all"
                      title="Create Receipt"
                    >
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <FileCheck className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-xs font-medium text-primary">Receipt</span>
                    </button>

                    {/* Voucher */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onVoucherClick?.(lead);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2.5 bg-card border border-border rounded-lg hover:bg-primary/5 hover:border-primary/30 transition-all"
                      title="Create Voucher"
                    >
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Ticket className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-xs font-medium text-primary">Voucher</span>
                    </button>

                    {/* View All Docs */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSectionClick?.(lead);
                      }}
                      className="flex flex-col items-center gap-1.5 p-2.5 bg-card border border-border rounded-lg hover:bg-muted transition-all"
                      title="View All Documents"
                    >
                      <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                        <FolderOpen className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">All</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card rounded-xl border border-border px-4 sm:px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium">{paginationStart}</span> to{' '}
              <span className="font-medium">{paginationEnd}</span> of{' '}
              <span className="font-medium">{totalLeads}</span> leads
            </p>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
                <ChevronLeft className="w-5 h-5" />
              </Button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) pageNum = i + 1;
                else if (currentPage <= 3) pageNum = i + 1;
                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = currentPage - 2 + i;

                return (
                  <button
                    key={pageNum}
                    onClick={() => onPageChange(pageNum)}
                    className={`min-w-[40px] h-10 text-sm font-medium rounded-lg transition-colors ${
                      currentPage === pageNum ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <Button variant="ghost" size="icon" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="relative overflow-x-auto bg-card border border-border rounded-lg shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="sticky left-0 z-10 px-4 py-3 text-xs font-bold tracking-wider border-r border-border bg-muted">ID</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[190px]">Sales Rep</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[150px]">Name</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[130px]">Contact No.</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[120px]">Departure</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[180px]">E-mail ID</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[130px]">Whatsapp</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[110px]">Travelers</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[150px]">Package</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[150px]">Destination</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[130px]">Platform</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[120px]">Travel Date</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[120px]">End Date</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[100px]">Time</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[120px]">Remarks</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border min-w-[140px]">Created Date/Time</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold border-r border-border sticky right-[172px] bg-muted z-10 min-w-[120px] shadow-[2px_0_4px_rgba(0,0,0,0.1)]">Status</TableHead>
              <TableHead className="px-4 py-3 text-xs font-bold sticky right-0 bg-muted z-10 min-w-[172px] shadow-[-2px_0_4px_rgba(0,0,0,0.1)]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const displayStatus = lead.lifecycleStatus;
              const showRepAttention = needsRepAttention(lead);
              const bookingPending = displayStatus === 'PENDING_VERIFICATION' && Boolean(lead.convertedBookingId);
              const statusColor = bookingPending
                ? bookingPendingStatusClass
                : (statusColors && statusColors[displayStatus]) || 'bg-muted text-muted-foreground';
              const statusLabel = bookingPending
                ? 'Booking Pending'
                : (statusLabels && statusLabels[displayStatus]) || lead.lifecycleStatus || 'N/A';
              const leadId = (lead._id || lead.id)?.toString();
              const repLabel = repLabelFor(lead.assignedToId, salesReps);
              const isHighlighted = highlightedLeadId && leadId === highlightedLeadId.toString();

              return (
                <TableRow
                  key={lead._id || lead.id}
                  id={isHighlighted ? `lead-${leadId}` : undefined}
                  className={`cursor-pointer group ${isHighlighted ? 'bg-warning/10 border-2 border-warning/40 shadow-[var(--shadow-modal)]' : ''}`}
                  onClick={() => onLeadClick(lead)}
                >
                  <TableCell className="px-4 py-2 text-sm font-bold border-r border-border sticky left-0 bg-card group-hover:bg-muted z-10 shadow-[2px_0_4px_rgba(0,0,0,0.1)]">
                    {(lead._id || lead.id).toString().substring(0, 8)}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border" onClick={(e) => e.stopPropagation()}>
                    {lead.assignedToId ? (
                      canChangeAssignment ? (
                        <RepPicker
                          salesReps={salesReps || []}
                          value={String(lead.assignedToId)}
                          label={repLabel}
                          onPick={(repId) => onAssign?.(String(lead._id || lead.id), repId)}
                        />
                      ) : (
                        <div className="max-w-[160px] truncate" title={repLabel}>{repLabel}</div>
                      )
                    ) : (
                      <RepPicker
                        salesReps={salesReps || []}
                        value={undefined}
                        label="Unassigned"
                        onPick={(repId) => onAssign?.(String(lead._id || lead.id), repId)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm font-semibold text-foreground border-r border-border">
                    {/* The table is the default view (LeadManagement defaults to
                        it at every desktop width), so the AI badges have to
                        live beside the name here too — a rep scanning rows must
                        not have to switch to grid view to spot AI involvement. */}
                    <div className="flex items-center gap-2">
                      <div className="max-w-[170px] truncate" title={String(lead.name || '')}>{lead.name || 'N/A'}</div>
                      <AiLeadBadges lead={lead} compact />
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[130px] truncate" title={String(lead.phone || '')}>{lead.phone || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[130px] truncate" title={String(lead.city || '')}>{lead.city || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[190px] truncate" title={String(lead.email || '')}>{lead.email || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[140px] truncate" title={String(lead.whatsapp || '')}>{lead.whatsapp || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">{lead.numberOfTravelers || 'N/A'}</TableCell>
                  <TableCell className="px-4 py-2 text-sm border-r border-border">
                    {(() => {
                      const packageInfo = getPackageDisplay(lead);
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground max-w-[150px] truncate" title={packageInfo.name}>{packageInfo.name}</span>
                          {packageInfo.badge}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[160px] truncate" title={String(lead.destination || '')}>{lead.destination || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    <div className="max-w-[120px] truncate" title={String(lead.platform || '')}>{lead.platform || 'N/A'}</div>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    {lead.travelDate ? new Date(lead.travelDate).toISOString().split('T')[0] : 'N/A'}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">
                    {lead.endDate ? new Date(lead.endDate).toISOString().split('T')[0] : 'N/A'}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm text-muted-foreground border-r border-border">{formatTime(lead.leadDateTime)}</TableCell>
                  <TableCell className="px-4 py-2 text-sm border-r border-border" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onRemarksClick(lead)}
                      title="View remarks"
                      className="inline-flex h-8 items-center gap-2 px-2 transition-colors rounded-lg hover:bg-muted"
                    >
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">{lead.remarks?.length || 0}</span>
                    </button>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-sm border-r border-border">{formatDateTime(lead.createdAt || lead.leadDateTime)}</TableCell>
                  <TableCell
                    className="px-4 py-2 whitespace-nowrap border-r border-border sticky right-[172px] bg-card group-hover:bg-muted z-10 shadow-[2px_0_4px_rgba(0,0,0,0.1)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      {showRepAttention && displayStatus !== 'PENDING_VERIFICATION' && (
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${attentionStatusClass}`}>
                          Needs Rep Attention
                        </span>
                      )}
                      <button
                        className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer hover:opacity-80 transition-opacity ${statusColor}`}
                        onClick={(e) => handleStatusClick(e, lead)}
                        title="Click to change status"
                      >
                        {statusLabel}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell
                    className="w-[172px] px-4 py-2 text-sm text-muted-foreground sticky right-0 bg-card group-hover:bg-muted z-10 shadow-[-2px_0_4px_rgba(0,0,0,0.1)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1">
                      <button onClick={() => onEditClick?.(lead)} className={docActionClass} title="Edit Lead" aria-label="Edit Lead">
                        <Edit className={docIconClass} />
                      </button>
                      <button onClick={(e) => handleQuotationClick(e, lead)} className={docActionClass} title="Quotation" aria-label="Quotation">
                        <FileText className={docIconClass} />
                      </button>
                      {(lead.phone || lead.whatsapp) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onWhatsappClick?.(lead);
                          }}
                          className={docActionClass}
                          title="WhatsApp"
                          aria-label="WhatsApp"
                        >
                          <MessageCircle className={docIconClass} />
                        </button>
                      )}
                      <Popover>
                        <PopoverTrigger className={docActionClass} title="More actions" aria-label="More actions">
                          <MoreHorizontal className={docIconClass} />
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-1" align="end">
                          <button type="button" onClick={(e) => handleInvoiceClick(e, lead)} className={menuItemClass} title="Invoice">
                            <Receipt className={docIconClass} />
                            <span>Invoice</span>
                          </button>
                          <button type="button" onClick={(e) => handleReceiptClick(e, lead)} className={menuItemClass} title="Payment Receipt">
                            <FileCheck className={docIconClass} />
                            <span>Payment Receipt</span>
                          </button>
                          <button type="button" onClick={(e) => handleVoucherClick(e, lead)} className={menuItemClass} title="Travel Voucher">
                            <Ticket className={docIconClass} />
                            <span>Travel Voucher</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSectionClick?.(lead);
                            }}
                            className={menuItemClass}
                            title="View Documents"
                          >
                            <FolderOpen className={docIconClass} />
                            <span>View Documents</span>
                          </button>
                          {displayStatus === 'PENDING_VERIFICATION' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onClaimClick?.(lead);
                              }}
                              className={menuItemClass}
                              title="Claim Lead"
                            >
                              <User className={docIconClass} />
                              <span>Claim Lead</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
                                  onDeleteClick?.(lead);
                                }
                              }}
                              className={`${menuItemClass} text-destructive hover:bg-destructive/10`}
                              title="Delete Lead"
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                              <span>Delete Lead</span>
                            </button>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      {totalLeads > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 mt-4 bg-card border border-border rounded-lg">
          <div className="text-sm text-muted-foreground">
            Showing {paginationStart} to {paginationEnd} of {totalLeads} leads
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
              Previous
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum;
              if (totalPages <= 7) pageNum = i + 1;
              else if (currentPage <= 4) pageNum = i + 1;
              else if (currentPage >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = currentPage - 3 + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    currentPage === pageNum ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <Button variant="outline" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default LeadTable;
