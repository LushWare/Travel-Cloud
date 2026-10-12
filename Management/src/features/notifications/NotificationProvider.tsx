import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { actorIdOf } from './actorId';
import {
  isNotificationsAbort,
  notificationsFetch,
  notificationsSeen,
} from '@/services/notificationsAPI';
import type { BusinessNotification, NotificationSession, UnreadCounts } from './types';

export const NOTIFICATIONS_REFRESH_MS = 5 * 60_000;

const EMPTY_COUNTS: UnreadCounts = { critical: 0, warning: 0, info: 0 };

const NotificationContext = createContext<NotificationSession | undefined>(undefined);

function countsOf(notifications: BusinessNotification[]): UnreadCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const notification of notifications) {
    if (notification.unread) counts[notification.severity] += 1;
  }
  return counts;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const actorId = actorIdOf(auth?.user);
  const activeRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    notifications: BusinessNotification[];
    unreadCounts: UnreadCounts;
    scope: 'org' | 'own';
    currency: string;
    loading: boolean;
    error: string | null;
    lastLoadedAt: number | null;
    unavailableSignals: string[];
  }>({
    notifications: [],
    unreadCounts: EMPTY_COUNTS,
    scope: auth?.user?.role === 'salesRep' ? 'own' : 'org',
    currency: 'USD',
    loading: false,
    error: null,
    lastLoadedAt: null,
    unavailableSignals: [],
  });

  const refresh = useCallback(() => {
    if (!actorId) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState((current) => ({ ...current, loading: true, error: null }));

    void notificationsFetch({ signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const data = response?.data;
        setState({
          notifications: Array.isArray(data?.notifications) ? data.notifications : [],
          unreadCounts: data?.unreadCounts ?? EMPTY_COUNTS,
          scope: data?.scope === 'own' ? 'own' : 'org',
          currency: data?.currency || 'USD',
          loading: false,
          error: null,
          lastLoadedAt: Date.now(),
          unavailableSignals: Array.isArray(data?.unavailableSignals) ? data.unavailableSignals : [],
        });
      })
      .catch((error) => {
        if (isNotificationsAbort(error)) return;
        if (error?.status === 404) {
          setState((current) => ({
            ...current,
            notifications: [],
            unreadCounts: EMPTY_COUNTS,
            loading: false,
            error: null,
            lastLoadedAt: Date.now(),
          }));
          return;
        }
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Notifications could not be loaded.',
        }));
      });
  }, [actorId]);

  useEffect(() => {
    if (!actorId) {
      activeRequest.current?.abort();
      setState((current) => ({
        ...current,
        notifications: [],
        unreadCounts: EMPTY_COUNTS,
        loading: false,
        error: null,
        lastLoadedAt: null,
      }));
      return undefined;
    }
    refresh();
    return () => activeRequest.current?.abort();
  }, [actorId, refresh]);

  useEffect(() => {
    if (!actorId) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, NOTIFICATIONS_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [actorId, refresh]);

  const sendLifecycle = useCallback((keys: string[], action: 'read' | 'acknowledge' | 'dismiss') => {
    if (!actorId || keys.length === 0) return;
    void notificationsSeen({ keys, action }).catch((error) => {
      if (!isNotificationsAbort(error)) refresh();
    });
  }, [actorId, refresh]);

  const markRead = useCallback((keys: string[]) => {
    const keySet = new Set(keys);
    if (keySet.size === 0) return;
    setState((current) => {
      const notifications = current.notifications.map((notification) =>
        keySet.has(notification.key) ? { ...notification, unread: false } : notification,
      );
      return { ...current, notifications, unreadCounts: countsOf(notifications) };
    });
    sendLifecycle([...keySet], 'read');
  }, [sendLifecycle]);

  const remove = useCallback((notification: BusinessNotification, action: 'acknowledge' | 'dismiss') => {
    setState((current) => {
      const notifications = current.notifications.filter((candidate) => candidate.key !== notification.key);
      return { ...current, notifications, unreadCounts: countsOf(notifications) };
    });
    sendLifecycle([notification.key], action);
  }, [sendLifecycle]);

  const acknowledge = useCallback((notification: BusinessNotification) => remove(notification, 'acknowledge'), [remove]);
  const dismiss = useCallback((notification: BusinessNotification) => remove(notification, 'dismiss'), [remove]);

  const role = auth?.user?.role;
  const canView = Boolean(actorId) && (
    auth?.user?.isSuperAdmin === true
    || role === 'superAdmin'
    || role === 'admin'
    || role === 'salesRep'
  );

  const value = useMemo<NotificationSession>(() => ({
    ...state,
    canView,
    refresh,
    markRead,
    acknowledge,
    dismiss,
  }), [acknowledge, canView, dismiss, markRead, refresh, state]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationSession {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}

/**
 * Same context, without the provider requirement — the `useOptionalAuth`
 * precedent, for chrome that must still render outside the provider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalNotifications(): NotificationSession | null {
  return useContext(NotificationContext) ?? null;
}
