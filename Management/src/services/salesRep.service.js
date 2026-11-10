import api, { authAPI } from './api';
import { apiErrorMessage } from '../lib/apiErrorMessage';

/**
 * Sales Representative Service
 * Handles all API calls for sales rep management
 * Following industry best practices with comprehensive error handling
 */

class SalesRepService {
  constructor() {
    this.api = api;
    this.endpoint = '/sales-reps';
  }

  /**
   * ==================== SALES REP MANAGEMENT ====================
   */

  /**
   * Get all sales representatives with advanced filtering and pagination
   * @param {Object} params - Query parameters
   * @param {number} params.page - Page number (default: 1)
   * @param {number} params.limit - Items per page (default: 10, max: 100)
   * @param {string} params.sort - Sort field (e.g., '-createdAt')
   * @param {string} params.search - Search query (name, email, phone)
   * @param {boolean} params.isActive - Filter by active status
   * @param {string} params.fields - Specific fields to return
   * @returns {Promise<any>} Sales reps list with pagination info
   */
  async getAllSalesReps(params = {}) {
    try {
      const response = await this.api.get(this.endpoint, params);
      return response;
    } catch (error) {
      console.error('Error fetching sales reps:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get single sales rep by ID
   * @param {string} salesRepId - Sales rep ID (MongoDB ObjectId)
   * @returns {Promise<any>} Sales rep data
   */
  async getSalesRepById(salesRepId) {
    try {
      const response = await this.api.get(`${this.endpoint}/${salesRepId}`);
      return response;
    } catch (error) {
      console.error(`Error fetching sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Create new sales representative
   * @param {Object} salesRepData - Sales rep data
   * @param {string} salesRepData.name - Sales rep name (required)
   * @param {string} salesRepData.email - Sales rep email (required)
   * @param {string} salesRepData.phone - Sales rep phone in E.164 format (required)
   * @param {string} salesRepData.phoneCountry - Country code for phone (required)
   * @param {number} [salesRepData.commissionRate] - Commission percent, 0–100 (default 10)
   * @returns {Promise<any>} Created sales rep
   */
  async createSalesRep(salesRepData) {
    try {
      const response = await this.api.post(this.endpoint, salesRepData);
      return response;
    } catch (error) {
      console.error('Error creating sales rep:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Update sales rep details
   * @param {string} salesRepId - Sales rep ID
   * @param {Object} updateData - Data to update
   * @param {string} updateData.name - Sales rep name
   * @param {string} updateData.email - Email address
   * @param {string} updateData.phone - Phone number in E.164 format
   * @param {string} updateData.phoneCountry - Country code for phone
   * @param {number} [updateData.commissionRate] - Commission percent, 0–100
   * @returns {Promise<any>} Updated sales rep
   */
  async updateSalesRep(salesRepId, updateData) {
    try {
      const response = await this.api.put(`${this.endpoint}/${salesRepId}`, updateData);
      return response;
    } catch (error) {
      console.error(`Error updating sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Update commission rate for sales rep
   * @param {string} salesRepId - Sales rep ID
   * @param {number} commissionRate - New commission rate (0-100)
   * @returns {Promise<any>} Success response
   */
  async updateCommissionRate(salesRepId, commissionRate) {
    try {
      const response = await this.api.patch(
        `${this.endpoint}/${salesRepId}/commission`,
        { commissionRate }
      );
      return response;
    } catch (error) {
      console.error(`Error updating commission for sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Toggle sales rep active status (soft deactivate)
   * @param {string} salesRepId - Sales rep ID
   * @param {boolean} isActive - Active status
   * @returns {Promise<any>} Updated status
   */
  async toggleSalesRepStatus(salesRepId, isActive) {
    try {
      const response = await this.api.patch(
        `${this.endpoint}/${salesRepId}/toggle-status`,
        { isActive }
      );
      return response;
    } catch (error) {
      console.error(`Error toggling sales rep status ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Force password reset for sales rep
   * @param {string} salesRepId - Sales rep ID
   * @returns {Promise<any>} Success response
   */
  async resetSalesRepPassword(salesRepId) {
    try {
      return await authAPI.sendSetPasswordLink(salesRepId);
    } catch (error) {
      console.error(`Error sending password reset for sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Get sales rep statistics
   * @returns {Promise<any>} Statistics data (total, active, inactive, verified)
   */
  async getSalesRepStats() {
    try {
      const response = await this.api.get(`${this.endpoint}/stats`);
      return response;
    } catch (error) {
      console.error('Error fetching sales rep stats:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get sales rep performance metrics
   * @param {string} salesRepId - Sales rep ID
   * @returns {Promise<any>} Performance data
   */
  async getSalesRepPerformance(salesRepId) {
    try {
      const response = await this.api.get(`${this.endpoint}/${salesRepId}/performance`);
      return response;
    } catch (error) {
      console.error(`Error fetching performance for sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Delete sales rep permanently
   * @param {string} salesRepId - Sales rep ID
   * @returns {Promise<any>} Success response
   */
  async deleteSalesRep(salesRepId) {
    try {
      const response = await this.api.delete(`${this.endpoint}/${salesRepId}`);
      return response;
    } catch (error) {
      console.error(`Error deleting sales rep ${salesRepId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Get online status of all sales representatives
   * @returns {Promise<any>} Online status data
   * @returns {any} response.data.onlineStatus - Object mapping rep IDs to online status (boolean)
   * @returns {Array} response.data.onlineReps - Array of currently online reps with details
   * @returns {number} response.data.onlineCount - Count of online reps
   * @returns {number} response.data.totalCount - Total count of sales reps
   */
  async getOnlineStatus() {
    try {
      const response = await this.api.get(`${this.endpoint}/online-status`);
      return response;
    } catch (error) {
      console.error('Error fetching online status:', error);
      throw this.handleError(error);
    }
  }

  /**
   * ==================== UTILITY METHODS ====================
   */

  /**
   * Format date for display
   * @param {string|Date} date - Date to format
   * @returns {string} Formatted date
   */
  formatDate(date) {
    if (!date) return '—';
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
    if (!date) return '—';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Calculate conversion rate
   * @param {number} converted - Number of converted leads
   * @param {number} assigned - Number of assigned leads
   * @returns {string} Conversion rate percentage
   */
  calculateConversionRate(converted, assigned) {
    if (assigned === 0) return '0';
    return ((converted / assigned) * 100).toFixed(1);
  }

  /**
   * Handle API errors with user-friendly messages
   * @param {Object} error - Axios error object
   * @returns {any} Formatted error object
   */
  handleError(error) {
    const errorMessage = {
      status: 'error',
      message: 'An error occurred',
      details: null,
    };

    if (error.response) {
      // Server responded with error status
      errorMessage.status = error.response.status;
      errorMessage.message = error.response.data?.message || error.response.statusText;
      errorMessage.details = error.response.data;

      // Handle specific error codes
      switch (error.response.status) {
        case 400:
          errorMessage.userMessage = 'Invalid input. Please check your data.';
          break;
        case 401:
          errorMessage.userMessage = 'Unauthorized. Please log in again.';
          break;
        case 403:
          errorMessage.userMessage = 'You do not have permission to perform this action.';
          break;
        case 404:
          errorMessage.userMessage = 'Sales representative not found.';
          break;
        case 409:
          errorMessage.userMessage = 'This email is already in use.';
          break;
        case 500:
          errorMessage.userMessage = 'Server error. Please try again later.';
          break;
        default:
          errorMessage.userMessage = apiErrorMessage({
            data: error.response.data,
            status: error.response.status,
          });
      }
    } else if (error.request) {
      // Request made but no response received
      errorMessage.message = apiErrorMessage({ isNetworkError: true });
      errorMessage.userMessage = apiErrorMessage({ isNetworkError: true });
    } else {
      // Error in setting up request. The mapper never returns error.message.
      errorMessage.message = apiErrorMessage(error);
      errorMessage.userMessage = apiErrorMessage(error);
    }

    return errorMessage;
  }

  /**
   * Validate sales rep form data
   * @param {Object} data - Form data to validate
   * @returns {any} Validation result with errors (if any)
   */
  validateSalesRepData(data) {
    const errors = {};

    if (!data.name || data.name.trim().length === 0) {
      errors.name = 'Name is required';
    } else if (data.name.length < 2) {
      errors.name = 'Name must be at least 2 characters';
    } else if (data.name.length > 50) {
      errors.name = 'Name cannot exceed 50 characters';
    }

    if (!data.email) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      errors.email = 'Please provide a valid email address';
    }

    if (!data.phone) {
      errors.phone = 'Phone is required';
    } else if (!/^[+]?[0-9]{7,15}$/.test(data.phone.replace(/\D/g, '') === '' ? '+' + data.phone : data.phone)) {
      errors.phone = 'Phone number must be between 7-15 digits (can include + prefix)';
    }

    if (data.commissionRate !== undefined) {
      const rate = parseFloat(data.commissionRate);
      if (isNaN(rate)) {
        errors.commissionRate = 'Commission rate must be a number';
      } else if (rate < 0 || rate > 100) {
        errors.commissionRate = 'Commission rate must be between 0 and 100';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Generate mock data for development/testing
   * @returns {Array} Array of mock sales reps
   */
  generateMockData() {
    return [
      {
        id: '507f1f77bcf86cd799439011',
        name: 'Sarah Johnson',
        email: 'sarah@travelagency.com',
        phone: '+1-555-1234',
        status: 'active',
        accountStatus: 'verified',
        createdAt: '2024-01-15',
        lastActive: '2024-10-22',
        commissionRate: 10,
        leadsAssigned: 45,
        leadsConverted: 12,
        totalEarnings: 25000,
      },
      {
        id: '507f1f77bcf86cd799439012',
        name: 'Mike Chen',
        email: 'mike@travelagency.com',
        phone: '+1-555-5678',
        status: 'active',
        accountStatus: 'verified',
        createdAt: '2024-02-10',
        lastActive: '2024-10-21',
        commissionRate: 10,
        leadsAssigned: 32,
        leadsConverted: 8,
        totalEarnings: 18500,
      },
    ];
  }
}

export default new SalesRepService();




