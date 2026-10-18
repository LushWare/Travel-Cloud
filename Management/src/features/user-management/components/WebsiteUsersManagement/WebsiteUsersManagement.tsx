import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, UserCheck, UserX, AlertCircle } from 'lucide-react';
import { UserTableHeader, Pagination, UserFormDialog, ConfirmationDialog, FormGroup } from '../Common';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import WebsiteUsersTable from './WebsiteUsersTable';
import useWebsiteUsers, { type WebsiteUser } from '../../hooks/useWebsiteUsers';
import { validatePhone, formatPhoneToE164, getPhonePlaceholder, COUNTRIES } from '../../utils/phoneUtils';

interface WebsiteUserFormData {
  name: string;
  email: string;
  phone: string;
  phoneCountry: string;
  password: string;
  status: string;
}

const EMPTY_FORM: WebsiteUserFormData = {
  name: '',
  email: '',
  phone: '',
  phoneCountry: 'US',
  password: '',
  status: 'active',
};

const WebsiteUsersManagement = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const recordIds = searchParams.get('ids') || undefined;
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const {
    users,
    loading,
    error,
    pagination,
    updateUser,
    deleteUser,
    toggleUserStatus,
    searchUsers,
    changePage,
    clearError,
  } = useWebsiteUsers(recordIds);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showEditUserDialog, setShowEditUserDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedUser, setSelectedUser] = useState<WebsiteUser | null>(null);
  const [userToDelete, setUserToDelete] = useState<WebsiteUser | null>(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<WebsiteUserFormData>(EMPTY_FORM);

  useEffect(() => {
    if (!recordIds || !recommendationFocus || loading) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, recommendationFocus, recordIds]);

  // Calculate stats from all users
  const stats = {
    total: pagination?.totalUsers || 0,
    active: users.filter((u) => u.status === 'active').length,
    inactive: users.filter((u) => u.status === 'inactive').length,
    totalRevenue: users.reduce((sum, user) => sum + ((user.totalSpent as number) || 0), 0),
    totalBookings: users.reduce((sum, user) => sum + ((user.bookings as number) || 0), 0),
    avgSpent:
      users.length > 0
        ? (users.reduce((sum, user) => sum + ((user.totalSpent as number) || 0), 0) / users.length).toFixed(2)
        : '0',
  };

  const filteredUsers = filterStatus === 'all' ? users : users.filter((u) => u.status === filterStatus);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setFormError('');
  };

  const handleEditUser = async () => {
    setFormError('');

    if (!formData.name || !formData.email || !formData.phone) {
      setFormError('Name, email, and phone are required');
      return;
    }

    if (!validatePhone(formData.phone, formData.phoneCountry)) {
      setFormError(`Please provide a valid phone number for ${formData.phoneCountry}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const phoneData = formatPhoneToE164(formData.phone, formData.phoneCountry);

      if (!phoneData) {
        setFormError('Failed to format phone number. Please check the input.');
        setIsSubmitting(false);
        return;
      }

      const dataToSend = {
        ...formData,
        phone: phoneData.e164,
        phoneCountry: phoneData.countryCode,
      };

      if (!selectedUser) return;
      await updateUser(selectedUser.id, dataToSend);
      setShowEditUserDialog(false);
      setSelectedUser(null);
      resetForm();
      setSearchTerm('');
      setFilterStatus('all');
    } catch (err) {
      setFormError((err as Error).message || 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = (user: WebsiteUser) => {
    setUserToDelete(user);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteUser(userToDelete.id);
      setShowDeleteConfirm(false);
      setUserToDelete(null);
      setSelectedUser(null);
      setSearchTerm('');
      setFilterStatus('all');
    } catch (err) {
      setFormError((err as Error).message || 'Failed to delete user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: WebsiteUser) => {
    try {
      await toggleUserStatus(user.id, user.status);
    } catch (err) {
      setFormError((err as Error).message || 'Failed to toggle user status');
    }
  };

  const openEditDialog = (user: WebsiteUser) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      phoneCountry: (user.phoneCountry as string) || 'US',
      status: user.status,
      password: '',
    });
    setShowEditUserDialog(true);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    searchUsers(value);
  };

  const handleFilterStatusChange = (value: string) => {
    setFilterStatus(value);
  };

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <h3 className="font-semibold text-destructive">Error</h3>
            <p className="mt-1 text-sm text-destructive">{error}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Website Users</h2>
          <p className="mt-1 text-muted-foreground">Manage platform users and their bookings</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Users" value={stats.total} icon={Users} color="primary" />
        <StatCard label="Active Users" value={stats.active} icon={UserCheck} color="success" />
        <StatCard label="Inactive" value={stats.inactive} icon={UserX} color="muted" />
        <StatCard label="Total Bookings" value={stats.totalBookings} icon={Users} color="muted" />
        <StatCard label="Total Revenue" value={`$${(stats.totalRevenue / 1000).toFixed(1)}K`} icon={Users} color="success" />
        <StatCard label="Avg. Spent" value={`$${stats.avgSpent}`} icon={Users} color="primary" />
      </div>

      {/* Filters */}
      <div className="flex gap-4 rounded-lg border border-border bg-card p-4 shadow-card">
        <div className="w-full sm:w-64">
          <label className="mb-2 block text-sm font-medium text-foreground">User Status</label>
          <select
            value={filterStatus}
            onChange={(e) => handleFilterStatusChange(e.target.value)}
            disabled={loading}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
          >
            <option value="all">All Users</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {recordIds && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-sm text-foreground">
            Showing unverified customer accounts <span className="font-mono tabular-nums">({pagination.totalUsers})</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({ tab: 'website-users' })}>Clear filter</Button>
        </div>
      )}

      {/* Table Section */}
      <UserTableHeader
        searchTerm={searchTerm}
        onSearchChange={handleSearchChange}
        onFilterClick={() => {}}
        title="Users List"
        subtitle={loading ? 'Loading users...' : `Showing ${filteredUsers.length} users`}
        disabled={loading}
      />

      {loading && !users.length ? (
        <div className="py-12 text-center text-muted-foreground">
          <p className="text-lg">Loading users...</p>
        </div>
      ) : (
        <>
          <div id="recommendation-target" className="scroll-mt-20 space-y-4">
            <WebsiteUsersTable
              users={filteredUsers}
              onEdit={openEditDialog}
              onDelete={handleDeleteUser}
              onToggleStatus={handleToggleStatus}
              loading={loading}
            />

            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={changePage}
              itemsPerPage={pagination.usersPerPage}
              totalItems={pagination.totalUsers}
              disabled={loading}
            />
          </div>
        </>
      )}

      {/* Edit User Dialog */}
      <UserFormDialog
        isOpen={showEditUserDialog}
        onClose={() => {
          setShowEditUserDialog(false);
          setFormError('');
          resetForm();
        }}
        onSubmit={handleEditUser}
        title="Edit Website User"
        subtitle="Update user information"
        submitLabel="Update User"
        isSubmitting={isSubmitting}
        error={formError}
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
            <FormGroup label="Phone" required>
              <div className="flex gap-2">
                <select
                  value={formData.phoneCountry}
                  onChange={(e) => setFormData({ ...formData, phoneCountry: e.target.value })}
                  disabled={isSubmitting}
                  className="h-8 w-28 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                >
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.flag} {country.code}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={isSubmitting}
                  className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
                  placeholder={getPhonePlaceholder(formData.phoneCountry)}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Enter phone number with or without country code</p>
            </FormGroup>
            <FormGroup label="Status" required>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                disabled={isSubmitting}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-3 focus:ring-ring/50 disabled:opacity-50"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </FormGroup>
          </div>
        </div>
      </UserFormDialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setUserToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Website User"
        description={`Are you sure you want to delete ${userToDelete?.name}? This action cannot be undone and will remove all associated data.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDangerous
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default WebsiteUsersManagement;
