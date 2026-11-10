import { useState, useMemo, useEffect } from 'react';
import { Plus, Shield, Mail, AlertCircle, Loader } from 'lucide-react';
import toast from '@/lib/toast';
import {
  UserTableHeader,
  Pagination,
  UserFormDialog,
  ConfirmationDialog,
  FormGroup,
  PermissionDeniedView,
} from '../Common';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { ADMIN_PERMISSIONS_LIST } from '../../utils/constants';
import { filterUsers, paginateArray } from '../../utils/helpers';
import { formatPhoneToE164, COUNTRIES, parseE164 } from '../../utils/phoneUtils';
import AdminTable from './AdminTable';
import AdminDetailsModal from './AdminDetailsModal';
import adminService from '../../../../services/admin.service';
import { usePermission } from '../../../../contexts/PermissionContext';
import { getPermissionDeniedMessage } from '../../utils/permissionUtils';
import { sendInvitation } from '../../utils/sendInvitation';

export interface Admin {
  id: string;
  name: string;
  email: string;
  phone: string;
  role?: string;
  isSuperAdmin: boolean;
  status: string;
  accountStatus: string;
  createdAt?: string;
  lastActive?: string | null;
  permissions: string[];
  passwordExpireDate?: string | null;
  invitationSentAt?: string;
  firstLoginAt?: string | null;
  isEmailVerified?: boolean;
  isTempPassword?: boolean;
  mustChangePassword?: boolean;
  canBeDeleted: boolean;
}

interface AdminFormData {
  name: string;
  email: string;
  phone: string;
  countryCode: string;
  permissions: string[];
  twoFactorEnabled?: boolean;
}

const EMPTY_FORM: AdminFormData = {
  name: '',
  email: '',
  phone: '',
  countryCode: 'IN',
  permissions: [],
};

