import { useState, useEffect, useRef } from 'react';
import {
  Mail, Phone, Save, Loader2, Edit, Calendar, MessageSquare, MessageCircle, Plus,
  User, MapPin, Plane, Users, Globe, Package, ChevronDown, ChevronUp,
  Trash2, Check, RefreshCw, XCircle, Wallet, Sparkles, FileText, Eye, Calculator,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from '@/lib/toast';
import { leadAPI, packageAPI } from '../../../services/api';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import PhoneCountrySelect from '../../../components/PhoneCountrySelect';
import LocationAutocomplete from './LocationAutocomplete';
import ItineraryEditor from '../../itinerary/components/ItineraryEditor';
import DestinationSelector from '../../itinerary/components/DestinationSelector';
import { createDefaultDay } from '../../itinerary/types/index.js';
import { reconcileFlightsForSave } from '../../itinerary/utils/flightSync';
import LeadFlightBookingsSection from './LeadFlightBookingsSection';
import LeadHotelBookingsSection from './LeadHotelBookingsSection';
import LeadStatusBadge from './LeadStatusBadge';
import PricingSection from './PricingSection';
import LeadPricingView from './LeadPricingView';
import { toEditorDays } from '../utils/toEditorDays';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormDialogHeader, FormDialogBody, FormDialogSection, FormDialogFooter } from '@/components/shared/FormDialogSections';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import LeadAiCallsTab from './LeadAiCallsTab';
import { isAiHandled } from './AiLeadBadges';
import { checkQuoteAgainstBudget, formatMoney } from '../utils/quoteBudget';
import { COUNTRY_BY_CODE } from '@/data/countries';
import { formatPhoneToE164 } from '@/features/user-management/utils/phoneUtils';

// A lead can hold many packages at once, plus at most one manual
// (from-scratch) itinerary slot — this sentinel is the "add" picker's third
// option alongside real packages.
const MANUAL_ITINERARY_VALUE = '__manual__';

// Maps a /leads/:id/packages selection (server shape, materialized or
// derived) into the local editor-tab shape.
function mapSelection(raw: any) {
  return {
    id: raw.id,
    packageId: raw.packageId || null,
    isManual: Boolean(raw.isManual),
    packageName: raw.packageName || null,
    currentQuoteId: raw.currentQuoteId || null,
    isMaterialized: Boolean(raw.isMaterialized),
    itineraryDays: toEditorDays(raw.itineraryDays || []),
    pricingSettings: {
      marginType: raw.pricing?.marginType || null,
      marginValue: raw.pricing?.marginValue ?? 0,
      depositType: raw.pricing?.depositType || 'PERCENTAGE',
      depositValue: raw.pricing?.depositValue ?? 0,
      // Null = the Settings default tax rate.
      taxRate: raw.pricing?.taxRate ?? null,
      discountType: raw.pricing?.discountType || 'none',
      discountValue: raw.pricing?.discountValue ?? 0,
      serviceChargeRate: raw.pricing?.serviceChargeRate ?? 0,
    },
    // As last saved — the Pricing tab's breakdown reads these.
    costLines: raw.costLines || [],
    pricing: raw.pricing || null,
    derivationError: Boolean(raw.derivationError),
    dirty: false,
  };
}

function normalizePhoneInputValue(value: string, countryCode?: string | null) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const compact = trimmed.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;

  const selectedCountry = countryCode || 'LK';
  const callingCode = COUNTRY_BY_CODE[selectedCountry]?.phoneCode.replace(/\D/g, '');
  const digits = compact.replace(/\D/g, '');
  if (callingCode && digits.startsWith(callingCode) && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return formatPhoneToE164(trimmed, selectedCountry)?.e164 || '';
}

// ── Module-level components (prevents remounting on re-render) ──

interface EditInputFieldProps {
  label: string;
  required?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  testId?: string;
}

function EditInputField({ label, required, icon: Icon, children, testId }: EditInputFieldProps) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

const emptyFormData = {
  name: '',
  email: '',
  phone: '',
  whatsapp: '',
  numberOfTravelers: 1 as number | string,
  city: '',
  salesRep: '',
  assignedTo: '',
  destination: '',
  platform: '',
  travelDate: '',
  endDate: '',
  lifecycleStatus: 'NEW',
  budget: '',
};

type EditorSection = 'personal' | 'travel' | 'package' | 'pricing' | 'operations' | 'remarks';
type OperationsTab = 'flights' | 'hotels';

const EDITOR_SECTIONS: { id: EditorSection; label: string; icon: LucideIcon }[] = [
  { id: 'personal', label: 'Contact', icon: User },
  { id: 'travel', label: 'Travel', icon: Calendar },
  { id: 'package', label: 'Packages', icon: Package },
  { id: 'operations', label: 'Operations', icon: Plane },
  { id: 'pricing', label: 'Pricing', icon: Calculator },
  { id: 'remarks', label: 'Remarks', icon: MessageSquare },
];

interface EditLeadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  lead: any;
  salesReps: any[];
  onSuccess?: () => void;
  initialSelectionId?: string;
  onRequestStatusChange?: (lead: any, onStatusChanged: (status: string) => void) => void;
  /** Swap to the read-only View Details popup for this lead. */
  onViewDetails?: (lead: any) => void;
}

