import { useState, useEffect } from 'react';
import {
  X, Plus, Loader2, Calendar, User, Mail, Phone,
  MapPin, Plane, Users, Globe, Package, MessageSquare, MessageCircle,
  ChevronDown, ChevronUp, Sparkles, Save, ArrowRightLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from '@/lib/toast';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { OPTIONAL_FLIGHT_TYPE } from '@travel-crm/constants';
import { leadAPI, packageAPI } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import LocationAutocomplete from './LocationAutocomplete';
import CountrySelect from '../../../components/CountrySelect';
import PhoneCountrySelect from '../../../components/PhoneCountrySelect';
import { FlightSelectionModal, FlightPreferenceCard } from '../../shared';
import { getOutboundModalDefaults, oppositeLeg } from '../../shared/utils/flightLegDefaults';
import PricingSection from './PricingSection';
import ItineraryEditor from '../../itinerary/components/ItineraryEditor';
import { createDefaultDay } from '../../itinerary/types/index.js';
import { reconcileFlightsForSave } from '../../itinerary/utils/flightSync';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FormDialogHeader, FormDialogBody, FormDialogSection, FormDialogFooter } from '@/components/shared/FormDialogSections';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

// A lead has one package or a manual (from-scratch) itinerary, never both —
// this sentinel is a third option inside the Package select itself.
const MANUAL_ITINERARY_VALUE = '__manual__';

// ── Module-level components (NOT inside NewLeadDialog — prevents remounting) ──

interface InputFieldProps {
  label: string;
  required?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  testId?: string;
}

function InputField({ label, required, icon: Icon, children, testId }: InputFieldProps) {
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

interface SalesRep {
  id: string;
  name: string;
}

interface NewLeadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  salesReps: SalesRep[];
  onSuccess?: () => void;
}