const AdminManagement = () => {
  // Permission context
  const permission = usePermission();
  const canManageAdmins = permission.hasPermission('manage_admins');

  // State management
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // Dialog form validation errors only
  const [successMessage, setSuccessMessage] = useState(''); // Dialog form success messages only
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showNewAdminDialog, setShowNewAdminDialog] = useState(false);
  const [showEditAdminDialog, setShowEditAdminDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showInviteResendConfirm, setShowInviteResendConfirm] = useState(false);
  const [showPasswordResetConfirm, setShowPasswordResetConfirm] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<Admin | null>(null);
  const [viewingAdmin, setViewingAdmin] = useState<Admin | null>(null);
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
  const [adminToResendInvite, setAdminToResendInvite] = useState<Admin | null>(null);
  const [adminToResetPassword, setAdminToResetPassword] = useState<Admin | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<AdminFormData>(EMPTY_FORM);

  const ITEMS_PER_PAGE = 10;

  // Load admins on component mount
  useEffect(() => {
    loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Load all admins from backend
   */
  const loadAdmins = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await adminService.getAllAdmins({
        limit: 100,
        page: 1,
        sort: '-createdAt',
      });

      if (response.status === 'success') {
        // Handle different response data structures
        const adminsData = Array.isArray(response.data)
          ? response.data
          : response.data?.users || response.data?.data || [];

        // Transform backend data to frontend format
        const transformedAdmins: Admin[] = adminsData.map((admin: Record<string, any>) => ({
          // user-service (Postgres/Prisma) returns `id`, not the Mongo-style `_id`.
          id: admin._id || admin.id,
          name: admin.name,
          email: admin.email,
          phone: admin.phone || '',
          role: admin.role,
          isSuperAdmin: admin.isSuperAdmin || false,
          status: admin.isActive ? 'active' : 'inactive',
          // Use mustChangePassword flag to determine account status
          accountStatus: admin.mustChangePassword
            ? 'pending_password_reset'
            : admin.isEmailVerified
              ? 'verified'
              : 'pending_first_login',
          createdAt: admin.createdAt,
          lastActive: admin.lastLogin,
          permissions: admin.permissions || [],
          passwordExpireDate: admin.passwordExpireDate,
          invitationSentAt: admin.createdAt,
          firstLoginAt: admin.lastLogin,
          isEmailVerified: admin.isEmailVerified,
          isTempPassword: admin.isTempPassword,
          mustChangePassword: admin.mustChangePassword,
          canBeDeleted: admin.canBeDeleted !== false, // Default to true if not set
        }));
        setAdmins(transformedAdmins);
      } else {
        setError('Failed to load admins: Invalid response from server');
      }
    } catch (err) {
      console.error('Error loading admins:', err);
      setError((err as Error).message || 'Failed to load admins');
    } finally {
      setLoading(false);
    }
  };

  const filteredAdmins = useMemo(() => {
    return filterUsers(admins, searchTerm, {});
  }, [admins, searchTerm]);

  const paginatedData = useMemo(() => {
    return paginateArray(filteredAdmins, currentPage, ITEMS_PER_PAGE);
  }, [filteredAdmins, currentPage]);

  const stats = useMemo(
    () => ({
      total: admins.length,
      active: admins.filter((a) => a.status === 'active').length,
      invited: admins.filter((a) => a.status === 'invited').length,
      inactive: admins.filter((a) => a.status === 'inactive').length,
    }),
    [admins]
  );

  const resetForm = () => {
    setFormData(EMPTY_FORM);
  };

  const handleAddAdmin = async () => {
    // PERMISSION CHECK: Verify user has permission to manage admins
    if (!canManageAdmins) {
      setError(getPermissionDeniedMessage('create', 'admin accounts'));
      toast.error(getPermissionDeniedMessage('create', 'admin accounts'));
      return;
    }

    if (!formData.name || !formData.email || !formData.phone) {
      setError('Please fill in all required fields');
      return;
    }

    // Format phone to E.164 format
    const phoneFormatted = formatPhoneToE164(formData.phone, formData.countryCode);
    if (!phoneFormatted) {
      setError(`Invalid phone number for ${formData.countryCode}. Please check the format.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Create admin via API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc omits `role`, which the real endpoint accepts
      const response = await adminService.createAdmin({
        name: formData.name,
        email: formData.email,
        phone: phoneFormatted.e164, // Send E.164 formatted phone
        role: 'admin',
        permissions: formData.permissions || [],
      } as any);

      if (response.status === 'success') {
        // Get user data from response
        const userData = response.data?.user || response.data;

        // Verify we have the ID field
        if (!userData._id && !userData.id) {
          throw new Error('Invalid response: missing user ID');
        }

        // Apply defaults for fields that backend might not return
        const isEmailVerified = userData.isEmailVerified ?? false;
        const isTempPassword = userData.isTempPassword ?? true;
        const mustChangePassword = userData.mustChangePassword ?? true;

        // Determine account status based on the actual flags (after defaults applied)
        let accountStatus = 'pending_first_login';
        if (mustChangePassword) {
          accountStatus = 'pending_password_reset';
        } else if (isEmailVerified) {
          accountStatus = 'verified';
        }

        const newAdmin: Admin = {
          id: userData._id || userData.id,
          name: userData.name || formData.name,
          email: userData.email || formData.email,
          phone: userData.phone || phoneFormatted.e164,
          isSuperAdmin: false,
          status: 'active',
          accountStatus,
          createdAt: userData.createdAt || new Date().toISOString(),
          lastActive: userData.lastLogin || null,
          permissions: userData.permissions || formData.permissions || [],
          passwordExpireDate: userData.passwordExpireDate || null,
          invitationSentAt: new Date().toISOString(),
          firstLoginAt: userData.lastLogin || null,
          isEmailVerified,
          isTempPassword,
          mustChangePassword,
          canBeDeleted: true,
        };

        if (!(await sendInvitation(newAdmin.id))) {
          toast.error('Admin created, but the invitation email failed. Use "Resend invitation".');
        }
        setAdmins((prev) => [...prev, newAdmin]);
        setShowNewAdminDialog(false);
        setSearchTerm(''); // Clear search bar after creation

        setSuccessMessage(`Admin created! Invitation sent to ${newAdmin.email}`);
        setTimeout(() => setSuccessMessage(''), 5000);
        resetForm();
      }
    } catch (err) {
      console.error('Error creating admin:', err);
      setError((err as Error).message || 'Failed to create admin');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditAdmin = async () => {
    if (!selectedAdmin || !formData.name || !formData.email || !formData.phone) {
      setError('Please fill in all required fields');
      return;
    }

    // Format phone to E.164 format
    const phoneFormatted = formatPhoneToE164(formData.phone, formData.countryCode);
    if (!phoneFormatted) {
      setError(`Invalid phone number for ${formData.countryCode}. Please check the format.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // Get current user from localStorage
      const currentUserStr = localStorage.getItem('user');
      const currentUser = currentUserStr ? JSON.parse(currentUserStr) : null;
      const isEditingSelf =
        currentUser && (currentUser.id === selectedAdmin.id || currentUser._id === selectedAdmin.id);

      // Update admin basic info via API
      const response = await adminService.updateAdmin(selectedAdmin.id, {
        name: formData.name,
        email: formData.email,
        phone: phoneFormatted.e164, // Send E.164 formatted phone
        role: 'admin',
      });

      // Only update permissions if NOT editing own account
      if (!isEditingSelf) {
        await adminService.updateAdminPermissions(selectedAdmin.id, formData.permissions || []);
      } else {
        console.log('Skipping permission update - cannot modify own permissions');
      }

      if (response.status === 'success') {
        setAdmins(
          admins.map((a) =>
            a.id === selectedAdmin.id
              ? {
                  ...a,
                  name: formData.name,
                  email: formData.email,
                  phone: phoneFormatted.e164,
                  permissions: isEditingSelf ? a.permissions : formData.permissions || [],
                }
              : a
          )
        );
        setSelectedAdmin(null);
        setShowEditAdminDialog(false);

        if (isEditingSelf) {
          setSuccessMessage(`Profile updated successfully (permissions cannot be self-modified)`);
        } else {
          setSuccessMessage(`Admin updated successfully`);
        }

        setTimeout(() => setSuccessMessage(''), 5000);
        resetForm();
      }
    } catch (err) {
      console.error('Error updating admin:', err);
      setError((err as Error).message || 'Failed to update admin');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Resend invitation to pending admin
  const handleResendInvitation = (admin: Admin) => {
    setAdminToResendInvite(admin);
    setShowInviteResendConfirm(true);
  };

  const confirmResendInvitation = async () => {
    if (!adminToResendInvite) return;
    try {
      setIsSubmitting(true);

      await adminService.resetUserPassword(adminToResendInvite.id);
      setAdmins(
        admins.map((a) =>
          a.id === adminToResendInvite.id ? { ...a, invitationSentAt: new Date().toISOString() } : a
        )
      );

      setShowInviteResendConfirm(false);
      setAdminToResendInvite(null);

      toast.success(`Invitation resent to ${adminToResendInvite.email}`, {
        duration: 4000,
      });
    } catch (err) {
      console.error('Error resending invitation:', err);
      toast.error((err as Error).message || 'Failed to resend invitation', {
        duration: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Force password reset
  const handleForcePasswordReset = (admin: Admin) => {
    setAdminToResetPassword(admin);
    setShowPasswordResetConfirm(true);
  };

  const confirmPasswordReset = async () => {
    if (!adminToResetPassword) return;
    try {
      setIsSubmitting(true);

      const response = await adminService.resetUserPassword(adminToResetPassword.id);

      if (response.status === 'success') {
        // Update admin status to reflect password reset
        setAdmins(
          admins.map((a) =>
            a.id === adminToResetPassword.id
              ? {
                  ...a,
                  status: 'password_reset_required',
                  accountStatus: 'pending_password_change',
                  isTempPassword: true,
                }
              : a
          )
        );

        setShowPasswordResetConfirm(false);
        setAdminToResetPassword(null);

        console.log(`Password reset email sent to ${adminToResetPassword.email}`);

        toast.success(`Password reset email sent to ${adminToResetPassword.email}`, {
          duration: 4000,
        });
      } else {
        throw new Error(response.message || 'Failed to send password reset email');
      }
    } catch (err) {
      console.error('Error sending password reset:', err);

      let errorMessage = (err as Error).message || 'Failed to send password reset email';
      if (errorMessage.includes('Cannot reset other admin passwords')) {
        errorMessage = 'Security Policy: Admins can only reset their own password or non-admin user passwords.';
      }

      toast.error(errorMessage, {
        duration: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAdmin = (admin: Admin) => {
    // PERMISSION CHECK: Verify user has permission to manage admins
    if (!canManageAdmins) {
      toast.error(getPermissionDeniedMessage('delete', 'admin accounts'), {
        duration: 4000,
      });
      return;
    }
    setAdminToDelete(admin);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!adminToDelete) return;
    try {
      setIsSubmitting(true);

      const response = await adminService.deleteUser(adminToDelete.id);

      if (response.status === 'success') {
        setAdmins(admins.filter((a) => a.id !== adminToDelete.id));
        setShowDeleteConfirm(false);
        setAdminToDelete(null);
        setSelectedAdmin(null);

        toast.success(`Admin "${adminToDelete.name}" deleted successfully`, {
          duration: 4000,
        });
      }
    } catch (err) {
      console.error('Error deleting admin:', err);
      toast.error((err as Error).message || 'Failed to delete admin', {
        duration: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (admin: Admin) => {
    // PERMISSION CHECK: Verify user has permission to manage admins
    if (!canManageAdmins) {
      toast.error(getPermissionDeniedMessage('update', 'admin accounts'), {
        duration: 4000,
      });
      return;
    }

    setSelectedAdmin(admin);

    // Parse phone number if it's in E.164 format
    let phoneCountry = 'US';
    let phoneNumber = '';
    if (admin.phone) {
      const parsed = parseE164(admin.phone);
      if (parsed) {
        phoneCountry = parsed.countryCode || 'US';
        // Get the calling code for this country
        const country = COUNTRIES.find((c) => c.code === phoneCountry);
        const callingCode = country?.callingCode?.replace('+', '') || '';

        // Extract only the local phone number by removing the calling code prefix
        if (callingCode && admin.phone.startsWith('+' + callingCode)) {
          phoneNumber = admin.phone.substring(callingCode.length + 1);
        } else {
          phoneNumber = admin.phone.replace(/^\+\d+/, '').trim();
        }
      } else {
        phoneNumber = admin.phone;
      }
    }

    setFormData({
      name: admin.name,
      email: admin.email,
      phone: phoneNumber,
      countryCode: phoneCountry,
      permissions: admin.permissions || [],
    });
    setShowEditAdminDialog(true);
  };

  const togglePermission = (permissionId: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter((p) => p !== permissionId)
        : [...prev.permissions, permissionId],
    }));
  };

  // Check if editing own account
  const isEditingSelf = () => {
    if (!selectedAdmin) return false;
    const currentUserStr = localStorage.getItem('user');
    const currentUser = currentUserStr ? JSON.parse(currentUserStr) : null;
    return currentUser && (currentUser.id === selectedAdmin.id || currentUser._id === selectedAdmin.id);
  };

  return (
    <div className="space-y-6">
      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader className="size-8 animate-spin text-primary" />
          <p className="ml-3 text-muted-foreground">Loading admins...</p>
        </div>
      )}

      {!loading && (
        <>
          {!canManageAdmins ? (
            <PermissionDeniedView
              section="Admin Management"
              requiredPermission="manage_admins"
              message="You don't have permission to manage administrator accounts. Contact your system administrator to request access."
            />
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-heading text-2xl font-bold text-foreground">Admin Management</h2>
                  <p className="mt-1 text-muted-foreground">Manage system administrators and their permissions</p>
                </div>
                <Button
                  onClick={() => {
                    resetForm();
                    setShowNewAdminDialog(true);
                  }}
                >
                  <Plus className="size-4" />
                  Add Admin
                </Button>
              </div>

              {/* Info Banner - Password & Security Policy */}
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-accent p-4">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Password & Security Policy</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    New admins receive temporary passwords via email. They must set a permanent password on first
                    login. Passwords expire after 90 days and require: 12+ characters, uppercase, lowercase,
                    numbers, and symbols.
                  </p>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <StatCard label="Total Admins" value={stats.total} icon={Shield} color="primary" />
                <StatCard label="Active" value={stats.active} icon={Shield} color="success" />
                <StatCard label="Invited" value={stats.invited} icon={Mail} color="warning" />
                <StatCard label="Inactive" value={stats.inactive} icon={Shield} color="muted" />
              </div>

              {/* Table Section */}
              <UserTableHeader
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                onFilterClick={() => {}}
                title="Admins List"
                subtitle="View and manage all system administrators"
              />

              <AdminTable
                admins={paginatedData.data}
                onEdit={openEditDialog}
                onDelete={handleDeleteAdmin}
                onView={setViewingAdmin}
                onResendInvite={handleResendInvitation}
                onForcePasswordReset={handleForcePasswordReset}
              />

              <Pagination
                currentPage={currentPage}
                totalPages={paginatedData.pages}
                onPageChange={setCurrentPage}
                itemsPerPage={ITEMS_PER_PAGE}
                totalItems={filteredAdmins.length}
              />
            </>
          )}
        </>
      )}

      {/* Add Admin Dialog */}
      <UserFormDialog
        isOpen={showNewAdminDialog}
        onClose={() => {
          setShowNewAdminDialog(false);
          setError(null);
          resetForm();
        }}
        onSubmit={handleAddAdmin}
        title="Add New Admin"
        subtitle="Create a new system administrator account"
        submitLabel="Create & Send Invitation"
        isSubmitting={isSubmitting}
        error={error}
        successMessage={successMessage}
      >
        <div className="space-y-4">
          {/* Step Indicator */}
          <div className="rounded-lg border border-primary/20 bg-accent p-3">
            <p className="text-xs font-semibold text-foreground">WHAT HAPPENS NEXT:</p>
            <ol className="mt-2 ml-4 space-y-1 text-xs text-muted-foreground">
              <li>1. Admin account is created in the system</li>
              <li>2. Temporary password is generated automatically</li>
              <li>3. Invitation email is sent to their address</li>
              <li>4. Admin must set permanent password on first login</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Full Name" required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                placeholder="e.g., John Doe"
              />
            </FormGroup>
            <FormGroup label="Email Address" required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                placeholder="john@company.com"
              />
            </FormGroup>
          </div>

          <FormGroup label="Phone Number" required>
            <div className="flex gap-2">
              <select
                value={formData.countryCode}
                onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.callingCode} {country.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                placeholder="Enter phone number"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Select country and enter phone number (with or without country code)
            </p>
          </FormGroup>

          <div className="rounded-lg bg-muted p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Assign Permissions</p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {ADMIN_PERMISSIONS_LIST.map((perm) => (
                <label
                  key={perm.id}
                  className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm transition-colors hover:bg-card"
                >
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    className="size-4 accent-primary"
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

      {/* Edit Admin Dialog */}
      <UserFormDialog
        isOpen={showEditAdminDialog}
        onClose={() => {
          setShowEditAdminDialog(false);
          setError(null);
          resetForm();
        }}
        onSubmit={handleEditAdmin}
        title="Edit Admin"
        subtitle="Update administrator information and permissions"
        submitLabel="Update Admin"
        isSubmitting={isSubmitting}
        error={error}
        successMessage={successMessage}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Full Name" required>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
              />
            </FormGroup>
            <FormGroup label="Email Address" required>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
              />
            </FormGroup>
          </div>

          <FormGroup label="Phone Number" required>
            <div className="flex gap-2">
              <select
                value={formData.countryCode}
                onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.callingCode} {country.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50"
                placeholder="Enter phone number"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Select country and enter phone number</p>
          </FormGroup>

          <div className="rounded-lg bg-muted p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Permissions</p>

            {/* Warning for self-edit */}
            {isEditingSelf() && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />
                <div className="text-sm text-warning">
                  <strong>Note:</strong> You cannot modify your own permissions for security reasons.
                </div>
              </div>
            )}

            <div className="max-h-48 space-y-2 overflow-y-auto">
              {ADMIN_PERMISSIONS_LIST.map((perm) => (
                <label
                  key={perm.id}
                  className={`flex items-center gap-2 rounded p-2 text-sm transition-colors ${
                    isEditingSelf() ? 'cursor-not-allowed bg-muted opacity-60' : 'cursor-pointer hover:bg-card'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    disabled={isEditingSelf()}
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
          setAdminToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Admin"
        description={`Are you sure you want to delete ${adminToDelete?.name}? This action cannot be undone. They will lose all access to the system.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDangerous
      />

      {/* Resend Invitation Confirmation */}
      <ConfirmationDialog
        isOpen={showInviteResendConfirm}
        onClose={() => {
          setShowInviteResendConfirm(false);
          setAdminToResendInvite(null);
        }}
        onConfirm={confirmResendInvitation}
        title="Resend Invitation"
        description={`Resend invitation email to ${adminToResendInvite?.email}? They will receive a new temporary password.`}
        confirmLabel="Resend"
        cancelLabel="Cancel"
      />

      {/* Password Reset Confirmation */}
      <ConfirmationDialog
        isOpen={showPasswordResetConfirm}
        onClose={() => {
          setShowPasswordResetConfirm(false);
          setAdminToResetPassword(null);
        }}
        onConfirm={confirmPasswordReset}
        title="Force Password Reset"
        description={`Send password reset email to ${adminToResetPassword?.email}? They will receive a temporary password and must set a new one on next login.`}
        confirmLabel="Send Reset Email"
        cancelLabel="Cancel"
        isLoading={isSubmitting}
      />

      {/* Admin Details (read-only, primarily for Super Admin rows which can't be edited/deleted) */}
      <AdminDetailsModal
        admin={viewingAdmin}
        isOpen={!!viewingAdmin}
        onClose={() => setViewingAdmin(null)}
        isSuperAdmin={viewingAdmin?.isSuperAdmin}
      />
    </div>
  );
};

export default AdminManagement;