const EditLeadDialog = ({ isOpen, onClose, lead, salesReps, onSuccess, initialSelectionId, onRequestStatusChange, onViewDetails }: EditLeadDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [loadingSelections, setLoadingSelections] = useState(true);
  const [selectionLoadFailed, setSelectionLoadFailed] = useState(false);
  const [showItineraryEditor, setShowItineraryEditor] = useState(true);
  // One entry per attached package (plus the manual slot, if any) — see
  // mapSelection() for the shape. `dirty` marks a tab whose itinerary/pricing
  // has been edited locally and needs saving.
  const [selections, setSelections] = useState<any[]>([]);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [selectionLeadId, setSelectionLeadId] = useState<string | null>(null);
  const selectionLoadRequestRef = useRef(0);
  const [addingPackage, setAddingPackage] = useState(false);
  const [queuedPackageValue, setQueuedPackageValue] = useState('');
  const [refreshingSelectionId, setRefreshingSelectionId] = useState<string | null>(null);
  // Bumped whenever a transfer flight is added/edited/removed — those persist
  // straight to the DB and never touch itineraryDays/pricingSettings, so the
  // live pricing preview has no other way to know it needs to recompute.
  const [pricingRefreshToken, setPricingRefreshToken] = useState(0);
  const [remarks, setRemarks] = useState<any[]>([]);
  const [editingRemarkIndex, setEditingRemarkIndex] = useState<number | null>(null);
  const [editRemarkText, setEditRemarkText] = useState('');
  const [newRemarkText, setNewRemarkText] = useState('');
  const [showAddRemark, setShowAddRemark] = useState(false);
  const [activeSection, setActiveSection] = useState<EditorSection>('personal');
  const [activeOperationsTab, setActiveOperationsTab] = useState<OperationsTab>('flights');
  const [formData, setFormData] = useState(emptyFormData);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [activeView, setActiveView] = useState<'overview' | 'ai'>('overview');
  const snapshotRef = useRef<any>(null);

  const currentLeadId = lead ? String(lead._id || lead.id || '') : '';
  const activeSelection = selectionLeadId === currentLeadId
    ? selections.find((s) => s.id === activeSelectionId) || null
    : null;

  // Day-linked flight preferences live in day.flights[] but only day.transports[]
  // feeds cost lines — reconcile flights into a priced transport row (real price
  // wins when set, else the existing manual transport cost is preserved) before
  // this reaches pricing calculation or persistence. Same transform the package
  // editor already applies at save time (Management/src/features/itinerary/services/apiService.js).
  const reconcileDays = (days: any[]) => (days || []).map((day) => ({
    ...day,
    transports: reconcileFlightsForSave({ flights: day.flights || [], transports: day.transports || [] }),
  }));

  const selectSection = (section: string) => setActiveSection(section as EditorSection);

  useEffect(() => {
    if (isOpen) {
      fetchPackages();
      // The AI tab strip only exists for an AI-handled lead, so a lead that
      // merely needs a rep follow-up must not open on it — that lands on a body
      // with no switcher and no way back to Overview.
      setActiveView(isAiHandled(lead) && lead?.needsRepFollowup ? 'ai' : 'overview');
    }
  }, [isOpen, lead?.needsRepFollowup, lead?.aiHandled]);

  const fetchPackages = async () => {
    try {
      setLoadingPackages(true);
      const response = await packageAPI.getOptions();

      if (response && response.success === true && response.data) {
        const packagesList = (Array.isArray(response.data) ? response.data : [])
          .filter((pkg: any) => pkg.isActive !== false);
        setPackages(packagesList);
      } else {
        setPackages([]);
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
      setPackages([]);
    } finally {
      setLoadingPackages(false);
    }
  };

  useEffect(() => {
    const requestId = ++selectionLoadRequestRef.current;
    setSelections([]);
    setActiveSelectionId(null);
    setSelectionLeadId(null);
    setLoadingSelections(Boolean(lead));
    setSelectionLoadFailed(false);
    setQueuedPackageValue('');
    setActiveSection(initialSelectionId ? 'package' : 'personal');
    setActiveOperationsTab('flights');

    if (lead) void loadLeadIntoForm(requestId);

    return () => {
      if (selectionLoadRequestRef.current === requestId) selectionLoadRequestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);

  const loadLeadIntoForm = async (requestId: number) => {
    const leadId = lead._id || lead.id;
    const assignedTo = lead.assignedTo;
    const assignedToId = typeof assignedTo === 'object' && assignedTo !== null
      ? assignedTo._id || assignedTo.id || lead.assignedToId || ''
      : assignedTo || lead.assignedToId || '';
    const salesRepName = lead.salesRep || lead.adviser || '';

    const nextFormData = {
      name: lead.name || '',
      email: lead.email || '',
      phone: lead.phone || '',
      whatsapp: lead.whatsapp || '',
      numberOfTravelers: lead.numberOfTravelers || 1,
      city: lead.city || '',
      salesRep: salesRepName,
      assignedTo: assignedToId || (salesRepName ? '__name_only' : ''),
      destination: lead.destination || '',
      platform: ['Social_Media', 'Social Media', 'social_media', 'social-media'].includes(lead.platform)
        ? 'Facebook'
        : lead.platform || '',
      travelDate: lead.travelDate ? new Date(lead.travelDate).toISOString().split('T')[0] : '',
      endDate: lead.endDate ? new Date(lead.endDate).toISOString().split('T')[0] : '',
      lifecycleStatus: lead.lifecycleStatus || 'NEW',
      budget: lead.budget || '',
    };
    setFormData(nextFormData);
    setWhatsappSameAsPhone(!lead.whatsapp || lead.whatsapp === lead.phone);
    setRemarks(lead.remarks || []);

    if (!leadId) {
      setSelections([]);
      setActiveSelectionId(null);
      setSelectionLeadId(null);
      setLoadingSelections(false);
      snapshotRef.current = { formData: nextFormData, remarks: lead.remarks || [], selections: [] };
      return;
    }

    try {
      const selRes = await leadAPI.getPackageSelections(leadId);
      if (selectionLoadRequestRef.current !== requestId) return;
      const rawSelections = selRes?.data?.data || selRes?.data || [];
      const nextSelections = rawSelections.map(mapSelection);
      const preferredSelectionId = nextSelections.some((s: any) => s.id === initialSelectionId)
        ? initialSelectionId
        : nextSelections[0]?.id ?? null;
      setSelections(nextSelections);
      setActiveSelectionId(preferredSelectionId);
      setSelectionLeadId(String(leadId));
      setLoadingSelections(false);

      snapshotRef.current = {
        formData: nextFormData,
        remarks: lead.remarks || [],
        selections: nextSelections,
        activeSelectionId: preferredSelectionId,
      };
    } catch (error) {
      if (selectionLoadRequestRef.current !== requestId) return;
      console.error('Error loading lead package selections:', error);
      setSelections([]);
      setActiveSelectionId(null);
      setSelectionLeadId(String(leadId));
      setLoadingSelections(false);
      setSelectionLoadFailed(true);
      snapshotRef.current = { formData: nextFormData, remarks: lead.remarks || [], selections: [] };
    }
  };

  const revertToSnapshot = () => {
    const snapshot = snapshotRef.current;
    if (snapshot) {
      setFormData(snapshot.formData);
      setRemarks(snapshot.remarks);
      setSelections(snapshot.selections || []);
      setActiveSelectionId(snapshot.activeSelectionId ?? (snapshot.selections?.[0]?.id ?? null));
    }
  };

  const handleCancel = () => {
    revertToSnapshot();
    onClose();
  };

  // True when anything differs from what was loaded: contact/travel fields,
  // remarks, or a package tab whose itinerary/pricing was edited locally.
  const hasUnsavedChanges = () => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return false;
    return JSON.stringify(formData) !== JSON.stringify(snapshot.formData)
      || JSON.stringify(remarks) !== JSON.stringify(snapshot.remarks)
      || selections.some((s) => s.dirty);
  };

  const handleViewDetails = () => {
    if (!onViewDetails || !lead) return;
    if (hasUnsavedChanges() && !window.confirm('You have unsaved changes. Discard them and view details?')) return;
    // Not handleCancel(): onClose may resume a quotation/voucher flow, and the
    // parent's onViewDetails closes this dialog itself.
    revertToSnapshot();
    onViewDetails(lead);
  };

  const updateActiveSelection = (patch: any) => {
    setSelections((prev) => prev.map((s) => (
      s.id === activeSelectionId ? { ...s, ...patch, dirty: true } : s
    )));
  };

  const handleAddPackage = async (value: string) => {
    if (!lead || !value || selectionLoadFailed) return;
    if (loadingSelections) {
      setQueuedPackageValue(value);
      setAddingPackage(false);
      return;
    }
    const leadId = lead._id || lead.id;
    const isManual = value === MANUAL_ITINERARY_VALUE;

    try {
      const createRes = await leadAPI.addPackageSelection(leadId, isManual ? { isManual: true } : { packageId: value });
      const createdId = (createRes?.data?.data || createRes?.data)?.id;
      const detailRes = await leadAPI.getPackageSelection(leadId, createdId);
      const detail = detailRes?.data?.data || detailRes?.data;
      const newSelection = mapSelection(detail);
      setSelections((prev) => [...prev, newSelection]);
      setActiveSelectionId(newSelection.id);
      setAddingPackage(false);
      setShowItineraryEditor(true);
      toast.success(isManual ? 'Manual itinerary added' : 'Package added');
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  useEffect(() => {
    if (loadingSelections || !queuedPackageValue) return;
    const value = queuedPackageValue;
    setQueuedPackageValue('');
    void handleAddPackage(value);
    // handleAddPackage reads the current lead and selection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSelections, queuedPackageValue]);

  const handleRemoveSelection = async (selection: any) => {
    if (!lead || !selection) return;
    if (!window.confirm(`Remove ${selection.isManual ? 'the manual itinerary' : (selection.packageName || 'this package')} from this lead?`)) {
      return;
    }
    const leadId = lead._id || lead.id;
    try {
      await leadAPI.removePackageSelection(leadId, selection.id);
      setSelections((prev) => {
        const next = prev.filter((s) => s.id !== selection.id);
        if (activeSelectionId === selection.id) {
          setActiveSelectionId(next[0]?.id ?? null);
        }
        return next;
      });
      toast.success('Package removed');
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  const handleRefreshSelection = async (selection: any, force = false) => {
    if (!lead || !selection) return;
    const leadId = lead._id || lead.id;
    setRefreshingSelectionId(selection.id);
    try {
      await leadAPI.refreshPackageSelection(leadId, selection.id, force);
      const detailRes = await leadAPI.getPackageSelection(leadId, selection.id);
      const detail = detailRes?.data?.data || detailRes?.data;
      setSelections((prev) => prev.map((s) => (s.id === selection.id ? mapSelection(detail) : s)));
      toast.success('Reverted to the original package');
    } catch (err: any) {
      if (err.status === 409 && err.data?.code === 'REFRESH_BLOCKED_QUOTED') {
        const confirmed = window.confirm(
          'This package has already been quoted — refreshing will make the saved itinerary no longer match what the customer was quoted. Continue?'
        );
        if (confirmed) {
          setRefreshingSelectionId(null);
          await handleRefreshSelection(selection, true);
          return;
        }
      } else {
        toast.error(apiErrorMessage(err));
      }
    } finally {
      setRefreshingSelectionId(null);
    }
  };

  const handleSave = async () => {
    if (!lead) return;

    try {
      setIsSubmitting(true);
      const leadId = lead._id || lead.id;

      if (formData.assignedTo === '') {
        try {
          await leadAPI.assignLead(leadId, null);
        } catch (err) {
          console.error('Failed to unassign on server:', err);
          toast.error('Failed to unassign sales representative');
        }
      }

      // Persist each edited selection's itinerary + pricing before the
      // general lead update, mirroring the old single-package flow.
      const dirtySelections = selections.filter((s) => s.dirty);
      for (const selection of dirtySelections) {
        try {
          await leadAPI.updatePackageSelectionItinerary(leadId, selection.id, {
            days: reconcileDays(selection.itineraryDays),
            pricing: selection.pricingSettings,
          });
        } catch (itineraryError) {
          console.error('Error saving itinerary:', itineraryError);
          toast.error(`Failed to save itinerary for ${selection.packageName || 'the manual itinerary'}`);
          setIsSubmitting(false);
          return;
        }
      }

      const updateData: any = {
        name: formData.name?.trim() || undefined,
        phone: formData.phone || undefined,
        numberOfTravelers: formData.numberOfTravelers ? Number(formData.numberOfTravelers) : undefined,
        city: formData.city || undefined,
        destination: formData.destination || undefined,
        platform: formData.platform || undefined,
        travelDate: formData.travelDate || undefined,
        endDate: formData.endDate || undefined,
        whatsapp: formData.whatsapp || undefined,
        lifecycleStatus: formData.lifecycleStatus || 'NEW',
        // The customer's own figure; sent as-is so it can also be cleared.
        budget: formData.budget?.trim() ? formData.budget.trim() : null,
        remarks: remarks.length > 0 ? remarks : (lead?.remarks?.length ? [] : undefined),
      };
      if (formData.assignedTo && formData.assignedTo !== '' && formData.assignedTo !== '__name_only') {
        const rep = salesReps.find((r) => r.id === formData.assignedTo || r._id === formData.assignedTo);
        updateData.assignedTo = formData.assignedTo;
        updateData.salesRep = rep ? rep.name : formData.salesRep || undefined;
      }
      await leadAPI.updateLead(leadId, updateData);

      toast.success('Lead updated successfully');
      onSuccess?.();
      onClose();
    } catch (error: any) {
      toast.error(apiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !lead) return null;

  const showAiTab = isAiHandled(lead);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <DialogContent
        className="h-dvh w-screen max-w-none max-h-none rounded-none p-0 gap-0 overflow-hidden flex flex-col sm:h-[92vh] sm:w-[96vw] sm:max-w-[1440px] sm:max-h-[1000px] sm:rounded-xl"
        closeClassName="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground dark:hover:bg-primary-foreground/20 dark:hover:text-primary-foreground"
      >
        <FormDialogHeader
          icon={Edit}
          title="Edit Lead"
          subtitle={formData.name || 'Lead Details'}
          tabs={showAiTab ? [
            { key: 'overview', label: 'Overview', icon: FileText },
            { key: 'ai', label: 'AI', icon: Sparkles },
          ] : undefined}
          activeTab={activeView}
          onTabChange={(key) => setActiveView(key as 'overview' | 'ai')}
          actions={onViewDetails ? (
            <Button
              type="button"
              aria-label="View Details"
              onClick={handleViewDetails}
              className="bg-primary-foreground/15 text-primary-foreground ring-1 ring-primary-foreground/40 hover:bg-primary-foreground/25 sm:min-w-32"
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">View Details</span>
            </Button>
          ) : undefined}
        />

        {activeView === 'ai' ? (
          <>
            <FormDialogBody>
              <LeadAiCallsTab lead={lead} onVerified={onSuccess} />
            </FormDialogBody>
            <FormDialogFooter className="mt-auto">
              <Button type="button" variant="outline" onClick={handleCancel} className="flex-1">
                Close
              </Button>
            </FormDialogFooter>
          </>
        ) : (
        <>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <div
            role="tablist"
            aria-label="Edit lead sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r sm:p-3"
          >
            {EDITOR_SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                id={`${id}-tab`}
                type="button"
                role="tab"
                aria-selected={activeSection === id}
                aria-controls={`${id}-panel`}
                onClick={() => setActiveSection(id)}
                className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:w-full sm:justify-start ${
                  activeSection === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div
            id={`${activeSection}-panel`}
            role="tabpanel"
            aria-labelledby={`${activeSection}-tab`}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
        <FormDialogBody className="min-h-0 overscroll-y-contain [scrollbar-gutter:stable] [scroll-behavior:auto] [-webkit-overflow-scrolling:touch]">
          {activeSection === 'personal' && (
          <FormDialogSection
            id="personal"
            expanded
            onToggle={selectSection}
            icon={User}
            title="Personal Information"
            subtitle="Contact details of the lead"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {(lead?._id || lead?.id) && (
                  <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">Lead Status</span>
                      <LeadStatusBadge status={formData.lifecycleStatus} />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRequestStatusChange?.(lead, (status) => {
                        setFormData((previous) => ({ ...previous, lifecycleStatus: status }));
                      })}
                    >
                      Change Status
                    </Button>
                  </div>
                )}
                <EditInputField label="Full Name" required icon={User} testId="edit-lead-name">
                  <Input
                    type="text"
                    aria-label="Full Name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter full name"
                  />
                </EditInputField>

                <EditInputField label="Email Address" icon={Mail}>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@example.com"
                  />
                </EditInputField>

                <EditInputField label="Contact Number" required icon={Phone} testId="edit-lead-phone">
                  <PhoneInput
                    defaultCountry="LK"
                    countrySelectComponent={PhoneCountrySelect}
                    initialValueFormat="national"
                    value={normalizePhoneInputValue(formData.phone, lead?.fromCountry)}
                    onChange={(value) => {
                      const next = value || '';
                      setFormData((prev: any) => ({
                        ...prev,
                        phone: next,
                        whatsapp: whatsappSameAsPhone ? next : prev.whatsapp,
                      }));
                    }}
                    className="phone-input-wrapper"
                    placeholder="Enter phone number"
                  />
                </EditInputField>

                <div className="space-y-2" data-testid="edit-lead-whatsapp">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <MessageCircle className="w-4 h-4 text-muted-foreground" />
                      WhatsApp Number
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={whatsappSameAsPhone}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setWhatsappSameAsPhone(checked);
                          if (checked) {
                            setFormData((prev: any) => ({ ...prev, whatsapp: prev.phone }));
                          }
                        }}
                        className="size-3.5 accent-primary"
                      />
                      Same as phone number
                    </label>
                  </div>
                  <PhoneInput
                    defaultCountry="LK"
                    countrySelectComponent={PhoneCountrySelect}
                    initialValueFormat="national"
                    value={normalizePhoneInputValue(formData.whatsapp, lead?.fromCountry)}
                    onChange={(value) => setFormData({ ...formData, whatsapp: value || '' })}
                    className="phone-input-wrapper"
                    placeholder="Enter WhatsApp number"
                    disabled={whatsappSameAsPhone}
                  />
                </div>
              </div>
          </FormDialogSection>
          )}

          {activeSection === 'travel' && (
          <FormDialogSection
            id="travel"
            expanded
            onToggle={selectSection}
            icon={Plane}
            title="Travel Details"
            subtitle="Trip information and dates"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <EditInputField label="Departure City" icon={MapPin}>
                  <LocationAutocomplete
                    value={formData.city}
                    onChange={(value: string) => setFormData({ ...formData, city: value })}
                    placeholder="e.g., Colombo, Sri Lanka"
                    destination={formData.destination}
                  />
                </EditInputField>

                <EditInputField label="Destination" icon={MapPin}>
                  <DestinationSelector
                    value={formData.destination}
                    onChange={(event: any) =>
                      setFormData({ ...formData, destination: event.target.value })
                    }
                  />
                </EditInputField>

                <EditInputField label="Travel Date (Start)" icon={Calendar}>
                  <Input
                    type="date"
                    aria-label="Travel Date (Start)"
                    value={formData.travelDate}
                    onChange={(e) => setFormData({ ...formData, travelDate: e.target.value })}
                  />
                </EditInputField>

                <EditInputField label="End Date" icon={Calendar}>
                  <Input
                    type="date"
                    aria-label="End Date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    min={formData.travelDate || undefined}
                  />
                </EditInputField>

                <EditInputField label="Number of Travelers" icon={Users}>
                  <Input
                    type="number"
                    min="1"
                    aria-label="Number of Travelers"
                    value={formData.numberOfTravelers}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({
                        ...formData,
                        numberOfTravelers: value === '' ? '' : Math.max(1, Number(value)),
                      });
                    }}
                    placeholder="e.g., 2"
                  />
                </EditInputField>

                <EditInputField label="Customer Budget" icon={Wallet}>
                  <Input
                    type="text"
                    aria-label="Customer Budget"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    placeholder="What the customer wants to spend, e.g. USD 3,000"
                  />
                  {(() => {
                    const check = checkQuoteAgainstBudget({ budget: formData.budget, quoteTotal: lead?.quoteTotal });
                    if (!check.quote) {
                      return <p className="mt-1 text-xs text-muted-foreground">No package priced yet</p>;
                    }
                    return (
                      <p className={`mt-1 text-xs ${check.overBudget ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                        Quote total: {formatMoney(check.quote.amount, check.quote.currency)}
                        {check.overBudget && ` — ${formatMoney(check.overBy, check.quote.currency)} over budget`}
                      </p>
                    );
                  })()}
                </EditInputField>

                <EditInputField label="Lead Source" icon={Globe}>
                  <Select value={formData.platform} onValueChange={(v) => setFormData({ ...formData, platform: String(v) })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select Platform" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Website_Form">🌐 Website Form</SelectItem>
                      <SelectItem value="Facebook">Facebook</SelectItem>
                      <SelectItem value="Instagram">Instagram</SelectItem>
                      <SelectItem value="Google_Ads">Google Ads</SelectItem>
                      <SelectItem value="Phone_Call">📞 Phone Call</SelectItem>
                      <SelectItem value="Referral">🤝 Referral</SelectItem>
                      <SelectItem value="Email">📧 Email</SelectItem>
                      <SelectItem value="Walk_in">🚶 Walk-in</SelectItem>
                    </SelectContent>
                  </Select>
                </EditInputField>
              </div>
          </FormDialogSection>
          )}

          {activeSection === 'package' && (
          <FormDialogSection
            id="package"
            expanded
            onToggle={selectSection}
            icon={Package}
            title="Package & Assignment"
            subtitle="Select package and sales representative"
          >
                <div className="space-y-4">
                  <EditInputField label="Sales Representative" icon={User}>
                    <Select
                      value={formData.assignedTo || '__none__'}
                      onValueChange={(idValue) => {
                        const id = String(idValue);
                        if (id === '__none__') {
                          setFormData((prev) => ({ ...prev, assignedTo: '', salesRep: '' }));
                          return;
                        }
                        if (id === '__name_only') {
                          setFormData((prev) => ({ ...prev, assignedTo: '__name_only' }));
                          return;
                        }
                        const rep = salesReps.find((r) => r.id === id || r._id === id);
                        setFormData((prev) => ({ ...prev, assignedTo: id, salesRep: rep ? rep.name : '' }));
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Sales Rep">
                          {(value: string) => {
                            if (value === '__none__') return 'Select Sales Rep';
                            if (value === '__name_only') return formData.salesRep;
                            const rep = salesReps.find((r) => r.id === value || r._id === value);
                            return rep ? rep.name : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select Sales Rep</SelectItem>
                        {formData.salesRep && (!formData.assignedTo || formData.assignedTo === '__name_only') && (
                          <SelectItem value="__name_only">{formData.salesRep}</SelectItem>
                        )}
                        {salesReps.map((rep) => (
                          <SelectItem key={rep.id || rep._id} value={rep.id || rep._id}>{rep.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditInputField>

                  {/* Package tabs — a lead can hold many packages at once, plus one manual slot */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      Packages
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {selections.map((selection) => {
                        const label = selection.isManual ? 'Manual Itinerary' : (selection.packageName || 'Package');
                        const isActive = selection.id === activeSelectionId;
                        return (
                          <div
                            key={selection.id}
                            className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${
                              isActive ? 'bg-primary border-primary text-primary-foreground shadow-sm' : 'bg-card border-border text-foreground hover:border-primary/40'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => { setActiveSelectionId(selection.id); setShowItineraryEditor(true); }}
                              className="flex items-center gap-1.5"
                            >
                              {label}
                              {selection.currentQuoteId && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-primary-foreground/20' : 'bg-success/10 text-success'}`}>
                                  Quoted
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveSelection(selection)}
                              className={`p-0.5 rounded-full ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-destructive/10'}`}
                              title="Remove package"
                            >
                              <XCircle className={`w-3.5 h-3.5 ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground group-hover:text-destructive'}`} />
                            </button>
                          </div>
                        );
                      })}

                      {!addingPackage ? (
                        <button
                          type="button"
                          onClick={() => setAddingPackage(true)}
                          disabled={selectionLoadFailed}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border-2 border-dashed border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4" />
                          Add Package
                        </button>
                      ) : (
                        // Kept a real native <select> (not the Base UI Select
                        // primitive) - this dialog's own component test drives
                        // it with RTL's user.selectOptions and
                        // getByLabelText('Add package'), which needs a genuine
                        // <select>/<option> DOM tree.
                        <select
                          aria-label="Add package"
                          autoFocus
                          value=""
                          onChange={(e) => handleAddPackage(e.target.value)}
                          onBlur={() => setAddingPackage(false)}
                          disabled={selectionLoadFailed}
                          className="h-8 px-3 bg-transparent border-2 border-primary/30 rounded-xl text-sm focus:outline-none focus-visible:border-primary"
                        >
                          <option value="">{loadingPackages ? 'Loading packages...' : 'Select a package…'}</option>
                          {!selections.some((s) => s.isManual) && (
                            <option value={MANUAL_ITINERARY_VALUE}>Manual Itinerary (No Package)</option>
                          )}
                          {packages
                            .filter((pkg) => !selections.some((s) => s.packageId === (pkg._id || pkg.id)))
                            .map((pkg) => {
                              const optionId = pkg._id || pkg.id;
                              const label = pkg.title || pkg.name || 'Unnamed Package';
                              return (
                                <option key={optionId} value={optionId}>{label}</option>
                              );
                            })}
                        </select>
                      )}
                      {selectionLoadFailed && (
                        <p role="alert" className="basis-full text-xs text-destructive">
                          Could not load attached packages. Close and reopen this lead to retry.
                        </p>
                      )}
                      {queuedPackageValue && (
                        <p role="status" className="basis-full text-xs text-muted-foreground">
                          Waiting for attached package details before adding…
                        </p>
                      )}
                    </div>
                    {loadingSelections ? (
                      <p role="status" className="text-xs text-muted-foreground mt-2">Loading attached packages…</p>
                    ) : selections.length === 0 ? (
                      <p className="text-xs text-muted-foreground mt-2">No packages attached yet — add one to start building an itinerary and quotation.</p>
                    ) : null}
                  </div>
                </div>

                {/* Itinerary editor for the active tab — collapsed so the dialog stays clean */}
                {activeSelection && (
                  <div className="mt-4 bg-card rounded-2xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowItineraryEditor((v) => !v)}
                      className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Calendar className="w-4 h-4 text-primary" />
                        Itinerary Editor — {activeSelection.isManual ? 'Manual Itinerary' : (activeSelection.packageName || 'Package')}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({activeSelection.itineraryDays.length || 0} day{activeSelection.itineraryDays.length === 1 ? '' : 's'})
                        </span>
                      </span>
                      {showItineraryEditor ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>

                    {showItineraryEditor && (
                      <div className="p-4 border-t border-border space-y-3">
                        {!activeSelection.isManual && (
                          <div className="flex items-center justify-between px-1">
                            <span className="text-xs text-muted-foreground">
                              {activeSelection.isMaterialized
                                ? 'This itinerary has been customized for this lead.'
                                : 'Showing the original package itinerary — edit any field to customize it for this lead.'}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleRefreshSelection(activeSelection)}
                              disabled={!activeSelection.isMaterialized || refreshingSelectionId === activeSelection.id}
                              title={activeSelection.isMaterialized ? 'Discard customizations and revert to the original package' : 'Nothing to refresh — this is already the original package'}
                            >
                              {refreshingSelectionId === activeSelection.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Refresh from original package
                            </Button>
                          </div>
                        )}
                        <ItineraryEditor
                          days={activeSelection.itineraryDays}
                          compactDayNavigation
                          travelers={Number(formData.numberOfTravelers) || 1}
                          onDayChange={(dayNumber: number, dayData: any) => {
                            setSelections((prev) => prev.map((s) => (s.id === activeSelectionId ? {
                              ...s,
                              dirty: true,
                              itineraryDays: (s.itineraryDays || []).filter(Boolean).map((day: any) =>
                                day.dayNumber === dayNumber ? { ...day, ...dayData } : day
                              ),
                            } : s)));
                          }}
                          onAddDay={() => {
                            const newDayNumber = activeSelection.itineraryDays.length + 1;
                            updateActiveSelection({ itineraryDays: [...activeSelection.itineraryDays, createDefaultDay(newDayNumber)] });
                          }}
                          onRemoveDay={(dayNumber: number) => {
                            const filteredDays = activeSelection.itineraryDays.filter((day: any) => day.dayNumber !== dayNumber);
                            const renumberedDays = filteredDays.map((day: any, index: number) => ({ ...day, dayNumber: index + 1 }));
                            updateActiveSelection({ itineraryDays: renumberedDays });
                          }}
                          destination={formData.destination}
                          hideTitleAndDescription={true}
                        />
                      </div>
                    )}
                  </div>
                )}
          </FormDialogSection>
          )}

          {activeSection === 'remarks' && (
          <FormDialogSection
            id="remarks"
            expanded
            onToggle={selectSection}
            icon={MessageSquare}
            title="Remarks"
            subtitle="Add comments about this lead"
            count={remarks.length}
          >
              <div className="space-y-4">
                {/* Add New Remark Button */}
                {!showAddRemark && (
                  <Button type="button" variant="outline" onClick={() => setShowAddRemark(true)} className="w-full">
                    <Plus className="w-4 h-4" />
                    Add New Remark
                  </Button>
                )}

                {/* Add Remark Form */}
                {showAddRemark && (
                  <div className="p-4 bg-card rounded-xl border-2 border-primary/20 shadow-sm">
                    <label className="block text-sm font-semibold text-foreground mb-3">New Remark</label>
                    <Textarea
                      value={newRemarkText}
                      onChange={(e) => setNewRemarkText(e.target.value)}
                      className="resize-none mb-3"
                      rows={3}
                      placeholder="Enter your remark here..."
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setShowAddRemark(false);
                          setNewRemarkText('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (!newRemarkText.trim()) {
                            toast.error('Remark text cannot be empty');
                            return;
                          }
                          const newRemark = {
                            text: newRemarkText.trim(),
                            date: new Date(),
                            addedAt: new Date(),
                          };
                          setRemarks([...remarks, newRemark]);
                          setNewRemarkText('');
                          setShowAddRemark(false);
                          toast.success('Remark added');
                        }}
                      >
                        <Check className="w-4 h-4" />
                        Add Remark
                      </Button>
                    </div>
                  </div>
                )}

                {/* Remarks List */}
                <div className="space-y-3">
                  {remarks.length > 0 ? (
                    remarks.map((remark, index) => (
                      <div key={index} className="p-4 bg-card rounded-xl border border-border hover:border-primary/30 hover:shadow-[var(--shadow-card)] transition-all group">
                        {editingRemarkIndex === index ? (
                          <div className="space-y-3">
                            <Textarea
                              value={editRemarkText}
                              onChange={(e) => setEditRemarkText(e.target.value)}
                              className="resize-none"
                              rows={3}
                            />
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setEditingRemarkIndex(null);
                                  setEditRemarkText('');
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  if (!editRemarkText.trim()) {
                                    toast.error('Remark text cannot be empty');
                                    return;
                                  }
                                  const updatedRemarks = [...remarks];
                                  updatedRemarks[index] = {
                                    ...updatedRemarks[index],
                                    text: editRemarkText.trim(),
                                    date: updatedRemarks[index].date || new Date(),
                                    addedAt: updatedRemarks[index].addedAt || updatedRemarks[index].date || new Date(),
                                    addedBy: updatedRemarks[index].addedBy || updatedRemarks[index].addedBy?._id || updatedRemarks[index].addedBy?.id,
                                    ...(updatedRemarks[index]._id && { _id: updatedRemarks[index]._id }),
                                  };
                                  setRemarks(updatedRemarks);
                                  setEditingRemarkIndex(null);
                                  setEditRemarkText('');
                                  toast.success('Remark updated');
                                }}
                              >
                                <Save className="w-4 h-4" />
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm text-foreground flex-1">{remark.text}</p>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRemarkIndex(index);
                                    setEditRemarkText(remark.text || '');
                                  }}
                                  className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors"
                                  title="Edit"
                                >
                                  <Edit className="w-4 h-4 text-primary" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedRemarks = remarks.filter((_, i) => i !== index);
                                    setRemarks(updatedRemarks);
                                    toast.success('Remark deleted');
                                  }}
                                  className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
                              <span>
                                {remark.date ? new Date(remark.date).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                }) : 'No date'}
                              </span>
                              <span className="font-medium">#{index + 1}</span>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
                      <MessageSquare className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="text-sm font-medium">No remarks yet</p>
                      <p className="text-xs mt-1 text-muted-foreground">Add your first note</p>
                    </div>
                  )}
                </div>
              </div>
          </FormDialogSection>
          )}

          {activeSection === 'pricing' && (
          <FormDialogSection
            id="pricing"
            expanded
            onToggle={selectSection}
            icon={Calculator}
            title="Pricing"
            subtitle={`Margin, discount, tax and deposit/advance, and what each package costs for ${Number(formData.numberOfTravelers) || 1} traveller${(Number(formData.numberOfTravelers) || 1) === 1 ? '' : 's'}`}
          >
            {activeSelection ? (
              <div className="space-y-4">
                {selections.length > 1 && (
                  <div role="tablist" aria-label="Package to price" className="flex flex-wrap gap-2">
                    {selections.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="tab"
                        aria-selected={s.id === activeSelection.id}
                        onClick={() => setActiveSelectionId(s.id)}
                        className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                          s.id === activeSelection.id
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {s.isManual ? 'Manual Itinerary' : (s.packageName || 'Package')}
                      </button>
                    ))}
                  </div>
                )}

                <div className="bg-card rounded-xl border border-border p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3">
                    Pricing settings — {activeSelection.isManual ? 'Manual Itinerary' : (activeSelection.packageName || 'Package')}
                  </h3>
                  <PricingSection
                    key={activeSelection.id}
                    leadId={lead._id || lead.id}
                    selectionId={activeSelection.id}
                    days={reconcileDays(activeSelection.itineraryDays)}
                    travelers={Number(formData.numberOfTravelers) || 1}
                    pricing={activeSelection.pricingSettings}
                    refreshToken={pricingRefreshToken}
                    onSettingsChange={(settings: any) => updateActiveSelection({ pricingSettings: settings })}
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Breakdown</h3>
                  {(activeSelection.dirty || (Number(formData.numberOfTravelers) || 1) !== (Number(lead.numberOfTravelers) || 1)) && (
                    <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                      This breakdown shows the last saved prices. Save changes to update it.
                    </p>
                  )}
                  <LeadPricingView
                    key={activeSelection.id}
                    selections={[activeSelection]}
                    travelers={Number(lead.numberOfTravelers) || 1}
                  />
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Add a package in Packages to see its pricing</p>
              </div>
            )}
          </FormDialogSection>
          )}

          {activeSection === 'operations' && (
          <FormDialogSection
            id="operations"
            expanded
            onToggle={selectSection}
            icon={Plane}
            title="Operations"
            subtitle="Flight bookings and hotel bookings"
          >
            {(lead?._id || lead?.id) && (
              <div className="space-y-4">
              <div role="tablist" aria-label="Operations details" className="flex flex-wrap gap-2">
                {([
                  ['flights', 'Flight Bookings'],
                  ['hotels', 'Hotel Bookings'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`operations-${tab}-tab`}
                    aria-selected={activeOperationsTab === tab}
                    aria-controls={`operations-${tab}-panel`}
                    onClick={() => setActiveOperationsTab(tab)}
                    className={`shrink-0 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeOperationsTab === tab
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-card text-foreground hover:border-primary/40'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`operations-${activeOperationsTab}-panel`}
                aria-labelledby={`operations-${activeOperationsTab}-tab`}
                className="min-h-48"
              >
              {activeSelection ? (
                <>
                  {activeOperationsTab === 'flights' && (
                  <LeadFlightBookingsSection
                    leadId={lead._id || lead.id}
                    packageId={activeSelection.packageId || undefined}
                    selectionId={activeSelection.id}
                    leadStatus={formData.lifecycleStatus}
                    origin={formData.city || ''}
                    destination={activeSelection.destinationOverride || formData.destination || lead.destination || ''}
                    originCountry={lead.fromCountry || ''}
                    destinationCountry={lead.destinationCountry || ''}
                    itineraryDays={activeSelection.itineraryDays}
                    travelDate={formData.travelDate}
                    endDate={formData.endDate}
                    travelers={Number(formData.numberOfTravelers) || 1}
                    onUpdateDay={(dayNumber: number, updates: any) => {
                      updateActiveSelection({
                        itineraryDays: (activeSelection.itineraryDays || []).filter(Boolean).map((day: any) =>
                          day.dayNumber === dayNumber ? { ...day, ...updates } : day
                        ),
                      });
                    }}
                    onFlightsChanged={() => setPricingRefreshToken((t) => t + 1)}
                  />
                  )}

                  {activeOperationsTab === 'hotels' && (
                  <LeadHotelBookingsSection
                    leadId={lead._id || lead.id}
                    packageId={activeSelection.packageId || undefined}
                    leadStatus={formData.lifecycleStatus}
                    itineraryDays={activeSelection.itineraryDays}
                    travelDate={formData.travelDate}
                    destination={activeSelection.destinationOverride || lead.destination || ''}
                    country={lead.country || ''}
                    travelers={Number(formData.numberOfTravelers) || 1}
                    onUpdateDays={(updates) => updateActiveSelection({
                      itineraryDays: (activeSelection.itineraryDays || []).map((day: any) => {
                        const update = updates.find((item) => item.dayNumber === day.dayNumber);
                        return update ? { ...day, accommodation: update.accommodation } : day;
                      }),
                    })}
                  />
                  )}

                </>
              ) : (
                <div className="text-center py-6 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Add a package in Packages to manage its bookings</p>
                </div>
              )}
              </div>
              </div>
            )}
          </FormDialogSection>
          )}
        </FormDialogBody>
          </div>
        </div>

        <FormDialogFooter className="mt-auto">
          <Button type="button" variant="outline" onClick={handleCancel} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSubmitting} className="flex-1 sm:min-w-36 sm:flex-none">
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </Button>
        </FormDialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditLeadDialog;
