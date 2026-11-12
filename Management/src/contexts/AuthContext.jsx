import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import toast from '@/lib/toast';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { API_BASE_URL, helpSessionUser, refreshSession, SESSION_EXPIRED_EVENT } from '@/lib/authFetch';
import { setPendingPasswordReset } from '@/lib/pendingPasswordReset';
import { nextStepAfterSignIn } from '@/lib/pendingTenantChoice';

const AuthContext = createContext();
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'lastActivity';

// The login itself lives in an httpOnly cookie; the browser only keeps the non-secret profile.
const clearStoredSession = () => {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of ['token', 'user', LAST_ACTIVITY_KEY]) store.removeItem(key);
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const API_URL = API_BASE_URL;

  const setAuth = useCallback((userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    setUser(userData);
    setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeAuth = async () => {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');

      const savedUser = localStorage.getItem('user');
      const hasSavedUser = Boolean(savedUser);
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      const inactive = lastActivity > 0 && Date.now() - lastActivity > INACTIVITY_LIMIT_MS;

      // Arriving from the console's help link (?help=1), or reloading during that help session.
      const helpExpected = new URLSearchParams(window.location.search).has('help')
        || (hasSavedUser && savedUser.includes('"helpAccess"'));
      let freshUser = hasSavedUser && !inactive ? await refreshSession() : null;
      if (!freshUser && helpExpected) freshUser = await helpSessionUser();
      if (!cancelled && freshUser?.helpAccess && window.location.search.includes('help=')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      if (cancelled) return;
      if (freshUser) {
        localStorage.setItem('user', JSON.stringify(freshUser));
        if (freshUser.helpAccess) localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
        setUser(freshUser);
        setIsAuthenticated(true);
      } else {
        clearStoredSession();
      }
      setLoading(false);
    };

    initializeAuth();
    return () => {
      cancelled = true;
    };
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
          setPendingPasswordReset(email, password);
          toast.success('🔐 Please set your new password');
          return 'password-reset-required';
        }

        return nextStepAfterSignIn(response.data.data, setAuth) === 'choose-agency' ? 'tenant-choice-required' : true;
      } catch (error) {
        const errorMessage = apiErrorMessage({ data: error.response?.data, status: error.response?.status });
        toast.error(errorMessage);
        console.error('Login error:', error);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [API_URL, setAuth]
  );

  const logout = useCallback(async (opts = {}) => {
    axios.post(`${API_URL}/auth/logout`).catch((error) => {
      console.error('Logout error:', error);
    });
    // Clear local state immediately; server logout must not keep the UI authenticated.
    clearStoredSession();
    setUser(null);
    setIsAuthenticated(false);

    const { silent = false } = opts || {};
    if (!silent) {
      toast.success('Logged out successfully');
    }
  }, [API_URL]);

  useEffect(() => {
    const onExpired = () => {
      toast.error('Your session has expired. Please sign in again.');
      logout({ silent: true });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [logout]);

  const inactivityTimerRef = useRef(null);

  useEffect(() => {
    const getLastActivity = () => {
      const storedValue = localStorage.getItem(LAST_ACTIVITY_KEY);
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
      if (event.key === 'user' && !event.newValue) {
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
    login,
    logout,
    setAuth,
    updateProfile,
    changePassword,
    hasRole,
  }), [user, loading, isAuthenticated, login, logout, setAuth, updateProfile, changePassword, hasRole]);

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
