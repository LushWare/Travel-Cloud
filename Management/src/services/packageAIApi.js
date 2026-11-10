/**
 * Package AI API Service
 * Frontend API service for AI package generation
 */

import apiService from './api.js';
import { API_BASE_URL, authFetch } from '../lib/authFetch';

const packageAIApi = {
  /**
   * Generate AI content from title only (no package ID needed)
   * @param {object} data - { title, destination?, duration?, category? }
   * @returns {Promise<any>} Generated content
   */
  generateFromTitle: async (data) => {
    try {
      return await apiService.post('/packages/generate-from-title', data);
    } catch (error) {
      console.error('Error in packageAIApi.generateFromTitle:', error);
      throw error;
    }
  },

  /**
   * Generate AI content for a package
   * @param {string} packageId - Package ID
   * @returns {Promise<any>} Generated content
   */
  generateContent: async (packageId) => {
    try {
      return await apiService.post(`/packages/${packageId}/generate-ai-content`);
    } catch (error) {
      console.error('Error in packageAIApi.generateContent:', error);
      throw error;
    }
  },

  /**
   * Preview AI content without saving
   * @param {string} packageId - Package ID
   * @returns {Promise<any>} Preview content
   */
  previewContent: async (packageId) => {
    return apiService.get(`/packages/${packageId}/preview-ai-content`);
  },

  /**
   * Download AI-generated PDF
   * @param {string} packageId - Package ID
   * @returns {Promise<Blob>} PDF blob
   */
  downloadPDF: async (packageId) => {
    const response = await authFetch(`${API_BASE_URL}/packages/${packageId}/ai-pdf`);

    if (!response.ok) {
      throw new Error('Failed to download PDF');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `package-ai-${packageId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};

export default packageAIApi;

