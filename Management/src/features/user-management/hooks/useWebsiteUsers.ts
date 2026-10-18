import { useState, useCallback, useEffect, useRef } from 'react';
import websiteUserService from '../../../services/websiteUser.service';
import { unwrapList } from '../../../services/apiResponse';

export interface WebsiteUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  phoneCountry?: string;
  status: 'active' | 'inactive';
  [key: string]: unknown;
}

export interface WebsiteUsersPagination {
  currentPage: number;
  totalPages: number;
  totalUsers: number;
  usersPerPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface WebsiteUsersFilters {
  search: string;
  ids?: string;
  isActive?: boolean;
  isEmailVerified?: boolean;
  page: number;
  limit: number;
  [key: string]: unknown;
}

/**
 * Custom hook for managing website users
 * Handles fetching, creating, updating, and deleting users
 */
export const useWebsiteUsers = (recordIds?: string) => {
  const [users, setUsers] = useState<WebsiteUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<WebsiteUsersPagination>({
    currentPage: 1,
    totalPages: 1,
    totalUsers: 0,
    usersPerPage: 10,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [filters, setFilters] = useState<WebsiteUsersFilters>({
    search: '',
    ids: recordIds,
    isActive: undefined,
    isEmailVerified: undefined,
    page: 1,
    limit: 10,
  });
  const previousRecordIds = useRef(recordIds);

  /**
   * Fetch users from API
   */
  const fetchUsers = useCallback(
    async (queryParams: Partial<WebsiteUsersFilters> = {}) => {
      setLoading(true);
      setError(null);
      try {
        // Clean up params - remove undefined and empty string values
        const cleanParams: Record<string, unknown> = {};
        const paramsToUse = { ...filters, ...queryParams };

        Object.keys(paramsToUse).forEach((key) => {
          const value = paramsToUse[key];
          // Only include parameters that have meaningful values
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value;
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc documents these params as required, which doesn't match the real (all-optional) runtime contract
        const response = await websiteUserService.getAllUsers(cleanParams as any);

        if (response.status === 'success') {
          // user-service returns a flat array in `data` and pagination at the
          // top level — not nested under `data.users`/`data.pagination`.
          const { items, pagination: rawPagination } = unwrapList(response);
          const transformedUsers = items.map((user: unknown) =>
            websiteUserService.transformUserData(user)
          );
          setUsers(transformedUsers);
          if (rawPagination) {
            setPagination({
              currentPage: rawPagination.page,
              totalPages: rawPagination.pages,
              totalUsers: rawPagination.total,
              usersPerPage: rawPagination.limit,
              hasNextPage: rawPagination.page < rawPagination.pages,
              hasPrevPage: rawPagination.page > 1,
            });
          }
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        setError((err as Error).message || 'Failed to fetch users');
        console.error('Error fetching users:', err);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  /**
   * Create new user
   */
  const createUser = useCallback(
    async (userData: {
      name: string;
      email: string;
      phone?: string;
      phoneCountry?: string;
      password: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        // Validate before sending
        const validation = websiteUserService.validateUserData(userData);
        if (!validation.valid) {
          throw new Error(Object.values(validation.errors)[0] as string);
        }

        // Transform to API format
        const apiData = {
          name: userData.name,
          email: userData.email,
          phone: userData.phone, // Already in E.164 format from frontend
          phoneCountry: userData.phoneCountry, // ISO country code
          password: userData.password,
          role: 'customer', // Always customer role
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc documents phone/phoneCountry as required, which doesn't match the real (optional) runtime contract
        const response = await websiteUserService.createUser(apiData as any);

        if (response.status === 'success') {
          // Reset filters and refresh user list
          const resetFilters: WebsiteUsersFilters = {
            search: '',
            isActive: undefined,
            isEmailVerified: undefined,
            page: 1,
            limit: 10,
          };
          setFilters(resetFilters);
          // Fetch with reset filters
          await fetchUsers({ ...resetFilters, page: 1 });
          return response.data;
        } else {
          throw new Error('Failed to create user');
        }
      } catch (err) {
        setError((err as Error).message || 'Failed to create user');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchUsers]
  );

  /**
   * Update user
   */
  const updateUser = useCallback(
    async (
      userId: string,
      userData: { name?: string; phone?: string; phoneCountry?: string; email?: string; status?: string }
    ) => {
      setLoading(true);
      setError(null);
      try {
        // Validate before sending
        const validation = websiteUserService.validateUserData(userData);
        if (!validation.valid) {
          throw new Error(Object.values(validation.errors)[0] as string);
        }

        const updateData: Record<string, unknown> = {
          name: userData.name,
          phone: userData.phone, // E.164 format from frontend
          phoneCountry: userData.phoneCountry, // ISO country code
          email: userData.email,
        };

        if (userData.status !== undefined) {
          updateData.isActive = userData.status === 'active';
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service is untyped JS; its JSDoc documents these params as required, which doesn't match the real (all-optional) runtime contract
        const response = await websiteUserService.updateUser(userId, updateData as any);

        if (response.status === 'success') {
          // Reset filters and refresh user list
          const resetFilters: WebsiteUsersFilters = {
            search: '',
            isActive: undefined,
            isEmailVerified: undefined,
            page: 1,
            limit: 10,
          };
          setFilters(resetFilters);
          await fetchUsers(resetFilters);
          return response.data;
        } else {
          throw new Error('Failed to update user');
        }
      } catch (err) {
        setError((err as Error).message || 'Failed to update user');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchUsers]
  );

  /**
   * Delete user
   */
  const deleteUser = useCallback(
    async (userId: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await websiteUserService.deleteUser(userId);

        if (response.status === 'success') {
          // Reset filters and refresh user list
          const resetFilters: WebsiteUsersFilters = {
            search: '',
            isActive: undefined,
            isEmailVerified: undefined,
            page: 1,
            limit: 10,
          };
          setFilters(resetFilters);
          await fetchUsers(resetFilters);
          return response;
        } else {
          throw new Error('Failed to delete user');
        }
      } catch (err) {
        setError((err as Error).message || 'Failed to delete user');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchUsers]
  );

  /**
   * Toggle user status
   */
  const toggleUserStatus = useCallback(async (userId: string, currentStatus: string) => {
    setLoading(true);
    setError(null);
    try {
      const newStatus = currentStatus !== 'active';
      const response = await websiteUserService.toggleUserStatus(userId, newStatus);

      if (response.status === 'success') {
        // Update local state
        setUsers((prevUsers) =>
          prevUsers.map((user) =>
            user.id === userId ? { ...user, status: newStatus ? 'active' : 'inactive' } : user
          )
        );
        return response.data;
      } else {
        throw new Error('Failed to toggle user status');
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to toggle user status');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Search users
   */
  const searchUsers = useCallback(
    async (searchTerm: string) => {
      const newFilters = {
        ...filters,
        search: searchTerm,
        page: 1,
      };
      setFilters(newFilters);
      await fetchUsers(newFilters);
    },
    [filters, fetchUsers]
  );

  /**
   * Change page
   */
  const changePage = useCallback(
    async (page: number) => {
      const newFilters = {
        ...filters,
        page,
      };
      setFilters(newFilters);
      await fetchUsers(newFilters);
    },
    [filters, fetchUsers]
  );

  /**
   * Update filters
   */
  const updateFilters = useCallback(
    async (newFilters: Partial<WebsiteUsersFilters>) => {
      const updatedFilters = {
        ...filters,
        ...newFilters,
        page: 1, // Reset to first page on filter change
      };
      setFilters(updatedFilters);
      await fetchUsers(updatedFilters);
    },
    [filters, fetchUsers]
  );

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  useEffect(() => {
    if (previousRecordIds.current === recordIds) return;
    previousRecordIds.current = recordIds;
    const updatedFilters = { ...filters, ids: recordIds, page: 1 };
    setFilters(updatedFilters);
    void fetchUsers(updatedFilters);
  }, [fetchUsers, filters, recordIds]);

  return {
    users,
    loading,
    error,
    pagination,
    filters,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    searchUsers,
    changePage,
    updateFilters,
    clearError,
  };
};

export default useWebsiteUsers;
