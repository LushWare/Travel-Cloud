import { useEffect, useState, type ReactNode } from 'react';
import {
  Calculator,
  Calendar,
  CalendarDays,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Hash,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Package,
  Pencil,
  Phone,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { leadAPI } from '../../../services/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormDialogHeader, FormDialogBody, FormDialogSection, FormDialogFooter } from '@/components/shared/FormDialogSections';
import { cn } from '@/lib/utils';
import AiLeadBadges from './AiLeadBadges';
import LeadStatusBadge from './LeadStatusBadge';
import LeadItineraryView from './LeadItineraryView';
import LeadPricingView from './LeadPricingView';
import { repLabelFor, type SalesRepOption } from '../utils/salesRepLabel';
import { checkQuoteAgainstBudget, formatMoney } from '../utils/quoteBudget';

interface LeadDetailsDialogProps {
  /** The lead to show; null keeps the dialog closed. */
  lead: any | null;
  onClose: () => void;
  onEdit: (lead: any) => void;
  salesReps?: SalesRepOption[];
  onRemarksClick?: (lead: any) => void;
  onWhatsappClick?: (lead: any) => void;
  onQuotationClick?: (lead: any) => void;
  onDocumentsClick?: (lead: any) => void;
}

type ViewSection = 'personal' | 'travel' | 'package' | 'itinerary' | 'pricing' | 'remarks';

// Same order, labels and icons as the Edit Lead dialog's section menu (plus a
// read-only Itinerary view), so the two dialogs read as one view/edit pair.
const VIEW_SECTIONS: { id: ViewSection; label: string; icon: LucideIcon }[] = [
  { id: 'personal', label: 'Contact', icon: User },
  { id: 'travel', label: 'Travel', icon: Calendar },
  { id: 'package', label: 'Packages', icon: Package },
  { id: 'itinerary', label: 'Itinerary', icon: CalendarDays },
  { id: 'pricing', label: 'Pricing', icon: Calculator },
  { id: 'remarks', label: 'Remarks', icon: MessageSquare },
];

interface SelectionsState {
  loading: boolean;
  failed: boolean;
  items: any[];
}

/** Loads the lead's package selections (each carries its itinerary days). */
function useSelections(leadId: string): SelectionsState {
  const [state, setState] = useState<SelectionsState>({ loading: Boolean(leadId), failed: false, items: [] });
  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    leadAPI.getPackageSelections(leadId)
      .then((res: any) => {
        if (cancelled) return;
        const raw = res?.data?.data || res?.data || [];
        setState({ loading: false, failed: false, items: Array.isArray(raw) ? raw : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, failed: true, items: [] });
      });
    return () => { cancelled = true; };
  }, [leadId]);
  return state;
}

function SelectionsStatus({ state, children }: { state: SelectionsState; children: ReactNode }) {
  if (state.loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading packages…
      </div>
    );
  }
  if (state.failed) {
    return <p className="py-2 text-sm text-destructive">Couldn't load this lead's packages.</p>;
  }
  return <>{children}</>;
}

const PLATFORM_LABELS: Record<string, string> = {
  Website_Form: 'Website Form',
  Google_Ads: 'Google Ads',
  Phone_Call: 'Phone Call',
  Walk_in: 'Walk-in',
};

function formatDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value: unknown): string | null {
  const date = formatDate(value);
  if (!date) return null;
  const time = new Date(String(value)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}

/** Nights between departure and return, or null when either date is missing. */
function nightsBetween(start: unknown, end: unknown): number | null {
  if (!start || !end) return null;
  const a = new Date(String(start)).getTime();
  const b = new Date(String(end)).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

const noop = () => {};

/** Read-only twin of the edit form's labelled input: same label, input-shaped value box. */
function ViewField({
  label,
  icon: Icon,
  children,
  hint,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        {label}
      </div>
      <div
        className={cn(
          'flex min-h-9 w-full items-center gap-2 break-words rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-sm',
          empty ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        <span className="min-w-0 flex-1">{empty ? '—' : children}</span>
        {!empty && hint && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function PackagesList({ items, onViewItinerary }: { items: any[]; onViewItinerary: () => void }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
        <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No packages attached yet</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((selection) => {
        const days = Array.isArray(selection.itineraryDays) ? selection.itineraryDays.length : 0;
        return (
          <li key={selection.id}>
            <button
              type="button"
              onClick={onViewItinerary}
              className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {selection.isManual ? <FileText className="h-5 w-5" /> : <Package className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {selection.isManual ? 'Manual Itinerary' : (selection.packageName || 'Package')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {days > 0 ? `${days} day${days === 1 ? '' : 's'} itinerary` : 'No itinerary days yet'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  selection.currentQuoteId ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                )}
              >
                {selection.currentQuoteId ? 'Quote sent' : 'Not quoted'}
              </span>
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                View itinerary <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function LeadDetailsContent({
  lead,
  onClose,
  onEdit,
  salesReps,
  onRemarksClick,
  onWhatsappClick,
  onQuotationClick,
  onDocumentsClick,
}: LeadDetailsDialogProps & { lead: any }) {
  const [activeSection, setActiveSection] = useState<ViewSection>('personal');

  const leadId = String(lead._id ?? lead.id ?? '');
  const selections = useSelections(leadId);
  const nights = nightsBetween(lead.travelDate, lead.endDate);
  const budget = lead.budget !== undefined && lead.budget !== null && lead.budget !== ''
    ? (Number.isFinite(Number(lead.budget)) ? Number(lead.budget).toLocaleString() : String(lead.budget))
    : null;
  const budgetCheck = checkQuoteAgainstBudget(lead);
  const remarks: any[] = Array.isArray(lead.remarks) ? lead.remarks : [];
  const sortedRemarks = [...remarks].sort(
    (a, b) => new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime()
  );

  return (
    <DialogContent
      className="h-dvh w-screen max-w-none max-h-none rounded-none p-0 gap-0 overflow-hidden flex flex-col sm:h-[92vh] sm:w-[96vw] sm:max-w-[1440px] sm:max-h-[1000px] sm:rounded-xl"
      closeClassName="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground dark:hover:bg-primary-foreground/20 dark:hover:text-primary-foreground"
    >
      <FormDialogHeader
        icon={Eye}
        title="Lead Details"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{lead.name || 'Unnamed lead'}</span>
            <AiLeadBadges lead={lead} />
          </span>
        }
        actions={
          <>
            {/* Labels hide on phones (icons stay, named via aria-label) so all three fit. */}
            {onDocumentsClick && (
              <Button
                type="button"
                variant="outline"
                aria-label="Documents"
                onClick={() => onDocumentsClick(lead)}
                className="border-transparent bg-card text-foreground hover:bg-muted"
              >
                <FolderOpen className="w-4 h-4" />
                <span className="hidden sm:inline">Documents</span>
              </Button>
            )}
            {onQuotationClick && (
              <Button
                type="button"
                variant="outline"
                aria-label="Quotation"
                onClick={() => onQuotationClick(lead)}
                className="border-transparent bg-card text-foreground hover:bg-muted"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">Quotation</span>
              </Button>
            )}
            <Button
              type="button"
              aria-label="Edit Lead"
              onClick={() => onEdit(lead)}
              className="bg-primary-foreground/15 text-primary-foreground ring-1 ring-primary-foreground/40 hover:bg-primary-foreground/25 sm:min-w-32"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Edit Lead</span>
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <div
          role="tablist"
          aria-label="Lead detail sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r sm:p-3"
        >
          {VIEW_SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`view-${id}-tab`}
              type="button"
              role="tab"
              aria-selected={activeSection === id}
              aria-controls={`view-${id}-panel`}
              onClick={() => setActiveSection(id)}
              className={cn(
                'flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:w-full sm:justify-start',
                activeSection === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{label}</span>
              {id === 'remarks' && remarks.length > 0 && (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 text-[11px] font-bold',
                    activeSection === id ? 'bg-primary-foreground/20' : 'bg-muted'
                  )}
                >
                  {remarks.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          id={`view-${activeSection}-panel`}
          role="tabpanel"
          aria-labelledby={`view-${activeSection}-tab`}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <FormDialogBody className="min-h-0 overscroll-y-contain [scrollbar-gutter:stable]">
            {activeSection === 'personal' && (
              <FormDialogSection
                id="personal"
                expanded
                onToggle={noop}
                icon={User}
                title="Personal Information"
                subtitle="Contact details of the lead"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">Lead Status</span>
                      <LeadStatusBadge status={lead.lifecycleStatus} />
                    </div>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <Hash className="h-3.5 w-3.5" />
                      {leadId.slice(0, 8)}
                    </span>
                  </div>
                  <ViewField label="Full Name" icon={User}>{lead.name}</ViewField>
                  <ViewField label="Email Address" icon={Mail}>
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="text-primary hover:underline">{lead.email}</a>
                    ) : null}
                  </ViewField>
                  <ViewField label="Contact Number" icon={Phone}>
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="text-primary hover:underline">{lead.phone}</a>
                    ) : null}
                  </ViewField>
                  <ViewField
                    label="WhatsApp Number"
                    icon={MessageCircle}
                    hint={(lead.whatsapp || lead.phone) && onWhatsappClick ? (
                      <button
                        type="button"
                        onClick={() => onWhatsappClick(lead)}
                        className="font-medium text-primary hover:underline"
                      >
                        Open chat
                      </button>
                    ) : null}
                  >
                    {lead.whatsapp}
                  </ViewField>
                </div>
              </FormDialogSection>
            )}

            {activeSection === 'travel' && (
              <FormDialogSection
                id="travel"
                expanded
                onToggle={noop}
                icon={Calendar}
                title="Travel Details"
                subtitle="Trip information and dates"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <ViewField label="Departure City" icon={MapPin}>{lead.city}</ViewField>
                  <ViewField label="Destination" icon={MapPin}>{lead.destination}</ViewField>
                  <ViewField label="Travel Date (Start)" icon={Calendar}>{formatDate(lead.travelDate)}</ViewField>
                  <ViewField
                    label="End Date"
                    icon={Calendar}
                    hint={nights !== null ? `${nights} night${nights === 1 ? '' : 's'}` : null}
                  >
                    {formatDate(lead.endDate)}
                  </ViewField>
                  <ViewField label="Number of Travelers" icon={Users}>{lead.numberOfTravelers}</ViewField>
                  <ViewField label="Customer Budget" icon={Wallet}>{budget}</ViewField>
                  <ViewField
                    label="Quote Total"
                    icon={Wallet}
                    hint={budgetCheck.overBudget ? (
                      <span className="font-medium text-warning">
                        {formatMoney(budgetCheck.overBy, budgetCheck.quote?.currency)} over budget
                      </span>
                    ) : null}
                  >
                    {budgetCheck.quote ? formatMoney(budgetCheck.quote.amount, budgetCheck.quote.currency) : null}
                  </ViewField>
                  <ViewField label="Lead Source" icon={Globe}>
                    {lead.platform ? (PLATFORM_LABELS[lead.platform] || lead.platform) : null}
                  </ViewField>
                  <ViewField label="Created" icon={Clock}>{formatDateTime(lead.createdAt || lead.leadDateTime)}</ViewField>
                </div>
              </FormDialogSection>
            )}

            {activeSection === 'package' && (
              <FormDialogSection
                id="package"
                expanded
                onToggle={noop}
                icon={Package}
                title="Package & Assignment"
                subtitle="Packages on this lead and the sales representative"
              >
                <div className="space-y-5">
                  <ViewField label="Sales Representative" icon={User}>
                    {lead.assignedToId
                      ? repLabelFor(lead.assignedToId, salesReps)
                      : <span className="text-warning">Unassigned</span>}
                  </ViewField>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      Packages
                    </div>
                    <SelectionsStatus state={selections}>
                      <PackagesList items={selections.items} onViewItinerary={() => setActiveSection('itinerary')} />
                    </SelectionsStatus>
                  </div>
                </div>
              </FormDialogSection>
            )}

            {activeSection === 'itinerary' && (
              <FormDialogSection
                id="itinerary"
                expanded
                onToggle={noop}
                icon={CalendarDays}
                title="Itinerary"
                subtitle="Day-by-day plan for this trip"
              >
                <SelectionsStatus state={selections}>
                  <LeadItineraryView selections={selections.items} travelDate={lead.travelDate} />
                </SelectionsStatus>
              </FormDialogSection>
            )}

            {activeSection === 'pricing' && (
              <FormDialogSection
                id="pricing"
                expanded
                onToggle={noop}
                icon={Calculator}
                title="Pricing"
                subtitle={`What each package costs for ${Math.max(1, Number(lead.numberOfTravelers) || 1)} traveller${Math.max(1, Number(lead.numberOfTravelers) || 1) === 1 ? '' : 's'}, per traveller and in total`}
              >
                <SelectionsStatus state={selections}>
                  <LeadPricingView
                    selections={selections.items}
                    travelers={Number(lead.numberOfTravelers) || 1}
                    primarySelectionId={lead.primarySelectionId}
                  />
                </SelectionsStatus>
              </FormDialogSection>
            )}

            {activeSection === 'remarks' && (
              <FormDialogSection
                id="remarks"
                expanded
                onToggle={noop}
                icon={MessageSquare}
                title="Remarks"
                subtitle="Comments about this lead, newest first"
                count={remarks.length}
              >
                <div className="space-y-4">
                  {onRemarksClick && (
                    <Button type="button" variant="outline" onClick={() => onRemarksClick(lead)} className="w-full">
                      <MessageSquare className="w-4 h-4" />
                      {remarks.length ? 'Manage remarks' : 'Add a remark'}
                    </Button>
                  )}
                  {sortedRemarks.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No remarks yet</p>
                    </div>
                  ) : (
                    <ol className="space-y-3">
                      {sortedRemarks.map((remark, index) => (
                        <li
                          key={remark?._id || remark?.id || index}
                          className="rounded-xl border border-border bg-muted/30 p-4"
                        >
                          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{remark?.text}</p>
                          {formatDateTime(remark?.date) && (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              {formatDateTime(remark?.date)}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </FormDialogSection>
            )}
          </FormDialogBody>
        </div>
      </div>

      <FormDialogFooter className="mt-auto">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1 sm:flex-none sm:min-w-28">
          Close
        </Button>
      </FormDialogFooter>
    </DialogContent>
  );
}

export default function LeadDetailsDialog(props: LeadDetailsDialogProps) {
  const { lead, onClose } = props;
  if (!lead) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Keyed by lead so the section menu resets to Contact for each lead. */}
      <LeadDetailsContent key={String(lead._id ?? lead.id ?? '')} {...props} lead={lead} />
    </Dialog>
  );
}
