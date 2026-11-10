import { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, Building2, CheckCircle, AlertCircle } from 'lucide-react';
import { UserTableHeader, Pagination, UserFormDialog, ConfirmationDialog, FormGroup } from '../Common';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { ApiError } from '@/lib/errors';
import { formatDate } from '../../utils/helpers';
import { validatePhone, formatPhoneToE164, getPhonePlaceholder, parseE164, COUNTRIES } from '../../utils/phoneUtils';
import vendorService from '../../../../services/vendor.service';
import VendorTable from './VendorTable';
import { sendInvitation } from '../../utils/sendInvitation';

const VENDOR_TYPES = ['hotel', 'transport', 'activity', 'restaurant', 'guide', 'other'];
const VENDOR_TYPE_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  transport: 'Transportation',
  activity: 'Activity',
  restaurant: 'Restaurant',
  guide: 'Tour Guide',
  other: 'Other',
};

interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

interface ContactPerson {
  name: string;
  phone: string;
  phoneCountry: string;
  email: string;
  designation: string;
}

interface BankDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  branchName: string;
  ifscCode: string;
  swiftCode: string;
}

export interface Vendor {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  phoneCountry?: string;
  businessName?: string;
  serviceType?: string;
  businessRegistrationNumber?: string;
  taxIdentificationNumber?: string;
  address?: Address;
  contactPerson?: ContactPerson;
  bankDetails?: BankDetails;
  isActive?: boolean;
  rating?: number;
  totalBookings?: number;
  createdAt?: string;
  updatedAt?: string;
  accountStatus?: string;
}

interface VendorFormData {
  name: string;
  email: string;
  phone: string;
  phoneCountry: string;
  businessName: string;
  serviceType: string;
  businessRegistrationNumber: string;
  taxIdentificationNumber: string;
  address: Address;
  contactPerson: ContactPerson;
  bankDetails: BankDetails;
}

const EMPTY_FORM: VendorFormData = {
  name: '',
  email: '',
  phone: '',
  phoneCountry: 'US',
  businessName: '',
  serviceType: '',
  businessRegistrationNumber: '',
  taxIdentificationNumber: '',
  address: { street: '', city: '', state: '', zipCode: '', country: '' },
  contactPerson: { name: '', phone: '', phoneCountry: 'US', email: '', designation: '' },
  bankDetails: { accountName: '', accountNumber: '', bankName: '', branchName: '', ifscCode: '', swiftCode: '' },
};