const NewLeadDialog = ({ isOpen, onClose, salesReps, onSuccess }: NewLeadDialogProps) => {
  const { user } = useAuth();
  const isSalesRep = user?.role === 'salesRep';
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [showTransferFlightModal, setShowTransferFlightModal] = useState(false);
  const [transferFlightType, setTransferFlightType] = useState<'inbound' | 'outbound'>('inbound');
  const [itineraryDays, setItineraryDays] = useState<any[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    personal: true,
    travel: true,
    package: true,
    remarks: false,
    transfers: false,
  });
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [formData, setFormData] = useState<any>({
    name: '',
    email: '',
    phone: '',
    whatsapp: '',
    numberOfTravelers: 1,
    city: '',
    salesRep: '',
    assignedTo: '',
    fromCountry: '',
    platform: '',
    travelDate: '',
    endDate: '',
    package: '',
    packageName: '',
    isManualItinerary: false,
    // Flight preference objects from template modal
    inboundFlightPrefs: null,
    outboundFlightPrefs: null,
    remarks: [{ text: '', date: '' }],
  });

  // Fetch packages when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchPackages();
      if (isSalesRep && user?._id) {
        setFormData((prev: any) => ({ ...prev, assignedTo: user._id, salesRep: user.name || '' }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isSalesRep, user?._id]);

  const fetchPackages = async () => {
    try {
      setLoadingPackages(true);
      const response = await packageAPI.getAll();

      if (response && response.success === true && response.data) {
        let packagesList = Array.isArray(response.data) ? response.data : [];
        packagesList = packagesList.filter((pkg: any) => pkg.isActive !== false);
        setPackages(packagesList);
      } else {
        setPackages([]);
      }
    } catch (error: any) {
      console.error('Error fetching packages:', error);
      setPackages([]);
      if (error.message && !error.message.includes('401') && !error.message.includes('403')) {
        toast.error('Failed to load packages');
      }
    } finally {
      setLoadingPackages(false);
    }
  };

  const addRemarkField = () => {
    setFormData({ ...formData, remarks: [...formData.remarks, { text: '', date: '' }] });
  };

  const updateRemark = (index: number, field: string, value: string) => {
    const updatedRemarks = [...formData.remarks];
    updatedRemarks[index] = { ...updatedRemarks[index], [field]: value };
    setFormData({ ...formData, remarks: updatedRemarks });
  };

  const removeRemark = (index: number) => {
    const updatedRemarks = formData.remarks.filter((_: any, i: number) => i !== index);
    setFormData({ ...formData, remarks: updatedRemarks.length > 0 ? updatedRemarks : [{ text: '', date: '' }] });
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handlePackageSelect = async (value: string) => {
    if (value === MANUAL_ITINERARY_VALUE) {
      setFormData((prev: any) => ({ ...prev, package: '', packageName: '', isManualItinerary: true }));
      setItineraryDays((prev) => (prev && prev.length > 0 ? prev : [createDefaultDay(1)]));
      return;
    }

    const packageId = value;
    const selectedPackage = packages.find((pkg) => (pkg._id || pkg.id) === packageId);
    setFormData((prev: any) => ({
      ...prev,
      package: packageId,
      packageName: selectedPackage?.title || selectedPackage?.name || '',
      destination: selectedPackage?.destination || prev.destination,
      isManualItinerary: false,
    }));

    // Load the blueprint days for the live pricing preview
    if (packageId && selectedPackage) {
      try {
        const response = await packageAPI.getById(packageId);
        if (response.success || response.status === 'success') {
          const pkg = response.data?.data || response.data;
          setItineraryDays(Array.isArray(pkg?.itineraryDays) ? pkg.itineraryDays : []);
        }
      } catch (err) {
        console.error('Error loading package itinerary:', err);
        setItineraryDays([]);
      }
    } else {
      setItineraryDays([]);
    }
  };

  const handleSubmit = async (lifecycleStatus = 'NEW') => {
    try {
      setIsSubmitting(true);
      const assignedTo = isSalesRep && user?._id ? user._id : (formData.assignedTo || undefined);
      const salesRepName = isSalesRep && user?.name ? user.name : (formData.salesRep || undefined);

      const leadData = {
        name: formData.name?.trim() || undefined,
        email: formData.email?.trim() || undefined,
        phone: formData.phone || undefined,
        city: formData.city || undefined,
        fromCountry: formData.fromCountry || undefined,
        whatsapp: formData.whatsapp || undefined,
        salesRep: salesRepName,
        assignedTo: assignedTo,
        platform: formData.platform || 'Manual_Entry',
        source: 'manual',
        travelDate: formData.travelDate || undefined,
        endDate: formData.endDate || undefined,
        packageId: formData.package || undefined,
        packageName: formData.packageName || undefined,
        isManualItinerary: formData.isManualItinerary,
        numberOfTravelers: formData.numberOfTravelers ? Number(formData.numberOfTravelers) : undefined,
        remarks: formData.remarks.filter((r: any) => r.text.trim() !== '').map((r: any) => ({
          text: r.text.trim(),
          date: r.date || new Date().toISOString().split('T')[0],
        })),
        lifecycleStatus,
      };

      const response = await leadAPI.createLead(leadData);
      const leadId = response.data?._id || response.data?.id;
      // createLead creates at most one initial package selection (the
      // package/manual choice made above) — resolve its id for the
      // selection-scoped follow-up calls below.
      const selectionId = response.data?.packageSelections?.[0]?.id;

      toast.success('Lead created successfully');

      if (leadId && selectionId) {
        const flightSaves = [];
        if (formData.inboundFlightPrefs) {
          flightSaves.push(leadAPI.addSelectionFlight(leadId, selectionId, {
            flightType: OPTIONAL_FLIGHT_TYPE.TO_START,
            ...formData.inboundFlightPrefs,
          }));
        }
        if (formData.outboundFlightPrefs) {
          flightSaves.push(leadAPI.addSelectionFlight(leadId, selectionId, {
            flightType: OPTIONAL_FLIGHT_TYPE.RETURN_HOME,
            ...formData.outboundFlightPrefs,
          }));
        }
        if (flightSaves.length > 0) {
          const results = await Promise.allSettled(flightSaves);
          if (results.some((r) => r.status === 'rejected')) {
            toast.error('Lead created, but some flight preferences failed to save');
          }
        }

        if (formData.isManualItinerary && itineraryDays.length > 0) {
          const reconciledDays = itineraryDays.map((day) => ({
            ...day,
            transports: reconcileFlightsForSave({ flights: day.flights || [], transports: day.transports || [] }),
          }));
          try {
            await leadAPI.updatePackageSelectionItinerary(leadId, selectionId, { days: reconciledDays, pricing: {} });
          } catch (itineraryError) {
            console.error('Error saving custom itinerary:', itineraryError);
            toast.error('Lead created, but the custom itinerary failed to save');
          }
        }
      }

      setFormData({
        name: '',
        email: '',
        phone: '',
        numberOfTravelers: 1,
        city: '',
        whatsapp: '',
        salesRep: '',
        assignedTo: '',
        fromCountry: '',
        platform: '',
        travelDate: '',
        endDate: '',
        package: '',
        packageName: '',
        isManualItinerary: false,
        inboundFlightPrefs: null,
        outboundFlightPrefs: null,
        remarks: [{ text: '', date: '' }],
      });
      setItineraryDays([]);

      onSuccess?.();
      onClose();
    } catch (error: any) {
      toast.error(apiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-4xl max-h-[95vh] p-0 gap-0 overflow-hidden flex flex-col"
        closeClassName="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground dark:hover:bg-primary-foreground/20 dark:hover:text-primary-foreground"
      >
        <FormDialogHeader icon={Sparkles} title="Create New Lead" subtitle="Fill in the details to add a new lead" />

        <FormDialogBody>
          <FormDialogSection
            id="personal"
            expanded={expandedSections.personal}
            onToggle={toggleSection}
            icon={User}
            title="Personal Information"
            subtitle="Contact details of the lead"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Full Name" required icon={User} testId="new-lead-name">
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter full name"
                  />
                </InputField>

                <InputField label="Email Address" icon={Mail}>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@example.com"
                  />
                </InputField>

                <InputField label="Contact Number" required icon={Phone} testId="new-lead-phone">
                  <PhoneInput
                    defaultCountry="LK"
                    countrySelectComponent={PhoneCountrySelect}
                    initialValueFormat="national"
                    value={formData.phone}
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
                </InputField>

                <div className="space-y-2" data-testid="new-lead-whatsapp">
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
                    value={formData.whatsapp}
                    onChange={(value) => setFormData({ ...formData, whatsapp: value || '' })}
                    className="phone-input-wrapper"
                    placeholder="Enter WhatsApp number"
                    disabled={whatsappSameAsPhone}
                  />
                </div>
              </div>
          </FormDialogSection>

          <FormDialogSection
            id="travel"
            expanded={expandedSections.travel}
            onToggle={toggleSection}
            icon={Plane}
            title="Travel Details"
            subtitle="Trip information and dates"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Departure City" icon={MapPin}>
                  <LocationAutocomplete
                    value={formData.city}
                    onChange={(value: string) => setFormData({ ...formData, city: value })}
                    placeholder="e.g., Colombo, Sri Lanka"
                  />
                </InputField>

                <InputField label="Country of Residence" icon={Globe}>
                  <CountrySelect
                    value={formData.fromCountry}
                    onChange={(code: string) => setFormData({ ...formData, fromCountry: code })}
                    placeholder="Search country..."
                  />
                </InputField>

                <InputField label="Travel Date" icon={Calendar}>
                  <Input
                    type="date"
                    value={formData.travelDate}
                    onChange={(e) => setFormData({ ...formData, travelDate: e.target.value })}
                  />
                </InputField>

                <InputField label="Return Date" icon={Calendar}>
                  <Input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    min={formData.travelDate || undefined}
                  />
                </InputField>

                <InputField label="Number of Travelers" icon={Users}>
                  <Input
                    type="number"
                    min="1"
                    value={formData.numberOfTravelers}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData({ ...formData, numberOfTravelers: value === '' ? '' : Math.max(1, Number(value)) });
                    }}
                    placeholder="e.g., 2"
                  />
                </InputField>

                <InputField label="Lead Source" icon={Globe}>
                  <Select value={formData.platform} onValueChange={(v) => setFormData({ ...formData, platform: String(v) })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select Source" /></SelectTrigger>
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
                </InputField>
              </div>
          </FormDialogSection>

          <FormDialogSection
            id="package"
            expanded={expandedSections.package}
            onToggle={toggleSection}
            icon={Package}
            title="Package & Assignment"
            subtitle="Select package and sales representative"
          >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/*
                  This <select> is intentionally kept a real native element, not
                  the Base UI Select primitive: e2e/leads/lead-lifecycle.spec.js
                  drives it with Playwright's native `.selectOption({label})`,
                  which requires an actual <select>/<option> DOM - Base UI's
                  Select renders a button-based combobox with no native <select>
                  in the DOM at all, which would break this interaction model
                  entirely (not just a label mismatch). Retoned via plain
                  Tailwind classes at the same visual weight as the rest of the
                  form instead.
                */}
                <InputField label="Package" icon={Package} testId="new-lead-package">
                  <select
                    aria-label="Package"
                    value={formData.isManualItinerary ? MANUAL_ITINERARY_VALUE : (formData.package || '')}
                    onChange={(e) => handlePackageSelect(e.target.value)}
                    disabled={loadingPackages}
                    className="w-full h-8 px-3 bg-transparent border border-input rounded-lg text-sm focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 disabled:cursor-not-allowed"
                  >
                    <option value="">{loadingPackages ? 'Loading packages...' : 'Select Package'}</option>
                    <option value={MANUAL_ITINERARY_VALUE}>Manual Itinerary (No Package)</option>
                    {packages && packages.length > 0 ? (
                      packages.map((pkg) => (
                        <option key={pkg._id || pkg.id} value={pkg._id || pkg.id}>
                          {pkg.title || pkg.name || 'Unnamed Package'}
                        </option>
                      ))
                    ) : (
                      !loadingPackages && <option value="" disabled>No packages found</option>
                    )}
                  </select>
                </InputField>

                <InputField label="Sales Representative" icon={User}>
                  {!isSalesRep ? (
                    <Select
                      value={formData.assignedTo || ''}
                      onValueChange={(id) => {
                        const rep = salesReps.find((r) => r.id === id);
                        setFormData({ ...formData, assignedTo: id, salesRep: rep ? rep.name : '' });
                      }}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select Sales Rep" /></SelectTrigger>
                      <SelectContent>
                        {salesReps.map((rep) => (
                          <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input type="text" value={user?.name || ''} disabled />
                  )}
                </InputField>
              </div>

            {formData.isManualItinerary && (
              <div className="mt-4 p-4 bg-card rounded-xl border border-border">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Custom Itinerary
                  <span className="text-xs font-normal text-muted-foreground">
                    ({itineraryDays.length || 0} day{itineraryDays.length === 1 ? '' : 's'})
                  </span>
                </h4>
                <ItineraryEditor
                  days={itineraryDays}
                  onDayChange={(dayNumber: number, dayData: any) => {
                    setItineraryDays((prev) =>
                      (prev || []).filter(Boolean).map((day) =>
                        day.dayNumber === dayNumber ? { ...day, ...dayData } : day
                      )
                    );
                  }}
                  onAddDay={() => {
                    const newDayNumber = itineraryDays.length + 1;
                    setItineraryDays([...itineraryDays, createDefaultDay(newDayNumber)]);
                  }}
                  onRemoveDay={(dayNumber: number) => {
                    const filteredDays = itineraryDays.filter((day) => day.dayNumber !== dayNumber);
                    const renumberedDays = filteredDays.map((day, index) => ({ ...day, dayNumber: index + 1 }));
                    setItineraryDays(renumberedDays);
                  }}
                  destination={formData.destination}
                  hideTitleAndDescription={true}
                />
              </div>
            )}
          </FormDialogSection>

          <FormDialogSection
            id="remarks"
            expanded={expandedSections.remarks}
            onToggle={toggleSection}
            icon={MessageSquare}
            title="Remarks & Notes"
            subtitle="Add optional comments about this lead"
          >
              <div className="space-y-3">
                {formData.remarks.map((remark: any, index: number) => (
                  <div key={index} className="flex gap-3 items-center">
                    <Input
                      type="text"
                      value={remark.text}
                      onChange={(e) => updateRemark(index, 'text', e.target.value)}
                      className="flex-1"
                      placeholder={`Remark ${index + 1}`}
                    />
                    <Input
                      type="date"
                      value={remark.date}
                      onChange={(e) => updateRemark(index, 'date', e.target.value)}
                      className="w-full sm:w-44"
                    />
                    {formData.remarks.length > 1 && (
                      <button
                        onClick={() => removeRemark(index)}
                        className="p-2 text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
                        type="button"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addRemarkField} className="w-full">
                  <Plus className="w-4 h-4" />
                  Add Another Remark
                </Button>
              </div>
          </FormDialogSection>

          <FormDialogSection
            id="transfers"
            expanded={expandedSections.transfers}
            onToggle={toggleSection}
            icon={ArrowRightLeft}
            title="Transfer Flights"
            subtitle="Optional: flight route preferences to reach the trip and return home"
          >
              <div className="space-y-4">
                {/* Inbound Transfer */}
                <div className="bg-card rounded-xl border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Inbound Transfer — Getting to the Trip</h4>
                  {formData.inboundFlightPrefs ? (
                    <FlightPreferenceCard
                      prefs={formData.inboundFlightPrefs}
                      onEdit={() => {
                        setTransferFlightType('inbound');
                        setShowTransferFlightModal(true);
                      }}
                      onRemove={() => setFormData({ ...formData, inboundFlightPrefs: null })}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTransferFlightType('inbound');
                        setShowTransferFlightModal(true);
                      }}
                      className="w-full py-3 border-2 border-dashed border-primary/30 text-primary rounded-xl hover:bg-primary/5 hover:border-primary/50 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Inbound Flight Preferences
                    </button>
                  )}
                </div>

                {/* Outbound Transfer */}
                <div className="bg-card rounded-xl border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Outbound Transfer — Returning Home</h4>
                  {formData.outboundFlightPrefs ? (
                    <FlightPreferenceCard
                      prefs={formData.outboundFlightPrefs}
                      onEdit={() => {
                        setTransferFlightType('outbound');
                        setShowTransferFlightModal(true);
                      }}
                      onRemove={() => setFormData({ ...formData, outboundFlightPrefs: null })}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setTransferFlightType('outbound');
                        setShowTransferFlightModal(true);
                      }}
                      className="w-full py-3 border-2 border-dashed border-primary/30 text-primary rounded-xl hover:bg-primary/5 hover:border-primary/50 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Outbound Flight Preferences
                    </button>
                  )}
                </div>
              </div>
          </FormDialogSection>

          {/* Pricing preview — live price for the selected package or manual itinerary */}
          {(formData.package || formData.isManualItinerary) && (
            <div className="bg-card rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Pricing Preview</h3>
              <PricingSection days={itineraryDays} travelers={formData.numberOfTravelers || 1} />
            </div>
          )}
        </FormDialogBody>

        {/* Transfer Flight Preference Modal (template mode — saves preferences only, no booking) */}
        <FlightSelectionModal
          isOpen={showTransferFlightModal}
          onClose={() => setShowTransferFlightModal(false)}
          mode="template"
          initialData={{
            ...(transferFlightType === 'inbound'
              ? (formData.inboundFlightPrefs || {})
              : getOutboundModalDefaults(formData.inboundFlightPrefs, formData.outboundFlightPrefs)),
            tripType: (transferFlightType === 'inbound' ? formData.outboundFlightPrefs : formData.inboundFlightPrefs) ? 'roundTrip' : 'oneWay',
          }}
          allowRoundTrip
          onSelectTemplate={(prefs: any) => {
            const { tripType, ...leg } = prefs;
            setFormData({
              ...formData,
              ...(transferFlightType === 'inbound'
                ? {
                  inboundFlightPrefs: leg,
                  outboundFlightPrefs: tripType === 'roundTrip' && !formData.outboundFlightPrefs
                    ? oppositeLeg(leg)
                    : formData.outboundFlightPrefs,
                }
                : {
                  outboundFlightPrefs: leg,
                  inboundFlightPrefs: tripType === 'roundTrip' && !formData.inboundFlightPrefs
                    ? oppositeLeg(leg)
                    : formData.inboundFlightPrefs,
                }),
            });
            setShowTransferFlightModal(false);
          }}
        />

        <FormDialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleSubmit('DRAFTING')}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save & Draft
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => handleSubmit('NEW')}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Create Lead
              </>
            )}
          </Button>
        </FormDialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewLeadDialog;
