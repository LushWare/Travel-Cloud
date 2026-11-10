import api from './api';

const authService = {
  // Login user
  login: async (email, password) => {
    return api.post('/auth/login', { email, password });
  },

  // Logout
  logout: async () => {
    await api.post('/auth/logout', {}).catch(() => {});
    localStorage.removeItem('user');
  },

  // Get current user
  getMe: async () => {
    return api.get('/auth/me');
  },

  // Change password (for authenticated users)
  changePassword: async (currentPassword, newPassword, confirmPassword) => {
    return api.put('/auth/change-password', {
      currentPassword,
      newPassword,
      confirmPassword,
    });
  },

  // Reset password using temporary credentials
  resetPassword: async (data) => {
    return api.post('/auth/reset-temp-password', {
      email: data.email,
      currentPassword: data.currentPassword, // temporary password
      newPassword: data.newPassword,
      confirmPassword: data.confirmPassword,
    });
  },

  // Forgot password (initiate reset flow)
  forgotPassword: async (email) => {
    return api.post('/auth/forgot-password', { email });
  },

  // Check if user is authenticated
  isAuthenticated: () => {
    return !!localStorage.getItem('user');
  },

  // Get stored user data
  getStoredUser: () => {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  // Store user data
  storeUser: (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
  },
};

export default authService;