const VendorManagement = () => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showNewVendorDialog, setShowNewVendorDialog] = useState(false);
  const [showEditVendorDialog, setShowEditVendorDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResendInviteConfirm, setShowResendInviteConfirm] = useState(false);
  const [showPasswordResetConfirm, setShowPasswordResetConfirm] = useState(false);
  const [showVendorDetailsModal, setShowVendorDetailsModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const [vendorToResendInvite, setVendorToResendInvite] = useState<Vendor | null>(null);
  const [vendorToResetPassword, setVendorToResetPassword] = useState<Vendor | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<VendorFormData>(EMPTY_FORM);

  const ITEMS_PER_PAGE = 10;

  useEffect(() => {
    loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterStatus, filterType, currentPage]);

  const loadVendors = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, unknown> = {
        page: currentPage,
        limit: ITEMS_PER_PAGE,
        search: searchTerm || undefined,
        // The "Active Status" filter's values are all/active/inactive — that's
        // isActive, not the vendorStatus verification enum (pending_verification/
        // verified/suspended/rejected). This was previously mis-sent as
        // vendorStatus, which the backend now validates strictly and would 400 on.
        isActive: filterStatus !== 'all' ? filterStatus === 'active' : undefined,
        serviceType: filterType !== 'all' ? filterType : undefined,
        sort: '-createdAt',
      };

      Object.keys(params).forEach((key) => params[key] === undefined && delete params[key]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc doesn't match the real (all-optional, boolean isActive) runtime contract
      const response = await vendorService.getAllVendors(params as any);

      if (response.status === 'success' && response.data) {
        setVendors(response.data.vendors || response.data || []);
      }
    } catch (err) {
      console.error('Error loading vendors:', err);
      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchTerm, filterStatus, filterType]);

  const reloadVendors = () => {
    setCurrentPage(1);
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setValidationErrors({});
    setError(null);
  };

  const handleAddVendor = async () => {
    if (!validatePhone(formData.phone, formData.phoneCountry)) {
      setValidationErrors({ phone: `Please provide a valid phone number for ${formData.phoneCountry}` });
      setError('Please fix the validation errors below');
      return;
    }

    const phoneData = formatPhoneToE164(formData.phone, formData.phoneCountry);
    if (!phoneData) {
      setValidationErrors({ phone: `Please provide a valid phone number for ${formData.phoneCountry}` });
      setError('Please fix the validation errors below');
      return;
    }

    if (formData.contactPerson.phone && !validatePhone(formData.contactPerson.phone, formData.contactPerson.phoneCountry)) {
      setValidationErrors({ contactPersonPhone: `Please provide a valid phone number for ${formData.contactPerson.phoneCountry}` });
      setError('Please fix the validation errors below');
      return;
    }

    let contactPersonPhoneData = null;
    if (formData.contactPerson.phone) {
      contactPersonPhoneData = formatPhoneToE164(formData.contactPerson.phone, formData.contactPerson.phoneCountry);
      if (!contactPersonPhoneData) {
        setValidationErrors({ contactPersonPhone: `Please provide a valid phone number for ${formData.contactPerson.phoneCountry}` });
        setError('Please fix the validation errors below');
        return;
      }
    }

    const validation = vendorService.validateVendorData(formData);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      setError('Please fix the validation errors below');
      return;
    }

    setValidationErrors({});

    try {
      setActionLoading(true);
      const { phoneCountry: _contactCountry, ...contactPerson } = formData.contactPerson;
      const submitData = {
        ...formData,
        phone: phoneData.e164,
        phoneCountry: phoneData.countryCode,
        contactPerson: {
          ...contactPerson,
          phone: contactPersonPhoneData ? contactPersonPhoneData.e164 : '',
        },
      };
      const response = await vendorService.createVendor(submitData);

      if (response.status === 'success') {
        setShowNewVendorDialog(false);
        setSuccessMessage(
          (await sendInvitation(response.data?.vendor?.id))
            ? `Vendor created. Invitation sent to ${submitData.email}`
            : 'Vendor created, but the invitation email failed. Use "Resend invitation".'
        );
        setTimeout(() => setSuccessMessage(''), 5000);
        resetForm();
        setValidationErrors({});
        setCurrentPage(1);
        setSearchTerm('');
      }
    } catch (err) {
      console.error('Error creating vendor:', err);

      const validationErrors = (err as ApiError).validationErrors;
      if (validationErrors) {
        const backendErrors: Record<string, string> = {};
        Object.entries(validationErrors).forEach(([field, messages]) => {
          backendErrors[field] = Array.isArray(messages) ? messages[0] : (messages as string);
        });
        setValidationErrors(backendErrors);
      }

      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to create vendor');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditVendor = async () => {
    if (!selectedVendor) return;

    try {
      setActionLoading(true);
      setValidationErrors({});

      let phoneData: ReturnType<typeof formatPhoneToE164> = null;
      const originalPhoneNumber = selectedVendor.phone ? selectedVendor.phone.replace(/^\+\d+/, '').trim() : '';

      const phoneWasChanged =
        formData.phone !== originalPhoneNumber || formData.phoneCountry !== (selectedVendor.phoneCountry || 'US');

      if (phoneWasChanged && formData.phone) {
        if (!validatePhone(formData.phone, formData.phoneCountry)) {
          setValidationErrors({ phone: `Please provide a valid phone number for ${formData.phoneCountry}` });
          setError('Please fix the validation errors below');
          setActionLoading(false);
          return;
        }

        phoneData = formatPhoneToE164(formData.phone, formData.phoneCountry);
        if (!phoneData) {
          setValidationErrors({ phone: `Please provide a valid phone number for ${formData.phoneCountry}` });
          setError('Please fix the validation errors below');
          setActionLoading(false);
          return;
        }
      }

      const updateData = {
        name: formData.name,
        phone: phoneData ? phoneData.e164 : selectedVendor.phone,
        phoneCountry: phoneData ? phoneData.countryCode : selectedVendor.phoneCountry || 'US',
        businessName: formData.businessName,
        serviceType: formData.serviceType,
        taxIdentificationNumber: formData.taxIdentificationNumber,
        address: formData.address,
        bankDetails: formData.bankDetails,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc says "all fields optional" in prose but omits [optional] on contactPerson, so TS infers it required
      const response = await vendorService.updateVendor(selectedVendor.id, updateData as any);

      if (response.status === 'success') {
        setSelectedVendor(null);
        setShowEditVendorDialog(false);
        setSuccessMessage('Vendor updated successfully');
        setTimeout(() => setSuccessMessage(''), 5000);
        resetForm();
        setValidationErrors({});
        setCurrentPage(1);
        setSearchTerm('');
      }
    } catch (err) {
      console.error('Error updating vendor:', err);
      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to update vendor');
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewDetails = (vendor: Vendor) => {
    setSelectedVendor(vendor);
    setShowVendorDetailsModal(true);
  };

  const handleResendInvitation = (vendor: Vendor) => {
    setVendorToResendInvite(vendor);
    setShowResendInviteConfirm(true);
  };

  const confirmResendInvitation = async () => {
    if (!vendorToResendInvite) return;

    try {
      setActionLoading(true);
      const response = await vendorService.resetVendorPassword(vendorToResendInvite.id);

      if (response.status === 'success') {
        setSuccessMessage(`Invitation resent to ${vendorToResendInvite.email}`);
        setTimeout(() => setSuccessMessage(''), 5000);
        reloadVendors();
        setShowResendInviteConfirm(false);
        setVendorToResendInvite(null);
      }
    } catch (err) {
      console.error('Error resending invitation:', err);
      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to resend invitation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleForcePasswordReset = (vendor: Vendor) => {
    setVendorToResetPassword(vendor);
    setShowPasswordResetConfirm(true);
  };

  const confirmPasswordReset = async () => {
    if (!vendorToResetPassword) return;

    try {
      setActionLoading(true);
      const response = await vendorService.resetVendorPassword(vendorToResetPassword.id);

      if (response.status === 'success') {
        setSuccessMessage(`Password reset link sent to ${vendorToResetPassword.email}`);
        setTimeout(() => setSuccessMessage(''), 5000);
        reloadVendors();
        setShowPasswordResetConfirm(false);
        setVendorToResetPassword(null);
      }
    } catch (err) {
      console.error('Error resetting password:', err);
      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteVendor = (vendor: Vendor) => {
    setVendorToDelete(vendor);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!vendorToDelete) return;

    try {
      setActionLoading(true);
      const response = await vendorService.deleteVendor(vendorToDelete.id);

      if (response.status === 'success') {
        setShowDeleteConfirm(false);
        setVendorToDelete(null);
        setSelectedVendor(null);
        setSuccessMessage(`Vendor deleted successfully`);
        setTimeout(() => setSuccessMessage(''), 5000);
        reloadVendors();
      }
    } catch (err) {
      console.error('Error deleting vendor:', err);
      setError((err as ApiError).userMessage || (err as Error).message || 'Failed to delete vendor');
    } finally {
      setActionLoading(false);
    }
  };

  const openEditDialog = (vendor: Vendor) => {
    setSelectedVendor(vendor);

    let phoneCountry = 'US';
    let phoneNumber = '';
    if (vendor.phone) {
      const parsed = parseE164(vendor.phone);
      if (parsed) {
        phoneCountry = parsed.countryCode || 'US';
        const country = COUNTRIES.find((c) => c.code === phoneCountry);
        const callingCode = country?.callingCode?.replace('+', '') || '';

        if (callingCode && vendor.phone.startsWith('+' + callingCode)) {
          phoneNumber = vendor.phone.substring(callingCode.length + 1);
        } else {
          phoneNumber = vendor.phone.replace(/^\+\d+/, '').trim();
        }
      } else {
        phoneNumber = vendor.phone;
      }
    }

    setFormData({
      name: vendor.name || '',
      email: vendor.email || '',
      phone: phoneNumber,
      phoneCountry,
      businessName: vendor.businessName || '',
      serviceType: vendor.serviceType || '',
      businessRegistrationNumber: vendor.businessRegistrationNumber || '',
      taxIdentificationNumber: vendor.taxIdentificationNumber || '',
      address: vendor.address || { street: '', city: '', state: '', zipCode: '', country: '' },
      contactPerson: vendor.contactPerson || { name: '', phone: '', phoneCountry: 'US', email: '', designation: '' },
      bankDetails: vendor.bankDetails || {
        accountName: '',
        accountNumber: '',
        bankName: '',
        branchName: '',
        ifscCode: '',
        swiftCode: '',
      },
    });
    setShowEditVendorDialog(true);
  };

  const inputClass = (hasError?: boolean) =>
    `h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 ${
      hasError ? 'border-destructive/50 bg-destructive/5 focus:ring-destructive/20' : 'border-input focus:ring-ring/50'
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Vendor Management</h2>
          <p className="mt-1 text-muted-foreground">Manage partner hotels, travel agents, and service providers</p>
        </div>
        <Button
          disabled={actionLoading}
          onClick={() => {
            resetForm();
            setShowNewVendorDialog(true);
          }}
        >
          <Plus className="size-4" />
          Add Vendor
        </Button>
      </div>

      {/* Security Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-accent p-4">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">Vendor Management Policy</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vendors receive invitation emails with temporary passwords. They must set a permanent password on first
            login. Passwords expire after 90 days and require: 12+ characters, uppercase, lowercase, numbers, and
            symbols.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Total Vendors" value={vendors.length} icon={Building2} color="primary" />
        <StatCard label="Active" value={vendors.filter((v) => v.isActive).length} icon={CheckCircle} color="success" />
        <StatCard label="Inactive" value={vendors.filter((v) => !v.isActive).length} icon={AlertCircle} color="muted" />
        <StatCard
          label="Avg. Rating"
          value={
            vendors.filter((v) => (v.rating || 0) > 0).length > 0
              ? (
                  vendors.filter((v) => (v.rating || 0) > 0).reduce((sum, v) => sum + (v.rating || 0), 0) /
                  vendors.filter((v) => (v.rating || 0) > 0).length
                ).toFixed(1)
              : '0'
          }
          icon={Building2}
          color="warning"
        />
      </div>

      {/* Filters - kept as real <select> elements: exercised directly via
          native select interaction in VendorManagement.test.jsx */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-card sm:flex-row">
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-foreground">Active Status</label>
          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setCurrentPage(1);
            }}
            className={inputClass()}
          >
            <option value="all">All Vendors</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-foreground">Service Type</label>
          <select
            value={filterType}
            onChange={(e) => {
              setFilterType(e.target.value);
              setCurrentPage(1);
            }}
            className={inputClass()}
          >
            <option value="all">All Types</option>
            {VENDOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {VENDOR_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Section */}
      <UserTableHeader
        searchTerm={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        onFilterClick={() => {}}
        title="Vendors List"
        subtitle="Manage partner relationships and verify vendors"
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-lg text-muted-foreground">Loading vendors...</div>
        </div>
      ) : (
        <>
          <VendorTable
            vendors={vendors}
            onEdit={openEditDialog}
            onDelete={handleDeleteVendor}
            onViewDetails={handleViewDetails}
            onResendInvite={handleResendInvitation}
          />

          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(vendors.length / ITEMS_PER_PAGE)}
            onPageChange={setCurrentPage}
            itemsPerPage={ITEMS_PER_PAGE}
            totalItems={vendors.length}
          />
        </>
      )}

      {/* Add Vendor Dialog */}
      <UserFormDialog
        isOpen={showNewVendorDialog}
        onClose={() => {
          setShowNewVendorDialog(false);
          setError(null);
          resetForm();
          setSearchTerm('');
          setCurrentPage(1);
        }}
        onSubmit={handleAddVendor}
        title="Add New Vendor"
        subtitle="Register a new partner (hotel, travel agent, service provider, etc.)"
        submitLabel="Create Vendor"
        isLoading={actionLoading}
        error={error}
        successMessage={successMessage}
      >
        <div className="space-y-4">
          {/* Validation Error Summary */}
          {Object.keys(validationErrors).length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="mb-3 flex items-center gap-2 font-semibold text-destructive">
                <AlertCircle className="size-5" />
                Please fix the following errors:
              </p>
              <ul className="space-y-2">
                {Object.entries(validationErrors).map(([field, err]) => (
                  <li key={field} className="flex items-start gap-2 text-sm text-destructive">
                    <span className="mt-0.5 font-bold">•</span>
                    <span>
                      <strong>{field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1')}:</strong> {err}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* What Happens Next */}
          <div className="rounded-lg border border-primary/20 bg-accent p-3">
            <p className="text-xs font-semibold text-foreground">WHAT HAPPENS NEXT:</p>
            <ol className="mt-2 ml-4 space-y-1 text-xs text-muted-foreground">
              <li>1. Vendor account is created in the system</li>
              <li>2. Vendor details are saved and stored</li>
              <li>3. Admin must verify business details before activation</li>
              <li>4. Account ready for vendor to use</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Name" required error={validationErrors.name}>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputClass(Boolean(validationErrors.name))}
                placeholder="Contact Person Name"
              />
            </FormGroup>
            <FormGroup label="Email" required error={validationErrors.email}>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={inputClass(Boolean(validationErrors.email))}
                placeholder="contact@vendor.com"
              />
            </FormGroup>
          </div>

          <FormGroup label="Phone" required error={validationErrors.phone}>
            <div className="flex gap-2">
              <select
                value={formData.phoneCountry}
                onChange={(e) => setFormData({ ...formData, phoneCountry: e.target.value })}
                className="h-8 w-40 rounded-lg border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                title="Select country code"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code} title={country.name}>
                    {country.flag} {country.code} {country.callingCode}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={`flex-1 ${inputClass(Boolean(validationErrors.phone))}`}
                placeholder={getPhonePlaceholder(formData.phoneCountry)}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Enter phone number with or without country code</p>
          </FormGroup>

          <FormGroup label="Business Name" required error={validationErrors.businessName}>
            <input
              type="text"
              value={formData.businessName}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              className={inputClass(Boolean(validationErrors.businessName))}
              placeholder="Business/Company Name"
            />
          </FormGroup>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Service Type" required error={validationErrors.serviceType}>
              <select
                value={formData.serviceType}
                onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                className={inputClass(Boolean(validationErrors.serviceType))}
              >
                <option value="">Select Type</option>
                {VENDOR_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {VENDOR_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </FormGroup>
            <FormGroup label="Registration Number" required error={validationErrors.businessRegistrationNumber}>
              <input
                type="text"
                value={formData.businessRegistrationNumber}
                onChange={(e) => setFormData({ ...formData, businessRegistrationNumber: e.target.value })}
                className={inputClass(Boolean(validationErrors.businessRegistrationNumber))}
                placeholder="Business Reg. Number"
              />
            </FormGroup>
          </div>

          <FormGroup label="Tax Identification Number" required error={validationErrors.taxIdentificationNumber}>
            <input
              type="text"
              value={formData.taxIdentificationNumber}
              onChange={(e) => setFormData({ ...formData, taxIdentificationNumber: e.target.value })}
              className={inputClass(Boolean(validationErrors.taxIdentificationNumber))}
              placeholder="Tax ID"
            />
          </FormGroup>

          {/* Address Section */}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-semibold text-foreground">Address Information</p>
            <FormGroup label="Street Address">
              <input
                type="text"
                value={formData.address.street}
                onChange={(e) => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })}
                className={inputClass()}
                placeholder="Street address"
              />
            </FormGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="City">
                <input
                  type="text"
                  value={formData.address.city}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })}
                  className={inputClass()}
                  placeholder="City"
                />
              </FormGroup>
              <FormGroup label="State">
                <input
                  type="text"
                  value={formData.address.state}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, state: e.target.value } })}
                  className={inputClass()}
                  placeholder="State"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="ZIP Code">
                <input
                  type="text"
                  value={formData.address.zipCode}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, zipCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="ZIP Code"
                />
              </FormGroup>
              <FormGroup label="Country">
                <input
                  type="text"
                  value={formData.address.country}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, country: e.target.value } })}
                  className={inputClass()}
                  placeholder="Country"
                />
              </FormGroup>
            </div>
          </div>

          {/* Bank Details Section */}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-semibold text-foreground">Bank Details</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Account Name">
                <input
                  type="text"
                  value={formData.bankDetails.accountName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, accountName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Account Holder Name"
                />
              </FormGroup>
              <FormGroup label="Account Number">
                <input
                  type="text"
                  value={formData.bankDetails.accountNumber}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, accountNumber: e.target.value } })}
                  className={inputClass()}
                  placeholder="Account Number"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Bank Name">
                <input
                  type="text"
                  value={formData.bankDetails.bankName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, bankName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Bank Name"
                />
              </FormGroup>
              <FormGroup label="Branch Name">
                <input
                  type="text"
                  value={formData.bankDetails.branchName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, branchName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Branch Name"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="IFSC Code">
                <input
                  type="text"
                  value={formData.bankDetails.ifscCode}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, ifscCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="IFSC Code"
                />
              </FormGroup>
              <FormGroup label="SWIFT Code (International)">
                <input
                  type="text"
                  value={formData.bankDetails.swiftCode}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, swiftCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="SWIFT Code"
                />
              </FormGroup>
            </div>
          </div>

          <div className="rounded-lg border border-success/30 bg-success/10 p-4">
            <p className="mb-2 text-xs font-semibold text-success">Account Information</p>
            <ul className="space-y-1 text-xs text-success">
              <li>- Vendor details securely stored in system</li>
              <li>- Business information verified by admin</li>
              <li>- Account ready for activation</li>
              <li>- All contact information recorded</li>
            </ul>
          </div>
        </div>
      </UserFormDialog>

      {/* Edit Vendor Dialog */}
      <UserFormDialog
        isOpen={showEditVendorDialog}
        onClose={() => {
          setShowEditVendorDialog(false);
          setError(null);
          resetForm();
          setSearchTerm('');
          setCurrentPage(1);
        }}
        onSubmit={handleEditVendor}
        title="Edit Vendor"
        subtitle="Update vendor information"
        submitLabel="Update Vendor"
        isLoading={actionLoading}
        error={error}
        successMessage={successMessage}
      >
        <div className="space-y-4">
          {Object.keys(validationErrors).length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="mb-3 flex items-center gap-2 font-semibold text-destructive">
                <AlertCircle className="size-5" />
                Please fix the following errors:
              </p>
              <ul className="space-y-2">
                {Object.entries(validationErrors).map(([field, err]) => (
                  <li key={field} className="flex items-start gap-2 text-sm text-destructive">
                    <span className="mt-0.5 font-bold">•</span>
                    <span>
                      <strong>{field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1')}:</strong> {err}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Name" required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={inputClass(Boolean(validationErrors.name))}
                placeholder="Contact Person Name"
              />
            </FormGroup>
            <FormGroup label="Email" required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={inputClass(Boolean(validationErrors.email))}
                placeholder="contact@vendor.com"
              />
            </FormGroup>
          </div>

          <FormGroup label="Phone" required error={validationErrors.phone}>
            <div className="flex gap-2">
              <select
                value={formData.phoneCountry}
                onChange={(e) => setFormData({ ...formData, phoneCountry: e.target.value })}
                className="h-8 w-40 rounded-lg border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                title="Select country code"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code} title={country.name}>
                    {country.flag} {country.code} {country.callingCode}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className={`flex-1 ${inputClass(Boolean(validationErrors.phone))}`}
                placeholder={getPhonePlaceholder(formData.phoneCountry)}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Enter phone number with or without country code</p>
          </FormGroup>

          <FormGroup label="Business Name" required>
            <input
              type="text"
              value={formData.businessName}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              className={inputClass(Boolean(validationErrors.businessName))}
              placeholder="Business/Company Name"
            />
          </FormGroup>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Service Type" required>
              <select
                value={formData.serviceType}
                onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })}
                className={inputClass(Boolean(validationErrors.serviceType))}
              >
                <option value="">Select Type</option>
                {VENDOR_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {VENDOR_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </FormGroup>
            <FormGroup label="Registration Number" required>
              <input
                type="text"
                value={formData.businessRegistrationNumber}
                onChange={(e) => setFormData({ ...formData, businessRegistrationNumber: e.target.value })}
                className={inputClass(Boolean(validationErrors.businessRegistrationNumber))}
                placeholder="Business Reg. Number"
              />
            </FormGroup>
          </div>

          <FormGroup label="Tax Identification Number" required>
            <input
              type="text"
              value={formData.taxIdentificationNumber}
              onChange={(e) => setFormData({ ...formData, taxIdentificationNumber: e.target.value })}
              className={inputClass(Boolean(validationErrors.taxIdentificationNumber))}
              placeholder="Tax ID"
            />
          </FormGroup>

          {/* Address Section */}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-semibold text-foreground">Address Information</p>
            <FormGroup label="Street Address">
              <input
                type="text"
                value={formData.address.street}
                onChange={(e) => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })}
                className={inputClass()}
                placeholder="Street address"
              />
            </FormGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="City">
                <input
                  type="text"
                  value={formData.address.city}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })}
                  className={inputClass()}
                  placeholder="City"
                />
              </FormGroup>
              <FormGroup label="State">
                <input
                  type="text"
                  value={formData.address.state}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, state: e.target.value } })}
                  className={inputClass()}
                  placeholder="State"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="ZIP Code">
                <input
                  type="text"
                  value={formData.address.zipCode}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, zipCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="ZIP Code"
                />
              </FormGroup>
              <FormGroup label="Country">
                <input
                  type="text"
                  value={formData.address.country}
                  onChange={(e) => setFormData({ ...formData, address: { ...formData.address, country: e.target.value } })}
                  className={inputClass()}
                  placeholder="Country"
                />
              </FormGroup>
            </div>
          </div>

          {/* Bank Details Section */}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-semibold text-foreground">Bank Details</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Account Name">
                <input
                  type="text"
                  value={formData.bankDetails.accountName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, accountName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Account Holder Name"
                />
              </FormGroup>
              <FormGroup label="Account Number">
                <input
                  type="text"
                  value={formData.bankDetails.accountNumber}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, accountNumber: e.target.value } })}
                  className={inputClass()}
                  placeholder="Account Number"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="Bank Name">
                <input
                  type="text"
                  value={formData.bankDetails.bankName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, bankName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Bank Name"
                />
              </FormGroup>
              <FormGroup label="Branch Name">
                <input
                  type="text"
                  value={formData.bankDetails.branchName}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, branchName: e.target.value } })}
                  className={inputClass()}
                  placeholder="Branch Name"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormGroup label="IFSC Code">
                <input
                  type="text"
                  value={formData.bankDetails.ifscCode}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, ifscCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="IFSC Code"
                />
              </FormGroup>
              <FormGroup label="SWIFT Code (International)">
                <input
                  type="text"
                  value={formData.bankDetails.swiftCode}
                  onChange={(e) => setFormData({ ...formData, bankDetails: { ...formData.bankDetails, swiftCode: e.target.value } })}
                  className={inputClass()}
                  placeholder="SWIFT Code"
                />
              </FormGroup>
            </div>
          </div>
        </div>
      </UserFormDialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setVendorToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Vendor"
        description={`Are you sure you want to delete ${vendorToDelete?.businessName}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDangerous
        isLoading={actionLoading}
      />

      {/* Resend Invitation Dialog */}
      <ConfirmationDialog
        isOpen={showResendInviteConfirm}
        onClose={() => {
          setShowResendInviteConfirm(false);
          setVendorToResendInvite(null);
        }}
        onConfirm={confirmResendInvitation}
        title="Resend Invitation"
        description={`Resend invitation email to ${vendorToResendInvite?.email}? They will receive a new temporary password and invitation link.`}
        confirmLabel="Resend"
        cancelLabel="Cancel"
        isLoading={actionLoading}
      />

      {/* Password Reset Dialog */}
      <ConfirmationDialog
        isOpen={showPasswordResetConfirm}
        onClose={() => {
          setShowPasswordResetConfirm(false);
          setVendorToResetPassword(null);
        }}
        onConfirm={confirmPasswordReset}
        title="Force Password Reset"
        description={`Send password reset email to ${vendorToResetPassword?.email}? They will receive a new temporary password and must create a permanent one.`}
        confirmLabel="Send Reset Email"
        cancelLabel="Cancel"
        isLoading={actionLoading}
      />

      {/* Vendor Details Modal */}
      <Dialog open={showVendorDetailsModal} onOpenChange={(open) => !open && setShowVendorDetailsModal(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selectedVendor && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg">{selectedVendor.businessName || selectedVendor.name}</DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                {/* Contact Information */}
                <div>
                  <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                    <span className="size-1 rounded-full bg-primary" />
                    Contact Information
                  </h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Name</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.email}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.phone}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className={`text-sm font-medium ${selectedVendor.isActive ? 'text-success' : 'text-destructive'}`}>
                        {selectedVendor.isActive ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Business Information */}
                <div className="border-t border-border pt-6">
                  <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                    <span className="size-1 rounded-full bg-primary" />
                    Business Information
                  </h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Business Name</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.businessName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Service Type</p>
                      <p className="text-sm font-medium text-foreground">
                        {VENDOR_TYPE_LABELS[selectedVendor.serviceType || ''] || selectedVendor.serviceType}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Registration Number</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.businessRegistrationNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Tax ID</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.taxIdentificationNumber}</p>
                    </div>
                  </div>
                </div>

                {/* Address Information */}
                {selectedVendor.address && (
                  <div className="border-t border-border pt-6">
                    <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                      <span className="size-1 rounded-full bg-primary" />
                      Address
                    </h4>
                    <div className="space-y-2 text-sm">
                      {selectedVendor.address.street && <p className="text-foreground">{selectedVendor.address.street}</p>}
                      <p className="text-foreground">
                        {selectedVendor.address.city && `${selectedVendor.address.city}, `}
                        {selectedVendor.address.state && `${selectedVendor.address.state} `}
                        {selectedVendor.address.zipCode}
                      </p>
                      {selectedVendor.address.country && <p className="text-foreground">{selectedVendor.address.country}</p>}
                    </div>
                  </div>
                )}

                {/* Contact Person */}
                {selectedVendor.contactPerson && (
                  <div className="border-t border-border pt-6">
                    <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                      <span className="size-1 rounded-full bg-primary" />
                      Primary Contact
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-sm text-muted-foreground">Name</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.contactPerson.name}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.contactPerson.phone}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.contactPerson.email}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Designation</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.contactPerson.designation}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bank Details */}
                {selectedVendor.bankDetails && (
                  <div className="border-t border-border pt-6">
                    <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                      <span className="size-1 rounded-full bg-primary" />
                      Bank Details
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-sm text-muted-foreground">Account Name</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.accountName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Account Number</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.accountNumber}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Bank Name</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.bankName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Branch Name</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.branchName}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">IFSC Code</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.ifscCode}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">SWIFT Code</p>
                        <p className="text-sm font-medium text-foreground">{selectedVendor.bankDetails.swiftCode}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Performance Metrics */}
                <div className="border-t border-border pt-6">
                  <h4 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                    <span className="size-1 rounded-full bg-primary" />
                    Performance
                  </h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Rating</p>
                      <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                        <span className="text-warning">★</span>
                        {selectedVendor.rating ? selectedVendor.rating.toFixed(1) : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Bookings</p>
                      <p className="text-sm font-medium text-foreground">{selectedVendor.totalBookings || 0}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Registered</p>
                      <p className="text-sm font-medium text-foreground">{formatDate(selectedVendor.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Updated</p>
                      <p className="text-sm font-medium text-foreground">{formatDate(selectedVendor.updatedAt)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowVendorDetailsModal(false)}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    setShowVendorDetailsModal(false);
                    openEditDialog(selectedVendor);
                  }}
                >
                  Edit Vendor
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VendorManagement;
