import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, User, TrendingUp, AlertCircle, Loader } from 'lucide-react';
import { toast } from '@/lib/toast';
import { UserTableHeader, Pagination, UserFormDialog, ConfirmationDialog, FormGroup } from '../Common';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import type { ApiError } from '@/lib/errors';
import { validatePhone, formatPhoneToE164, getPhonePlaceholder, parseE164, COUNTRIES } from '../../utils/phoneUtils';
import SalesRepTable, { type SalesRep } from './SalesRepTable';
import salesRepService from '../../../../services/salesRep.service';
import adminService from '../../../../services/admin.service';
import { unwrapList } from '../../../../services/apiResponse';
import { sendInvitation } from '../../utils/sendInvitation';

// Deliberately scoped to just this one permission for now — extend this array
// (and the checkbox block in the edit dialog below) if more salesRep-toggleable
// permissions are needed later; the update call already supports an arbitrary
// permission set.
const SALESREP_TOGGLEABLE_PERMISSIONS = [
  { id: 'manage_packages', label: 'Can create/edit/delete packages', category: 'Travel' },
];

interface SalesRepFormData {
  name: string;
  email: string;
  phone: string;
  phoneCountry: string;
  commissionRate: number;
  targetLeads: number;
  permissions: string[];
}

const EMPTY_FORM: SalesRepFormData = {
  name: '',
  email: '',
  phone: '',
  phoneCountry: 'IN',
  commissionRate: 10,
  targetLeads: 50,
  permissions: [],
};

