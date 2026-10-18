/**
 * Centralized Branding Configuration for Management Portal
 * 
 * This file contains all company-specific branding information.
 * All values are read from Vite environment variables with sensible defaults.
 * 
 * To customize for a new customer, update the corresponding environment variables
 * in your .env or .env.local file (prefixed with VITE_).
 */

// Shipped brand fallbacks, used only when the VITE_COMPANY_* vars are unset.
// They cover company.name, app.name and pdf.company - NOT the <title> literal in
// Management/index.html (hand-edited) and not `legalName` (a separate fact).
const DEFAULT_COMPANY_NAME = 'Lush Travel Cloud';
const DEFAULT_COMPANY_SHORT_NAME = 'LTC';

const BRANDING = {
    // ==========================================
    // Company Information
    // ==========================================
    company: {
        name: import.meta.env.VITE_COMPANY_NAME || DEFAULT_COMPANY_NAME,
        shortName: import.meta.env.VITE_COMPANY_SHORT_NAME || DEFAULT_COMPANY_SHORT_NAME,
        tagline: import.meta.env.VITE_COMPANY_TAGLINE || 'Your Travel Partner',
        legalName: import.meta.env.VITE_COMPANY_LEGAL_NAME || 'LUSH Ware',
    },

    // ==========================================
    // Contact Information
    // ==========================================
    contact: {
        email: import.meta.env.VITE_COMPANY_EMAIL || 'info@example.com',
        supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com',
        phone: import.meta.env.VITE_COMPANY_PHONE || '+1-800-000-0000',
    },

    // ==========================================
    // Web & URLs
    // ==========================================
    urls: {
        website: import.meta.env.VITE_COMPANY_WEBSITE || 'https://www.example.com',
        api: import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1',
    },

    // ==========================================
    // App Configuration
    // ==========================================
    app: {
        name: import.meta.env.VITE_APP_NAME || `${DEFAULT_COMPANY_NAME} Management`,
        version: import.meta.env.VITE_APP_VERSION || '1.0.0',
    },

    // ==========================================
    // PDF Configuration (for itinerary generation)
    // ==========================================
    pdf: {
        company: import.meta.env.VITE_COMPANY_NAME || DEFAULT_COMPANY_NAME,
        tagline: import.meta.env.VITE_COMPANY_TAGLINE || 'Your Ultimate Travel Partner',
        contact: `Contact us: ${import.meta.env.VITE_COMPANY_EMAIL || 'info@example.com'} | ${import.meta.env.VITE_COMPANY_PHONE || '+1-800-000-0000'}`,
        email: import.meta.env.VITE_COMPANY_EMAIL || 'info@example.com',
        phone: import.meta.env.VITE_COMPANY_PHONE || '+1-800-000-0000',
        website: import.meta.env.VITE_COMPANY_WEBSITE || 'https://www.example.com',
    },
};

/**
 * Helper function to get the full company contact info string
 */
export const getContactInfo = () => {
    const { contact } = BRANDING;
    return `Contact us: ${contact.email} | ${contact.phone}`;
};

/**
 * Helper function to get greeting message
 */
export const getThankYouMessage = () => {
    return `Thank you for choosing ${BRANDING.company.name}!`;
};

/**
 * Get copyright text
 */
export const getCopyrightText = (year = new Date().getFullYear()) => {
    return `© ${year} ${BRANDING.company.name}. All rights reserved.`;
};

/**
 * Get sidebar display info
 */
export const getSidebarInfo = () => {
    return {
        name: BRANDING.company.name,
        shortName: BRANDING.company.shortName,
        // The shipped LUSH/WARE logo is the local fallback when no org logo is configured.
        logoUrl: '/logo.jpeg',
    };
};

/**
 * Get login page branding
 */
export const getLoginBranding = () => {
    return {
        title: BRANDING.company.name,
        subtitle: 'Management Portal',
        tagline: BRANDING.company.tagline,
    };
};

export default BRANDING;
