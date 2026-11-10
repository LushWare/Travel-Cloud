/**
 * Admin API Service
 * Handles all admin-related API calls including user management, admin operations, and settings
 */

import api, { authAPI } from './api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

class AdminService {
  constructor() {
    this.api = api;
  }

  /**
   * ==================== USER MANAGEMENT ====================
   */

  /**
   * Get all users with advanced filtering, sorting, and pagination
   * @param {Object} params - Query parameters
   * @param {number} params.page - Page number (default: 1)
   * @param {number} params.limit - Items per page (default: 10, max: 100)
   * @param {string} params.sort - Sort field (e.g., '-createdAt')
   * @param {string} params.search - Search query
   * @param {string} params.role - Filter by role (customer, salesRep, vendor, admin)
   * @param {boolean} params.isActive - Filter by active status
   * @param {boolean} params.isEmailVerified - Filter by email verification status
   * @returns {Promise<any>} User list with pagination info
   */
  async getAllUsers(params = {}) {
    try {
      const response = await this.api.get('/users', params);
      return response;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  }

  /**
   * Get single user by ID
   * @param {string} userId - User ID (MongoDB ObjectId)
   * @returns {Promise<any>} User data
   */
  async getUserById(userId) {
    try {
      const response = await this.api.get(`/users/${userId}`);
      return response;
    } catch (error) {
      console.error(`Error fetching user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get users by specific role
   * @param {string} role - User role (customer, salesRep, vendor, admin)
   * @param {Object} params - Additional query parameters
   * @returns {Promise<any>} Users with specified role
   */
  async getUsersByRole(role, params = {}) {
    try {
      const response = await this.api.get(`/users/role/${role}`, params);
      return response;
    } catch (error) {
      console.error(`Error fetching users with role ${role}:`, error);
      throw error;
    }
  }

  /**
   * Get user statistics for dashboard
   * @returns {Promise<any>} User statistics (total, active, by role, etc.)
   */
  async getUserStats() {
    try {
      const response = await this.api.get('/users/stats');
      return response;
    } catch (error) {
      console.error('Error fetching user stats:', error);
      throw error;
    }
  }

  /**
   * Create new user (admin only)
   * @param {Object} userData - User data
   * @param {string} userData.name - User name (required)
   * @param {string} userData.email - User email (required)
   * @param {string} userData.phone - User phone number
   * @param {string} userData.password - User password (required)
   * @param {string} userData.role - User role: customer, salesRep, vendor, admin (required)
   * @returns {Promise<any>} Created user
   */
  async createUser(userData) {
    try {
      const response = await this.api.post('/users', userData);
      return response;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Update user details
   * @param {string} userId - User ID
   * @param {Object} updateData - Data to update
   * @param {string} updateData.name - User name
   * @param {string} updateData.phone - Phone number
   * @param {string} updateData.email - Email address
   * @param {string} updateData.role - User role
   * @param {boolean} updateData.isActive - Active status
   * @returns {Promise<any>} Updated user
   */
  async updateUser(userId, updateData) {
    try {
      const response = await this.api.put(`/users/${userId}`, updateData);
      return response;
    } catch (error) {
      console.error(`Error updating user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update user password
   * @param {string} userId - User ID
   * @param {Object} passwordData - Password data
   * @param {string} passwordData.currentPassword - Current password
   * @param {string} passwordData.newPassword - New password
   * @param {string} passwordData.confirmPassword - Confirm new password
   * @returns {Promise<any>} Success response
   */
  async updateUserPassword(userId, passwordData) {
    try {
      const response = await this.api.put(`/users/${userId}/change-password`, passwordData);
      return response;
    } catch (error) {
      console.error(`Error updating password for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Delete user permanently
   * @param {string} userId - User ID
   * @param {boolean} confirmDelete - Must be true to confirm deletion
   * @returns {Promise<any>} Success response
   */
  async deleteUser(userId, confirmDelete = true) {
    try {
      const response = await this.api.delete(`/users/${userId}?confirmDelete=${confirmDelete}`);
      return response;
    } catch (error) {
      console.error(`Error deleting user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Toggle user active status (soft delete/archive)
   * @param {string} userId - User ID
   * @param {boolean} isActive - Active status
   * @returns {Promise<any>} Updated user
   */
  async toggleUserStatus(userId, isActive) {
    try {
      const response = await this.api.patch(`/users/${userId}/toggle-status`, { isActive });
      return response;
    } catch (error) {
      console.error(`Error toggling user status for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Assign or update user role
   * @param {string} userId - User ID
   * @param {string} role - New role (customer, salesRep, vendor, admin)
   * @returns {Promise<any>} Updated user
   */
  async assignUserRole(userId, role) {
    try {
      const response = await this.api.patch(`/users/${userId}/role`, { role });
      return response;
    } catch (error) {
      console.error(`Error assigning role to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Force password reset for a user (admin only)
   * Generates a temporary password and sends reset email
   * @param {string} userId - User ID
   * @returns {Promise<any>} Success response with message
   */
  async resetUserPassword(userId) {
    try {
      return await authAPI.sendSetPasswordLink(userId);
    } catch (error) {
      console.error(`Error resetting password for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * ==================== ADMIN OPERATIONS ====================
   */

  /**
   * Get current user profile
   * @returns {Promise<any>} Current user profile data
   */
  async getCurrentUserProfile() {
    try {
      const response = await this.api.get('/users/profile/me');
      return response;
    } catch (error) {
      console.error('Error fetching current user profile:', error);
      throw error;
    }
  }

  /**
   * Get all admin users (including super admins)
   * @param {Object} params - Query parameters
   * @returns {Promise<any>} Admin users list
   */
  async getAllAdmins(params = {}) {
    try {
      // Fetch admins and superAdmins separately, then combine them
      const [adminsResponse, superAdminsResponse] = await Promise.all([
        this.api.get('/users', {
          role: 'admin',
          limit: 100,
          page: 1,
          ...params
        }),
        this.api.get('/users', {
          role: 'superAdmin',
          limit: 100,
          page: 1,
          ...params
        })
      ]);

      // Combine both responses
      const adminsData = Array.isArray(adminsResponse.data) 
        ? adminsResponse.data 
        : (adminsResponse.data?.users || []);
      
      const superAdminsData = Array.isArray(superAdminsResponse.data) 
        ? superAdminsResponse.data 
        : (superAdminsResponse.data?.users || []);

      // Merge and return
      return {
        status: 'success',
        data: {
          users: [...superAdminsData, ...adminsData], // Super admins first
          // Pagination sits at the top level of the raw envelope, not nested under `data`.
          pagination: adminsResponse.pagination || { total: adminsData.length + superAdminsData.length }
        }
      };
    } catch (error) {
      console.error('Error fetching admins:', error);
      throw error;
    }
  }

  /**
   * Create new admin user
   * @param {Object} adminData - Admin data
   * @param {string} adminData.name - Admin name
   * @param {string} adminData.email - Admin email
   * @param {string} adminData.phone - Admin phone
   * @param {string} adminData.password - Temporary password
   * @param {Array<string>} adminData.permissions - Admin permissions
   * @returns {Promise<any>} Created admin
   */
  async createAdmin(adminData) {
    try {
      const response = await this.api.post('/admin/users', {
        ...adminData,
        role: 'admin'
      });
      return response;
    } catch (error) {
      console.error('Error creating admin:', error);
      throw error;
    }
  }

  /**
   * Update admin user
   * @param {string} adminId - Admin ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<any>} Updated admin
   */
  async updateAdmin(adminId, updateData) {
    try {
      const response = await this.api.put(`/admin/users/${adminId}`, updateData);
      return response;
    } catch (error) {
      console.error(`Error updating admin ${adminId}:`, error);
      throw error;
    }
  }

  /**
   * Get admin dashboard statistics
   * @returns {Promise<any>} Dashboard statistics
   */
  async getDashboardStats() {
    try {
      const response = await this.api.get('/admin/stats');
      return response;
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      throw error;
    }
  }

  /**
   * ==================== SETTINGS ====================
   */

  /**
   * Get application settings
   * @returns {Promise<any>} Settings data
   */
  async getSettings() {
    try {
      const response = await this.api.get('/admin/settings');
      return response;
    } catch (error) {
      console.error('Error fetching settings:', error);
      throw error;
    }
  }

  /**
   * Update application settings
   * @param {Object} settingsData - Settings to update
   * @returns {Promise<any>} Updated settings
   */
  async updateSettings(settingsData) {
    try {
      const response = await this.api.put('/admin/settings', settingsData);
      return response;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  /**
   * ==================== PERMISSIONS ====================
   */

  /**
   * Get available permissions list
   * @returns {Promise<any>} List of available permissions
   */
  async getAvailablePermissions() {
    try {
      const response = await this.api.get('/admin/permissions/available');
      return response;
    } catch (error) {
      console.error('Error fetching available permissions:', error);
      throw error;
    }
  }

  /**
   * Get admin user permissions
   * @param {string} adminId - Admin user ID
   * @returns {Promise<any>} Admin permissions
   */
  async getAdminPermissions(adminId) {
    try {
      const response = await this.api.get(`/admin/users/${adminId}/permissions`);
      return response;
    } catch (error) {
      console.error(`Error fetching permissions for admin ${adminId}:`, error);
      throw error;
    }
  }

  /**
   * Update admin user permissions
   * @param {string} adminId - Admin user ID
   * @param {Array<string>} permissions - Array of permission IDs
   * @returns {Promise<any>} Updated admin
   */
  async updateAdminPermissions(adminId, permissions) {
    try {
      const response = await this.api.patch(`/admin/users/${adminId}/permissions`, { permissions });
      return response;
    } catch (error) {
      console.error(`Error updating permissions for admin ${adminId}:`, error);
      throw error;
    }
  }

  /**
   * ==================== UTILITY METHODS ====================
   */

  /**
   * Generate temporary password for new users
   * @returns {string} Temporary password
   */
  generateTemporaryPassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*';

    const allChars = uppercase + lowercase + numbers + symbols;
    let password = '';

    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // Fill rest randomly to make 12 characters
    for (let i = password.length; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Format date for display
   * @param {string|Date} date - Date to format
   * @returns {string} Formatted date
   */
  formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Format datetime for display
   * @param {string|Date} date - Date to format
   * @returns {string} Formatted datetime
   */
  formatDateTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

export default new AdminService();