const SalesRepManagement = () => {
  const isInitialMount = useRef(true);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showNewRepDialog, setShowNewRepDialog] = useState(false);
  const [showEditRepDialog, setShowEditRepDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResendInviteConfirm, setShowResendInviteConfirm] = useState(false);
  const [showPasswordResetConfirm, setShowPasswordResetConfirm] = useState(false);
  const [selectedRep, setSelectedRep] = useState<SalesRep | null>(null);
  const [repToDelete, setRepToDelete] = useState<SalesRep | null>(null);
  const [repToResendInvite, setRepToResendInvite] = useState<SalesRep | null>(null);
  const [repToResetPassword, setRepToResetPassword] = useState<SalesRep | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    totalLeads: 0,
    totalEarnings: 0,
    avgConversion: 0,
  });

  const [formData, setFormData] = useState<SalesRepFormData>(EMPTY_FORM);

  const ITEMS_PER_PAGE = 10;

  // Calculate online count from onlineStatus
  const onlineCount = useMemo(() => {
    return Object.values(onlineStatus).filter((status) => status === true).length;
  }, [onlineStatus]);

  // Load sales reps from backend on mount
  useEffect(() => {
    loadSalesReps();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when page or search changes (skip initial mount to avoid duplicate call)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    loadSalesReps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchTerm]);

  // Poll for online status every 60 seconds
  useEffect(() => {
    loadOnlineStatus();

    const interval = setInterval(() => {
      loadOnlineStatus();
    }, 60000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Load online status of sales reps
   */
  const loadOnlineStatus = async () => {
    try {
      const response = await salesRepService.getOnlineStatus();
      if (response.status === 'success' && response.data) {
        setOnlineStatus(response.data.onlineStatus || {});
      }
    } catch (error) {
      // Silently fail for online status - non-critical feature
      console.error('Failed to load online status:', error);
    }
  };

  /**
   * Load sales reps from backend API with pagination
   */
  const loadSalesReps = async (page = currentPage, search = searchTerm) => {
    try {
      setIsLoading(true);
      setError('');

      const params: Record<string, unknown> = {
        page,
        limit: ITEMS_PER_PAGE,
        sort: '-createdAt',
      };

      if (search && search.trim()) {
        params.search = search.trim();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc documents these params as required, which doesn't match the real (all-optional) runtime contract
      const response = await salesRepService.getAllSalesReps(params as any);

      // user-service returns a flat array in `data` and pagination at the
      // top level — check that shape first, since it's what the backend
      // actually sends (the `data.salesReps` shape was never real).
      const { items: repsData, pagination: rawPagination } = unwrapList(response);

      const transformedReps: SalesRep[] = repsData.map((rep: Record<string, any>) => {
        let status = 'inactive';
        if (rep.isActive) {
          if (rep.isTempPassword || !rep.isEmailVerified) {
            status = 'invited';
          } else {
            status = 'verified';
          }
        }

        return {
          id: rep._id || rep.id,
          name: rep.name,
          email: rep.email,
          phone: rep.phone || '',
          status,
          accountStatus: rep.mustChangePassword
            ? 'pending_password_reset'
            : rep.isEmailVerified
              ? 'verified'
              : 'pending_first_login',
          commissionRate: rep.commissionRate ?? 10,
          permissions: rep.permissions || [],
          leadsAssigned: rep.leadsAssigned || 0,
          leadsConverted: rep.leadsConverted || 0,
          createdAt: rep.createdAt,
          lastLogin: rep.lastLogin,
          isActive: rep.isActive,
          isEmailVerified: rep.isEmailVerified,
          isTempPassword: rep.isTempPassword,
          mustChangePassword: rep.mustChangePassword,
        };
      });

      setSalesReps(transformedReps);
      setTotalPages(rawPagination?.pages || 1);
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to load sales representatives';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Load sales reps error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Load statistics from backend
   */
  const loadStats = async () => {
    try {
      const response = await salesRepService.getSalesRepStats();

      if (response.data) {
        setStats({
          total: response.data.total || 0,
          active: response.data.active || 0,
          totalLeads: response.data.totalLeads || 0,
          totalEarnings: response.data.totalEarnings || 0,
          avgConversion: response.data.avgConversion || 0,
        });
      }
    } catch (err) {
      console.error('Load stats error:', err);
    }
  };

  const openEditDialog = (rep: SalesRep) => {
    setSelectedRep(rep);

    let phoneCountry = rep.phoneCountry || 'US';
    let phoneNumber = rep.phone || '';

    if (rep.phone) {
      const parsed = parseE164(rep.phone);
      if (parsed) {
        phoneCountry = parsed.countryCode || rep.phoneCountry || 'US';
        const country = COUNTRIES.find((c) => c.code === phoneCountry);
        const callingCode = country?.callingCode?.replace('+', '') || '';

        if (callingCode && rep.phone.startsWith('+' + callingCode)) {
          phoneNumber = rep.phone.substring(callingCode.length + 1);
        } else {
          phoneNumber = rep.phone.replace(/^\+\d+/, '').trim();
        }
      }
    }

    setFormData({
      name: rep.name,
      email: rep.email,
      phone: phoneNumber,
      phoneCountry,
      commissionRate: rep.commissionRate ?? 10,
      targetLeads: 50,
      permissions: rep.permissions || [],
    });
    setShowEditRepDialog(true);
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setSelectedRep(null);
  };

  const togglePermission = (permissionId: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter((p) => p !== permissionId)
        : [...prev.permissions, permissionId],
    }));
  };

  const handleAddRep = async () => {
    if (!formData.name.trim() || !formData.email.trim() || !formData.phone.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!validatePhone(formData.phone, formData.phoneCountry)) {
      toast.error(`Invalid phone number for ${formData.phoneCountry}. Please enter a valid number.`);
      return;
    }

    if (!Number.isFinite(formData.commissionRate) || formData.commissionRate < 0 || formData.commissionRate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formatPhoneToE164(formData.phone, formData.phoneCountry)?.e164 ?? '',
        phoneCountry: formData.phoneCountry,
        commissionRate: formData.commissionRate,
      };

      const response = await salesRepService.createSalesRep(payload);

      if (response.data) {
        if (await sendInvitation(response.data.salesRep?.id)) {
          toast.success(`Sales rep created! Invitation sent to ${formData.email}`);
        } else {
          toast.error(`Sales rep created, but the invitation email failed. Use "Resend invitation".`);
        }
        setShowNewRepDialog(false);
        resetForm();

        await loadSalesReps(1, '');
        await loadStats();

        setSearchTerm('');
        setCurrentPage(1);
      }
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to create sales representative';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Create sales rep error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditRep = async () => {
    if (!selectedRep) return;

    if (!formData.name.trim() || !formData.email.trim() || !formData.phone.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!validatePhone(formData.phone, formData.phoneCountry)) {
      toast.error(`Invalid phone number for ${formData.phoneCountry}. Please enter a valid number.`);
      return;
    }

    if (!Number.isFinite(formData.commissionRate) || formData.commissionRate < 0 || formData.commissionRate > 100) {
      toast.error('Commission rate must be between 0 and 100');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formatPhoneToE164(formData.phone, formData.phoneCountry)?.e164 ?? '',
        phoneCountry: formData.phoneCountry,
        commissionRate: formData.commissionRate,
      };

      const response = await salesRepService.updateSalesRep(selectedRep.id, payload);
      await adminService.updateAdminPermissions(selectedRep.id, formData.permissions || []);

      if (response.data) {
        toast.success('Sales representative updated successfully');
        setShowEditRepDialog(false);
        resetForm();
        await loadSalesReps();
        await loadStats();
      }
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to update sales representative';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Update sales rep error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRep = (rep: SalesRep) => {
    setRepToDelete(rep);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!repToDelete) return;

    try {
      setIsSubmitting(true);
      setError('');

      const response = await salesRepService.deleteSalesRep(repToDelete.id);

      if (response.status === 'success') {
        toast.success(`Sales representative deleted successfully`);
        setShowDeleteConfirm(false);
        setRepToDelete(null);
        await loadSalesReps();
        await loadStats();
      }
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to delete sales representative';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Delete sales rep error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendInvitation = (rep: SalesRep) => {
    setRepToResendInvite(rep);
    setShowResendInviteConfirm(true);
  };

  const confirmResendInvitation = async () => {
    if (!repToResendInvite) return;

    try {
      setIsSubmitting(true);
      setError('');

      const response = await salesRepService.resetSalesRepPassword(repToResendInvite.id);

      if (response.data) {
        toast.success(`Invitation resent to ${repToResendInvite.email}`);
        setShowResendInviteConfirm(false);
        setRepToResendInvite(null);
      }
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to resend invitation';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Resend invitation error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForcePasswordReset = (rep: SalesRep) => {
    setRepToResetPassword(rep);
    setShowPasswordResetConfirm(true);
  };

  const confirmPasswordReset = async () => {
    if (!repToResetPassword) return;

    try {
      setIsSubmitting(true);
      setError('');

      const response = await salesRepService.resetSalesRepPassword(repToResetPassword.id);

      if (response.data) {
        toast.success(`Password reset email sent to ${repToResetPassword.email}`);
        setShowPasswordResetConfirm(false);
        setRepToResetPassword(null);
      }
    } catch (err) {
      const errorMsg = (err as ApiError).userMessage || (err as Error).message || 'Failed to send password reset';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error('Password reset error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted p-8">
          <Loader className="size-5 animate-spin text-primary" />
          <p className="font-medium text-foreground">Loading sales representatives...</p>
        </div>
      )}

      {!isLoading && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading text-2xl font-bold text-foreground">Sales Representatives</h2>
              <p className="mt-1 text-muted-foreground">Manage sales team members and track performance</p>
            </div>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                resetForm();
                setShowNewRepDialog(true);
              }}
            >
              <Plus className="size-4" />
              Add Sales Rep
            </Button>
          </div>

          {/* Security Info Banner */}
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-accent p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Account & Security Policy</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sales reps receive invitation emails with temporary passwords. They must set a permanent password on
                first login. Passwords expire after 90 days and require: 12+ characters, uppercase, lowercase,
                numbers, and symbols.
              </p>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Total Reps" value={stats.total} icon={User} color="primary" />
            <StatCard label="Active Reps" value={onlineCount} icon={User} color="success" />
            <StatCard label="Total Leads" value={stats.totalLeads} icon={TrendingUp} color="muted" />
            <StatCard label="Conv. Rate (%)" value={stats.avgConversion} icon={TrendingUp} color="warning" />
            <StatCard
              label="Total Earnings"
              value={`$${(stats.totalEarnings / 1000).toFixed(1)}K`}
              icon={User}
              color="success"
            />
          </div>

          {/* Table Section */}
          <UserTableHeader
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onFilterClick={() => {}}
            title="Sales Representatives List"
            subtitle="Monitor performance and manage sales team"
          />

          {salesReps.length > 0 ? (
            <>
              <SalesRepTable
                reps={salesReps}
                onlineStatus={onlineStatus}
                onEdit={openEditDialog}
                onDelete={handleDeleteRep}
                onResendInvite={handleResendInvitation}
                onForcePasswordReset={handleForcePasswordReset}
              />

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                itemsPerPage={ITEMS_PER_PAGE}
                totalItems={salesReps.length}
              />
            </>
          ) : (
            <div className="rounded-lg border border-border bg-muted p-8 text-center">
              <User className="mx-auto mb-3 size-12 text-muted-foreground" />
              <p className="font-medium text-foreground">No sales representatives found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first sales rep by clicking the &quot;Add Sales Rep&quot; button
              </p>
            </div>
          )}
        </>
      )}

      {/* Add Sales Rep Dialog */}
      <UserFormDialog
        isOpen={showNewRepDialog}
        onClose={() => {
          setShowNewRepDialog(false);
          setError('');
          resetForm();
        }}
        onSubmit={handleAddRep}
        title="Add New Sales Representative"
        subtitle="Onboard a new sales team member"
        submitLabel={isSubmitting ? 'Creating...' : 'Create & Send Invitation'}
        isSubmitting={isSubmitting}
        error={error}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/20 bg-accent p-3">
            <p className="text-xs font-semibold text-foreground">WHAT HAPPENS NEXT:</p>
            <ol className="mt-2 ml-4 space-y-1 text-xs text-muted-foreground">
              <li>1. Sales rep account is created in the system</li>
              <li>2. Temporary password is generated automatically</li>
              <li>3. Invitation email is sent to their address</li>
              <li>4. They must set permanent password on first login</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Full Name" required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                placeholder="John Doe"
              />
            </FormGroup>
            <FormGroup label="Email" required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                placeholder="john@email.com"
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Country Code" required>
              <select
                value={formData.phoneCountry}
                onChange={(e) => setFormData({ ...formData, phoneCountry: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.name} ({country.code})
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Phone" required>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                placeholder={getPhonePlaceholder(formData.phoneCountry)}
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Commission Rate (%)" required>
              <input
                type="number"
                value={formData.commissionRate}
                onChange={(e) => setFormData({ ...formData, commissionRate: parseFloat(e.target.value) })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                placeholder="10"
                min="0"
                max="100"
              />
            </FormGroup>
          </div>

          <div className="rounded-lg border border-success/30 bg-success/10 p-4">
            <p className="mb-2 text-xs font-semibold text-success">Account Security</p>
            <ul className="space-y-1 text-xs text-success">
              <li>- Temporary password: Auto-generated (12 chars, secure)</li>
              <li>- Sent via email: Sales rep receives invitation link</li>
              <li>- First login: Must create permanent password</li>
              <li>- Password expires: After 90 days</li>
            </ul>
          </div>
        </div>
      </UserFormDialog>

      {/* Edit Sales Rep Dialog */}
      <UserFormDialog
        isOpen={showEditRepDialog}
        onClose={() => {
          setShowEditRepDialog(false);
          setError('');
          resetForm();
        }}
        onSubmit={handleEditRep}
        title="Edit Sales Representative"
        subtitle="Update sales rep information"
        submitLabel={isSubmitting ? 'Updating...' : 'Update Sales Rep'}
        isSubmitting={isSubmitting}
        error={error}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Full Name" required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
              />
            </FormGroup>
            <FormGroup label="Email" required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Country Code" required>
              <select
                value={formData.phoneCountry}
                onChange={(e) => setFormData({ ...formData, phoneCountry: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.name} ({country.code})
                  </option>
                ))}
              </select>
            </FormGroup>

            <FormGroup label="Phone" required>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                placeholder={getPhonePlaceholder(formData.phoneCountry)}
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Commission Rate (%)" required>
              <input
                type="number"
                value={formData.commissionRate}
                onChange={(e) => setFormData({ ...formData, commissionRate: parseFloat(e.target.value) })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                min="0"
                max="100"
              />
            </FormGroup>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Permissions</p>
            <div className="space-y-2">
              {SALESREP_TOGGLEABLE_PERMISSIONS.map((perm) => (
                <label
                  key={perm.id}
                  className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm transition-colors hover:bg-card"
                >
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    disabled={isSubmitting}
                    className="size-4 accent-primary disabled:opacity-50"
                  />
                  <div>
                    <span className="text-foreground">{perm.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({perm.category})</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </UserFormDialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setRepToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Sales Representative"
        description={`Are you sure you want to delete ${repToDelete?.name}? Their assigned leads will need to be reassigned.`}
        confirmLabel={isSubmitting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        isDangerous
        isSubmitting={isSubmitting}
      />

      {/* Resend Invitation Dialog */}
      <ConfirmationDialog
        isOpen={showResendInviteConfirm}
        onClose={() => {
          setShowResendInviteConfirm(false);
          setRepToResendInvite(null);
        }}
        onConfirm={confirmResendInvitation}
        title="Resend Invitation"
        description={`Resend invitation email to ${repToResendInvite?.email}? They will receive a new temporary password and invitation link.`}
        confirmLabel={isSubmitting ? 'Sending...' : 'Resend'}
        cancelLabel="Cancel"
        isSubmitting={isSubmitting}
      />

      {/* Password Reset Dialog */}
      <ConfirmationDialog
        isOpen={showPasswordResetConfirm}
        onClose={() => {
          setShowPasswordResetConfirm(false);
          setRepToResetPassword(null);
        }}
        onConfirm={confirmPasswordReset}
        title="Force Password Reset"
        description={`Send password reset email to ${repToResetPassword?.email}? They will receive a new temporary password and must create a permanent one.`}
        confirmLabel={isSubmitting ? 'Sending...' : 'Send Reset Email'}
        cancelLabel="Cancel"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default SalesRepManagement;
