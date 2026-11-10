import api, { authAPI } from './api';
import { apiErrorMessage } from '../lib/apiErrorMessage';

/**
 * Vendor Service
 * Handles all API calls for vendor management
 * Following industry best practices with comprehensive error handling
 * 
 * Matches backend 12 operations:
 * 1. getAllVendors - Get all vendors with filtering/pagination
 * 2. getVendorById - Get single vendor
 * 3. createVendor - Create new vendor
 * 4. updateVendor - Update vendor details
 * 5. updateVendorStatus - Update verification status
 * 6. updateVendorRating - Update rating
 * 7. toggleVendorStatus - Toggle active/inactive
 * 8. resetVendorPassword - Force password reset
 * 9. getVendorStats - Dashboard statistics
 * 10. getVendorsByServiceType - Filter by service type
 * 11. getVendorPerformance - Performance metrics
 * 12. deleteVendor - Permanent deletion
 */

class VendorService {
  constructor() {
    this.api = api;
    this.endpoint = '/vendors';
  }

  /**
   * ==================== VENDOR MANAGEMENT ====================
   */

  /**
   * Get all vendors with advanced filtering and pagination
   * @param {Object} params - Query parameters
   * @param {number} params.page - Page number (default: 1)
   * @param {number} params.limit - Items per page (default: 10, max: 100)
   * @param {string} params.sort - Sort field (e.g., '-createdAt', 'rating')
   * @param {string} params.search - Search query (name, email, phone, location)
   * @param {string} params.serviceType - Filter by service type
   * @param {string} params.vendorStatus - Filter by verification status (pending_verification, verified, suspended, rejected)
   * @param {string} params.isActive - Filter by active status (true/false)
   * @returns {Promise<any>} Vendors list with pagination info
   */
  async getAllVendors(params = {}) {
    try {
      const response = await this.api.get(this.endpoint, params);
      return response;
    } catch (error) {
      console.error('Error fetching vendors:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get single vendor by ID
   * @param {string} vendorId - Vendor ID (MongoDB ObjectId)
   * @returns {Promise<any>} Vendor data with full details
   */
  async getVendorById(vendorId) {
    try {
      const response = await this.api.get(`${this.endpoint}/${vendorId}`);
      return response;
    } catch (error) {
      console.error(`Error fetching vendor ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Create new vendor
   * @param {Object} vendorData - Vendor data
   * @param {string} vendorData.name - User name (required)
   * @param {string} vendorData.email - Email (required)
   * @param {string} vendorData.phone - Phone (required)
   * @param {string} vendorData.businessName - Business name (required)
   * @param {string} vendorData.serviceType - Service type: hotel, transport, activity, restaurant, guide, other (required)
   * @param {string} vendorData.businessRegistrationNumber - Registration number (required)
   * @param {string} vendorData.taxIdentificationNumber - Tax ID (required)
   * @param {Object} vendorData.address - Address object (required)
   * @param {string} vendorData.address.street - Street address
   * @param {string} vendorData.address.city - City
   * @param {string} vendorData.address.state - State
   * @param {string} vendorData.address.zipCode - ZIP code
   * @param {string} vendorData.address.country - Country
   * @param {Object} vendorData.contactPerson - Contact person (required)
   * @param {string} vendorData.contactPerson.name - Contact name
   * @param {string} vendorData.contactPerson.phone - Contact phone
   * @param {string} vendorData.contactPerson.email - Contact email
   * @param {string} vendorData.contactPerson.designation - Contact designation
   * @param {Object} vendorData.bankDetails - Bank details (required)
   * @param {string} vendorData.bankDetails.accountName - Account name
   * @param {string} vendorData.bankDetails.accountNumber - Account number
   * @param {string} vendorData.bankDetails.bankName - Bank name
   * @param {string} vendorData.bankDetails.branchName - Branch name
   * @param {string} vendorData.bankDetails.ifscCode - IFSC code
   * @param {string} vendorData.bankDetails.swiftCode - SWIFT code (international)
   * @returns {Promise<any>} Created vendor with temporary password
   */
  async createVendor(vendorData) {
    try {
      // Clean the data to remove empty strings from nested objects
      const cleanedData = this.cleanVendorData(vendorData);
      console.log('Creating vendor with data:', cleanedData);
      const response = await this.api.post(this.endpoint, cleanedData);
      return response;
    } catch (error) {
      console.error('Error creating vendor:', error);
      console.error('Error response data:', error.response?.data);
      throw this.handleError(error);
    }
  }

  /**
   * Update vendor details
   * @param {string} vendorId - Vendor ID
   * @param {Object} updateData - Data to update (all fields optional)
   * @param {string} updateData.businessName - Business name
   * @param {string} updateData.serviceType - Service type
   * @param {string} updateData.businessRegistrationNumber - Registration number
   * @param {string} updateData.taxIdentificationNumber - Tax ID
   * @param {Object} updateData.address - Address object
   * @param {Object} updateData.contactPerson - Contact person object
   * @param {Object} updateData.bankDetails - Bank details object
   * @returns {Promise<any>} Updated vendor
   */
  async updateVendor(vendorId, updateData) {
    try {
      // Clean the data to remove empty strings from nested objects
      const cleanedData = this.cleanVendorData(updateData);
      const response = await this.api.put(`${this.endpoint}/${vendorId}`, cleanedData);
      return response;
    } catch (error) {
      console.error(`Error updating vendor ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Update vendor verification status
   * @param {string} vendorId - Vendor ID
   * @param {string} vendorStatus - New status: pending_verification, verified, suspended, rejected
   * @param {string} reason - Optional reason for status change (especially for rejection/suspension)
   * @returns {Promise<any>} Success response with email notification
   */
  async updateVendorStatus(vendorId, vendorStatus, reason = '') {
    try {
      const response = await this.api.patch(
        `${this.endpoint}/${vendorId}/status`,
        { vendorStatus, reason }
      );
      return response;
    } catch (error) {
      console.error(`Error updating vendor status ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Update vendor rating
   * @param {string} vendorId - Vendor ID
   * @param {number} rating - Rating value (0-5)
   * @param {string} feedback - Optional feedback
   * @returns {Promise<any>} Success response
   */
  async updateVendorRating(vendorId, rating, feedback = '') {
    try {
      const response = await this.api.patch(
        `${this.endpoint}/${vendorId}/rating`,
        { rating, feedback }
      );
      return response;
    } catch (error) {
      console.error(`Error updating vendor rating ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Toggle vendor active/inactive status (soft deactivate)
   * @param {string} vendorId - Vendor ID
   * @param {boolean} isActive - Active status
   * @returns {Promise<any>} Updated status
   */
  async toggleVendorStatus(vendorId, isActive) {
    try {
      const response = await this.api.patch(
        `${this.endpoint}/${vendorId}/toggle-status`,
        { isActive }
      );
      return response;
    } catch (error) {
      console.error(`Error toggling vendor status ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Force password reset for vendor
   * @param {string} vendorId - Vendor ID
   * @returns {Promise<any>} Success response with email notification
   */
  async resetVendorPassword(vendorId) {
    try {
      return await authAPI.sendSetPasswordLink(vendorId);
    } catch (error) {
      console.error(`Error sending password reset for vendor ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Get vendor statistics for dashboard
   * @returns {Promise<any>} Statistics data
   */
  async getVendorStats() {
    try {
      const response = await this.api.get(`${this.endpoint}/stats`);
      return response;
    } catch (error) {
      console.error('Error fetching vendor stats:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get vendors by service type
   * @param {string} serviceType - Service type: hotel, transport, activity, restaurant, guide, other
   * @param {Object} params - Additional query parameters (page, limit, sort, search)
   * @returns {Promise<any>} Filtered vendors
   */
  async getVendorsByServiceType(serviceType, params = {}) {
    try {
      const response = await this.api.get(
        `${this.endpoint}/by-service/${serviceType}`,
        params
      );
      return response;
    } catch (error) {
      console.error(`Error fetching vendors by service type ${serviceType}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Get vendor performance metrics
   * @param {string} vendorId - Vendor ID
   * @returns {Promise<any>} Performance data (bookings, ratings, reviews, earnings)
   */
  async getVendorPerformance(vendorId) {
    try {
      const response = await this.api.get(`${this.endpoint}/${vendorId}/performance`);
      return response;
    } catch (error) {
      console.error(`Error fetching performance for vendor ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * Delete vendor permanently
   * @param {string} vendorId - Vendor ID
   * @returns {Promise<any>} Success response
   */
  async deleteVendor(vendorId) {
    try {
      const response = await this.api.delete(`${this.endpoint}/${vendorId}`);
      return response;
    } catch (error) {
      console.error(`Error deleting vendor ${vendorId}:`, error);
      throw this.handleError(error);
    }
  }

  /**
   * ==================== UTILITY METHODS ====================
   */

  /**
   * Clean vendor data by removing empty strings from nested objects
   * Joi validator doesn't allow empty strings in optional fields
   * @param {Object} data - Vendor data to clean
   * @returns {any} Cleaned vendor data
   */
  cleanVendorData(data) {
    const cleaned = { ...data };

    // Helper function to remove empty string properties from an object
    const removeEmptyStrings = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      
      const result = {};
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        // Only include non-empty strings or non-string values
        if (value !== '' && value !== null && value !== undefined) {
          result[key] = value;
        }
      });
      
      // Return undefined if object is empty, so it can be omitted
      return Object.keys(result).length > 0 ? result : undefined;
    };

    // Clean nested objects
    if (cleaned.address) {
      const cleanedAddress = removeEmptyStrings(cleaned.address);
      if (cleanedAddress) {
        cleaned.address = cleanedAddress;
      } else {
        delete cleaned.address;
      }
    }

    if (cleaned.contactPerson) {
      const cleanedContactPerson = removeEmptyStrings(cleaned.contactPerson);
      if (cleanedContactPerson) {
        cleaned.contactPerson = cleanedContactPerson;
      } else {
        delete cleaned.contactPerson;
      }
    }

    if (cleaned.bankDetails) {
      const cleanedBankDetails = removeEmptyStrings(cleaned.bankDetails);
      if (cleanedBankDetails) {
        cleaned.bankDetails = cleanedBankDetails;
      } else {
        delete cleaned.bankDetails;
      }
    }

    // Also remove empty strings from top-level fields
    Object.keys(cleaned).forEach(key => {
      if (cleaned[key] === '') {
        delete cleaned[key];
      }
    });

    return cleaned;
  }

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
   * Get status label for display
   * @param {string} status - Status value
   * @returns {string} Formatted status label
   */
  getStatusLabel(status) {
    const labels = {
      pending_verification: 'Pending Verification',
      verified: 'Verified',
      suspended: 'Suspended',
      rejected: 'Rejected'
    };
    return labels[status] || status;
  }

  /**
   * Get service type label for display
   * @param {string} serviceType - Service type value
   * @returns {string} Formatted service type label
   */
  getServiceTypeLabel(serviceType) {
    const labels = {
      hotel: 'Hotel',
      transport: 'Transportation',
      activity: 'Activity',
      restaurant: 'Restaurant',
      guide: 'Tour Guide',
      other: 'Other'
    };
    return labels[serviceType] || serviceType;
  }

  /**
   * Format rating with stars
   * @param {number} rating - Rating value (0-5)
   * @returns {string} Formatted rating with stars
   */
  formatRating(rating) {
    if (!rating || rating === 0) return 'Not Rated';
    const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));
    return `${stars} ${rating.toFixed(1)}`;
  }

  /**
   * Calculate days since creation
   * @param {string|Date} createdAt - Creation date
   * @returns {number} Days since creation
   */
  calculateDaysSinceCreation(createdAt) {
    if (!createdAt) return 0;
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now - created);
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Handle API errors with user-friendly messages
   * @param {Object} error - Axios/Fetch error object
   * @returns {any} Formatted error object
   */
  handleError(error) {
    const errorMessage = {
      status: 'error',
      message: 'An error occurred',
      details: null,
    };

    // Check if error has data property (from ApiService)
    if (error.data) {
      errorMessage.status = error.status || 'error';
      errorMessage.message = apiErrorMessage({ data: error.data, status: error.status });
      errorMessage.details = error.data;

      // Handle specific error codes
      switch (error.status) {
        case 400:
          // Extract validation errors - check multiple possible formats
          if (error.data.errors && Array.isArray(error.data.errors)) {
            // Backend format: { errors: [{ field, message }] }
            const validationErrors = {};
            error.data.errors.forEach(err => {
              validationErrors[err.field] = err.message;
            });
            const errorList = error.data.errors
              .map(err => `${err.field}: ${err.message}`)
              .join('\n');
            errorMessage.userMessage = `Validation errors:\n${errorList}`;
            errorMessage.validationErrors = validationErrors;
          } else if (error.data?.details?.validation) {
            // Alternative format: { details: { validation: { field: [messages] } } }
            const validationErrors = error.data.details.validation;
            const errorList = Object.entries(validationErrors)
              .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
              .join('\n');
            errorMessage.userMessage = `Validation errors:\n${errorList}`;
            errorMessage.validationErrors = validationErrors;
          } else if (error.data?.details?.errors && Array.isArray(error.data.details.errors)) {
            const errorList = error.data.details.errors
              .map(err => `${err.field}: ${err.message}`)
              .join('\n');
            errorMessage.userMessage = `Validation errors:\n${errorList}`;
          } else if (error.data?.details?.message) {
            errorMessage.userMessage = error.data.details.message;
          } else {
            errorMessage.userMessage = apiErrorMessage({ data: error.data, status: error.status });
          }
          break;
        case 401:
          errorMessage.userMessage = 'Unauthorized. Please log in again.';
          break;
        case 403:
          errorMessage.userMessage = 'You do not have permission to perform this action.';
          break;
        case 404:
          errorMessage.userMessage = 'Vendor not found.';
          break;
        case 409:
          errorMessage.userMessage = 'This email or registration number is already in use.';
          break;
        case 500:
          errorMessage.userMessage = 'Server error. Please try again later.';
          break;
        default:
          errorMessage.userMessage = apiErrorMessage({ data: error.data, status: error.status });
      }
    } else if (error.message) {
      // Thrown by ApiService or the network layer. The mapper never returns
      // error.message — that is where fetch and axios put their own strings.
      errorMessage.message = apiErrorMessage(error);
      errorMessage.userMessage = apiErrorMessage(error);
    } else {
      // Unknown error format
      errorMessage.message = 'Unknown error occurred';
      errorMessage.userMessage = 'An unexpected error occurred.';
    }

    return errorMessage;
  }

  /**
   * Validate vendor form data
   * @param {Object} data - Form data to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @returns {any} Validation result with errors (if any)
   */
  validateVendorData(data, isUpdate = false) {
    const errors = {};

    // Name validation
    if (!isUpdate || data.name !== undefined) {
      if (!data.name || data.name.trim().length === 0) {
        errors.name = 'Name is required';
      } else if (data.name.length < 2) {
        errors.name = 'Name must be at least 2 characters';
      } else if (data.name.length > 100) {
        errors.name = 'Name cannot exceed 100 characters';
      }
    }

    // Email validation
    if (!isUpdate || data.email !== undefined) {
      if (!data.email) {
        errors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.email = 'Please provide a valid email address';
      }
    }

    // Phone validation
    if (!isUpdate || data.phone !== undefined) {
      if (!data.phone) {
        errors.phone = 'Phone is required';
      } else {
        // Extract only digits from phone number
        const digitsOnly = data.phone.replace(/\D/g, '');
        if (digitsOnly.length < 7 || digitsOnly.length > 15) {
          errors.phone = 'Phone number must be between 7-15 digits (can include +, spaces, (), or - separators)';
        }
      }
    }

    // Business Name validation
    if (!isUpdate || data.businessName !== undefined) {
      if (!data.businessName || data.businessName.trim().length === 0) {
        errors.businessName = 'Business name is required';
      } else if (data.businessName.length < 2) {
        errors.businessName = 'Business name must be at least 2 characters';
      }
    }

    // Service Type validation
    if (!isUpdate || data.serviceType !== undefined) {
      const validTypes = ['hotel', 'transport', 'activity', 'restaurant', 'guide', 'other'];
      if (!data.serviceType) {
        errors.serviceType = 'Service type is required';
      } else if (!validTypes.includes(data.serviceType)) {
        errors.serviceType = 'Invalid service type';
      }
    }

    // Registration Number validation
    if (!isUpdate || data.businessRegistrationNumber !== undefined) {
      if (!data.businessRegistrationNumber || data.businessRegistrationNumber.trim().length === 0) {
        errors.businessRegistrationNumber = 'Business registration number is required';
      }
    }

    // Tax ID validation
    if (!isUpdate || data.taxIdentificationNumber !== undefined) {
      if (!data.taxIdentificationNumber || data.taxIdentificationNumber.trim().length === 0) {
        errors.taxIdentificationNumber = 'Tax identification number is required';
      }
    }

    // Rating validation
    if (data.rating !== undefined) {
      const rating = parseFloat(data.rating);
      if (isNaN(rating)) {
        errors.rating = 'Rating must be a number';
      } else if (rating < 0 || rating > 5) {
        errors.rating = 'Rating must be between 0 and 5';
      }
    }

    // Status validation
    if (data.vendorStatus !== undefined) {
      const validStatuses = ['pending_verification', 'verified', 'suspended', 'rejected'];
      if (!validStatuses.includes(data.vendorStatus)) {
        errors.vendorStatus = 'Invalid vendor status';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Generate mock data for development/testing
   * @returns {Array} Array of mock vendors
   */
  generateMockData() {
    return [
      {
        id: '507f1f77bcf86cd799439011',
        name: 'Ahmed Hassan',
        email: 'contact@paradiseresort.com',
        phone: '+1-555-1111',
        businessName: 'Paradise Resort',
        serviceType: 'hotel',
        vendorStatus: 'verified',
        accountStatus: 'verified',
        createdAt: '2024-02-01',
        rating: 4.8,
        totalBookings: 245,
        location: 'Maldives',
        contactPerson: { name: 'Ahmed Hassan', phone: '+1-555-1111' }
      },
      {
        id: '507f1f77bcf86cd799439012',
        name: 'Maria Garcia',
        email: 'biz@cityhotel.com',
        phone: '+1-555-2222',
        businessName: 'City Hotel Chain',
        serviceType: 'hotel',
        vendorStatus: 'verified',
        accountStatus: 'verified',
        createdAt: '2024-01-15',
        rating: 4.5,
        totalBookings: 189,
        location: 'Multiple Cities',
        contactPerson: { name: 'Maria Garcia', phone: '+1-555-2222' }
      },
      {
        id: '507f1f77bcf86cd799439013',
        name: 'Raj Patel',
        email: 'info@adventuretours.com',
        phone: '+1-555-3333',
        businessName: 'Adventure Tours Co',
        serviceType: 'activity',
        vendorStatus: 'pending_verification',
        accountStatus: 'pending_first_login',
        createdAt: '2024-10-01',
        rating: 0,
        totalBookings: 0,
        location: 'Nepal',
        contactPerson: { name: 'Raj Patel', phone: '+1-555-3333' }
      }
    ];
  }
}

export default new VendorService();
