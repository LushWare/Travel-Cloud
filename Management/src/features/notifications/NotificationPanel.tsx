import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from '@/components/ui/popover';
import { LiveStatus, useAnnouncer } from './Announcer';
import { cn } from '@/lib/utils';
import { useNotifications } from './NotificationProvider';
import NotificationRow from './NotificationRow';
import { toNotificationUrl } from './target';
import type { BusinessNotification, NotificationCategory } from './types';

const CATEGORY_ORDER: NotificationCategory[] = ['revenue', 'pipeline', 'operations', 'customer', 'risk'];
const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  revenue: 'Revenue',
  pipeline: 'Pipeline',
  operations: 'Operations',
  customer: 'Customer opportunity',
  risk: 'Business risk',
};

type NotificationPanelProps = {
  open: boolean;
  onClose: () => void;
};

export default function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const navigate = useNavigate();
  const session = useNotifications();
  const [showInfo, setShowInfo] = useState(false);
  const [announcement, announce] = useAnnouncer();

  const primary = useMemo(
    () => session.notifications.filter((notification) => notification.severity !== 'info'),
    [session.notifications],
  );
  const info = useMemo(
    () => session.notifications.filter((notification) => notification.severity === 'info'),
    [session.notifications],
  );
  const visible = showInfo ? [...primary, ...info] : primary;
  const unreadVisibleKey = visible
    .filter((notification) => notification.unread)
    .map((notification) => notification.key)
    .join('|');

  useEffect(() => {
    if (!open || !unreadVisibleKey) return;
    session.markRead(unreadVisibleKey.split('|'));
  }, [open, session, unreadVisibleKey]);

  const grouped = (notifications: BusinessNotification[]) => {
    const groups: Partial<Record<NotificationCategory, BusinessNotification[]>> = {};
    for (const notification of notifications) {
      (groups[notification.category] ??= []).push(notification);
    }
    return groups;
  };

  const renderGroups = (notifications: BusinessNotification[]) => {
    const groups = grouped(notifications);
    return CATEGORY_ORDER.map((category) => {
      const rows = groups[category];
      if (!rows?.length) return null;
      return (
        <section key={category} aria-labelledby={`notification-${category}`} className="space-y-2.5">
          <h3
            id={`notification-${category}`}
            className="px-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {CATEGORY_LABEL[category]}
          </h3>
          <div className="space-y-3">
            {rows.map((notification) => (
              <NotificationRow
                key={notification.key}
                notification={notification}
                announce={announce}
                onView={handleView}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </section>
      );
    });
  };

  const handleView = (notification: BusinessNotification) => {
    if (!notification.target) return;
    session.acknowledge(notification);
    onClose();
    navigate(toNotificationUrl(notification.target));
  };

  const handleDismiss = (notification: BusinessNotification) => {
    session.dismiss(notification);
    announce('Notification dismissed');
  };

  const markAllRead = () => {
    const keys = session.notifications.filter((notification) => notification.unread).map((notification) => notification.key);
    session.markRead(keys);
    announce('All notifications marked read');
  };

  return (
    <PopoverContent
      align="end"
      side="bottom"
      sideOffset={8}
      className="max-h-[min(42rem,calc(100vh-6rem))] w-[26rem] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
    >
      <PopoverHeader className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <PopoverTitle className="font-heading text-base font-bold text-foreground">Notifications</PopoverTitle>
            <PopoverDescription className="mt-0.5 text-xs">
              {session.scope === 'own' ? 'Your book' : 'All business activity'}
            </PopoverDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!session.notifications.some((notification) => notification.unread)}
            onClick={markAllRead}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all read
          </Button>
        </div>
      </PopoverHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {session.loading && session.notifications.length === 0 && (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading the business…
          </div>
        )}

        {!session.loading && session.error && (
          <div className="flex min-h-20 items-center justify-between gap-3 border-b border-border px-1 py-3">
            <p className="text-sm text-foreground">The notifications could not be loaded.</p>
            <Button type="button" variant="outline" size="xs" onClick={session.refresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {!session.loading && !session.error && session.notifications.length === 0 && (
          <div className="flex min-h-36 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
              <CheckCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="font-medium text-foreground">Nothing needs you right now.</p>
            <p className="mt-1 text-xs text-muted-foreground">New business signals will appear here.</p>
          </div>
        )}

        {primary.length > 0 && <div className="space-y-5">{renderGroups(primary)}</div>}

        {info.length > 0 && (
          <div className={cn('mt-4 border-t border-border pt-3', primary.length === 0 && 'mt-0 border-t-0 pt-0')}>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((current) => !current)}
            >
              <span>Also worth a look ({info.length})</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', showInfo && 'rotate-180')} aria-hidden="true" />
            </Button>
            {showInfo && <div className="mt-4 space-y-5">{renderGroups(info)}</div>}
          </div>
        )}

        {session.unavailableSignals.length > 0 && (
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            Some business signals are temporarily unavailable.
          </p>
        )}
      </div>
      <LiveStatus message={announcement} />
    </PopoverContent>
  );
}
