export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationSection = 'attention' | 'changed' | 'current_state' | 'experienced_view';
export type NotificationFact = {
  kind: 'count' | 'amount' | 'percentage' | 'duration';
  value: string;
  evidenceId?: string;
  unit?: string;
  derivation?: string;
};

export type NotificationCategory = 'revenue' | 'pipeline' | 'operations' | 'customer' | 'risk';

export type BusinessNotification = {
  id: string;
  key: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  section: NotificationSection;
  text: string;
  facts: NotificationFact[];
  materialValue: string;
  target?: { path: string; query?: Record<string, string>; label: string };
  firstSeenAt: string;
  unread: boolean;
};

export type UnreadCounts = Record<NotificationSeverity, number>;

export type NotificationSession = {
  notifications: BusinessNotification[];
  unreadCounts: UnreadCounts;
  /** The actor may see business notifications at all. */
  canView: boolean;
  scope: 'org' | 'own';
  currency: string;
  loading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  unavailableSignals: string[];
  refresh: () => void;
  markRead: (keys: string[]) => void;
  acknowledge: (notification: BusinessNotification) => void;
  dismiss: (notification: BusinessNotification) => void;
};
