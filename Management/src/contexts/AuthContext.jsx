import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import toast from '@/lib/toast';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

const AuthContext = createContext();
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'lastActivity';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

  // Initialize auth from localStorage
  useEffect(() => {
    const initializeAuth = () => {
      const savedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
      const savedUser = localStorage.getItem('user') || sessionStorage.getItem('user');
      const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY) || sessionStorage.getItem(LAST_ACTIVITY_KEY);

      if (savedToken) {
        const now = Date.now();
        if (lastActivity && now - Number(lastActivity) > INACTIVITY_LIMIT_MS) {
          // Session expired due to inactivity
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          localStorage.removeItem(LAST_ACTIVITY_KEY);
          sessionStorage.removeItem('token');
          sessionStorage.removeItem('user');
          sessionStorage.removeItem(LAST_ACTIVITY_KEY);
        } else {
          setToken(savedToken);
          if (savedUser) {
            setUser(JSON.parse(savedUser));
          }
          setIsAuthenticated(true);
          axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
        }
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  // Login function
  const login = useCallback(
    async (email, password) => {
      try {
        setLoading(true);
        const response = await axios.post(`${API_URL}/auth/login`, {
          email,
          password,
        });

        // Check if OTP is required (for sales representatives)
        if (response.data.data?.requiresOTP) {
          // Store temporary data for OTP verification
          localStorage.setItem('otpTempToken', response.data.data.tempToken);
          localStorage.setItem('otpMaskedEmail', response.data.data.maskedEmail);
          toast.success('OTP sent to your email. Please verify to continue.');
          return 'otp-required';
        }

        // Check if password change is required (for first-time login with temporary password)
        if (response.data.data?.mustChangePassword) {
          // Store temporary credentials for password reset
          localStorage.setItem('resetEmail', email);
          localStorage.setItem('tempPassword', password);
          toast.success('🔐 Please set your new password');
          return 'password-reset-required';
        }

        const { token: authToken, user: userData } = response.data.data;

        // Save to localStorage
        localStorage.setItem('token', authToken);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
        sessionStorage.setItem('token', authToken);
        sessionStorage.setItem('user', JSON.stringify(userData));
        sessionStorage.setItem(LAST_ACTIVITY_KEY, localStorage.getItem(LAST_ACTIVITY_KEY));

        // Update state
        setToken(authToken);
        setUser(userData);
        setIsAuthenticated(true);

        // Set default authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

        return true;
      } catch (error) {
        const errorMessage = apiErrorMessage({ data: error.response?.data, status: error.response?.status });
        toast.error(errorMessage);
        console.error('Login error:', error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API_URL]
  );

  // Logout function
  const logout = useCallback(async (opts = {}) => {
    if (token) {
      try {
        axios.post(`${API_URL}/auth/logout`).catch((error) => {
          if (error.response?.status === 401) {
            console.warn('Token already expired or invalid, skipping server logout');
          } else {
            console.error('Logout error:', error);
          }
        });
      } catch (error) {
        console.error('Logout error:', error);
      }

    }
    // Clear local state immediately; server logout must not keep the UI authenticated.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);

    setToken(null);
    setUser(null);
    setIsAuthenticated(false);

    delete axios.defaults.headers.common['Authorization'];
    const { silent = false } = opts || {};
    if (!silent) {
      toast.success('Logged out successfully');
    }
  }, [API_URL, token]);

  const inactivityTimerRef = useRef(null);

  useEffect(() => {
    const getLastActivity = () => {
      const storedValue = localStorage.getItem(LAST_ACTIVITY_KEY) || sessionStorage.getItem(LAST_ACTIVITY_KEY);
      const timestamp = Number(storedValue);
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
    };

    const resetTimer = (lastActivityAt = Date.now()) => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      const remainingTime = INACTIVITY_LIMIT_MS - (Date.now() - lastActivityAt);
      if (remainingTime <= 0) {
        logout({ silent: true });
        return;
      }
      inactivityTimerRef.current = setTimeout(() => {
        try {
          toast('You have been logged out due to inactivity');
        } catch (e) {
        }
        logout({ silent: true });
      }, remainingTime);
    };

    const updateLastActivity = () => {
      const now = Date.now();
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
        sessionStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
      } catch (e) {
      }
      resetTimer(now);
    };

    const checkLastActivity = () => {
      const lastActivityAt = getLastActivity();
      if (lastActivityAt === null) {
        updateLastActivity();
      } else {
        resetTimer(lastActivityAt);
      }
    };

    const storageListener = (event) => {
      if (event.key === 'token' && !event.newValue) {
        logout({ silent: true });
      } else if (event.key === LAST_ACTIVITY_KEY) {
        checkLastActivity();
      }
    };

    if (isAuthenticated) {
      checkLastActivity();
      const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
      events.forEach((ev) => window.addEventListener(ev, updateLastActivity));
      document.addEventListener('visibilitychange', checkLastActivity);
      window.addEventListener('focus', checkLastActivity);
      window.addEventListener('storage', storageListener);
    }

    return () => {
      const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
      events.forEach((ev) => window.removeEventListener(ev, updateLastActivity));
      document.removeEventListener('visibilitychange', checkLastActivity);
      window.removeEventListener('focus', checkLastActivity);
      window.removeEventListener('storage', storageListener);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [isAuthenticated, logout]);

  // Update profile function
  const updateProfile = useCallback(
    async (profileData) => {
      try {
        setLoading(true);
        const response = await axios.put(`${API_URL}/auth/profile`, profileData);

        const updatedUser = response.data.data.user;
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setUser(updatedUser);

        toast.success('Profile updated successfully');
        return true;
      } catch (error) {
        const errorMessage = apiErrorMessage({ data: error.response?.data, status: error.response?.status });
        toast.error(errorMessage);
        console.error('Update profile error:', error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API_URL]
  );

  // Change password function
  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      try {
        setLoading(true);
        await axios.put(`${API_URL}/auth/change-password`, {
          currentPassword,
          newPassword,
          confirmPassword: newPassword,
        });

        toast.success('Password changed successfully');
        return true;
      } catch (error) {
        const errorMessage = apiErrorMessage({ data: error.response?.data, status: error.response?.status });
        toast.error(errorMessage);
        console.error('Change password error:', error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API_URL]
  );

  // Verify if user has a specific role
  const hasRole = useCallback((requiredRole) => {
    if (!user) return false;
    if (Array.isArray(requiredRole)) {
      return requiredRole.includes(user.role);
    }
    return user.role === requiredRole;
  }, [user]);

  const value = React.useMemo(() => ({
    user,
    loading,
    isAuthenticated,
    token,
    login,
    logout,
    updateProfile,
    changePassword,
    hasRole,
  }), [user, loading, isAuthenticated, token, login, logout, updateProfile, changePassword, hasRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Same context, without the provider requirement. Used by chrome that must
// still render (in its unauthenticated, non-persisting form) outside a
// provider — e.g. the copilot shell keying its stored preferences on the
// authenticated operator's stable internal id.
export const useOptionalAuth = () => useContext(AuthContext) || null;
