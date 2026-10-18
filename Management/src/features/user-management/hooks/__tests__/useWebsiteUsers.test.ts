import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { mockGetAllUsers, mockCreateUser, mockUpdateUser, mockDeleteUser, mockToggleUserStatus } = vi.hoisted(() => ({
  mockGetAllUsers: vi.fn(),
  mockCreateUser: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockToggleUserStatus: vi.fn(),
}));

vi.mock('../../../../services/websiteUser.service', () => ({
  default: {
    getAllUsers: mockGetAllUsers,
    createUser: mockCreateUser,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
    toggleUserStatus: mockToggleUserStatus,
    validateUserData: () => ({ valid: true, errors: {} }),
    transformUserData: (u: any) => ({
      id: u._id || u.id,
      name: u.name,
      email: u.email,
      status: u.isActive ? 'active' : 'inactive',
    }),
  },
}));

import { useWebsiteUsers } from '../useWebsiteUsers';

beforeEach(() => {
  mockGetAllUsers.mockReset();
  mockCreateUser.mockReset();
  mockUpdateUser.mockReset();
  mockDeleteUser.mockReset();
  mockToggleUserStatus.mockReset();
});

describe('useWebsiteUsers.fetchUsers', () => {
  it('passes recommendation IDs to the customer list request and updates them when the filter changes', async () => {
    mockGetAllUsers.mockResolvedValue({
      status: 'success',
      data: [],
      pagination: { total: 0, page: 1, limit: 10, pages: 1 },
    });
    const firstIds = '11111111-1111-4111-8111-111111111111,33333333-3333-4333-8333-333333333333';
    const secondIds = '44444444-4444-4444-8444-444444444444';
    const { result, rerender } = renderHook(
      ({ ids }) => useWebsiteUsers(ids),
      { initialProps: { ids: firstIds } },
    );

    await waitFor(() => expect(mockGetAllUsers).toHaveBeenLastCalledWith(expect.objectContaining({ ids: firstIds })));

    act(() => rerender({ ids: secondIds }));

    await waitFor(() => expect(mockGetAllUsers).toHaveBeenLastCalledWith(expect.objectContaining({ ids: secondIds })));
    expect(result.current.filters.ids).toBe(secondIds);
  });

  it('populates users from the flat-array contract instead of throwing "Invalid response format" (regression)', async () => {
    mockGetAllUsers.mockResolvedValue({
      status: 'success',
      data: [{ id: 'u1', name: 'Alice', email: 'alice@test.com', isActive: true }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });

    const { result } = renderHook(() => useWebsiteUsers());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.users).toEqual([{ id: 'u1', name: 'Alice', email: 'alice@test.com', status: 'active' }]);
  });

  it('maps top-level pagination fields onto the currentPage/totalPages/etc. shape the UI expects', async () => {
    mockGetAllUsers.mockResolvedValue({
      status: 'success',
      data: [],
      pagination: { total: 25, page: 2, limit: 10, pages: 3 },
    });

    const { result } = renderHook(() => useWebsiteUsers());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pagination).toEqual({
      currentPage: 2,
      totalPages: 3,
      totalUsers: 25,
      usersPerPage: 10,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('sets an error when the response is not a success envelope', async () => {
    mockGetAllUsers.mockResolvedValue({ status: 'error' });

    const { result } = renderHook(() => useWebsiteUsers());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Invalid response format');
    expect(result.current.users).toEqual([]);
  });
});

describe('useWebsiteUsers.createUser / updateUser / deleteUser / toggleUserStatus', () => {
  it('createUser posts customer role and refetches on success', async () => {
    mockGetAllUsers.mockResolvedValue({ status: 'success', data: [], pagination: { total: 0, page: 1, limit: 10, pages: 1 } });
    mockCreateUser.mockResolvedValue({ status: 'success', data: { id: 'new-1' } });

    const { result } = renderHook(() => useWebsiteUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createUser({ name: 'Bob', email: 'bob@test.com', password: 'secret1' });
    });

    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'customer' }));
    expect(mockGetAllUsers).toHaveBeenCalledTimes(2); // initial mount + post-create refetch
  });

  it('updateUser sends isActive derived from status', async () => {
    mockGetAllUsers.mockResolvedValue({ status: 'success', data: [], pagination: { total: 0, page: 1, limit: 10, pages: 1 } });
    mockUpdateUser.mockResolvedValue({ status: 'success', data: { id: 'u1' } });

    const { result } = renderHook(() => useWebsiteUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateUser('u1', { name: 'Alice', status: 'inactive' });
    });

    expect(mockUpdateUser).toHaveBeenCalledWith('u1', expect.objectContaining({ isActive: false }));
  });

  it('deleteUser refetches the list on success', async () => {
    mockGetAllUsers.mockResolvedValue({ status: 'success', data: [], pagination: { total: 0, page: 1, limit: 10, pages: 1 } });
    mockDeleteUser.mockResolvedValue({ status: 'success' });

    const { result } = renderHook(() => useWebsiteUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteUser('u1');
    });

    expect(mockDeleteUser).toHaveBeenCalledWith('u1');
    expect(mockGetAllUsers).toHaveBeenCalledTimes(2);
  });

  it('toggleUserStatus flips the local status without a full refetch', async () => {
    mockGetAllUsers.mockResolvedValue({
      status: 'success',
      data: [{ id: 'u1', name: 'Alice', isActive: true }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });
    mockToggleUserStatus.mockResolvedValue({ status: 'success', data: { id: 'u1' } });

    const { result } = renderHook(() => useWebsiteUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleUserStatus('u1', 'active');
    });

    expect(mockToggleUserStatus).toHaveBeenCalledWith('u1', false);
    expect(result.current.users[0].status).toBe('inactive');
  });
});
