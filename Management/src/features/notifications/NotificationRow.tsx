import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BusinessNotification } from './types';

type NotificationRowProps = {
  notification: BusinessNotification;
  announce: (message: string) => void;
  onView: (notification: BusinessNotification) => void;
  onDismiss: (notification: BusinessNotification) => void;
};

export default function NotificationRow({
  notification,
  announce,
  onView,
  onDismiss,
}: NotificationRowProps) {
  const received = new Date(notification.firstSeenAt);
  const timestamp = Number.isNaN(received.getTime())
    ? null
    : received.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <article aria-label={notification.text} className="space-y-1.5">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {notification.unread && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          )}
          <span>{notification.unread ? 'New' : 'Read'}</span>
          {timestamp && <span className="font-mono tabular-nums">{timestamp}</span>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(notification)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${notification.severity === 'critical' ? 'bg-destructive' : notification.severity === 'warning' ? 'bg-warning' : 'bg-primary'}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{notification.text}</p>
            {notification.facts.length > 0 && (
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {notification.facts.map((fact) => (
                  <div key={`${fact.kind}-${fact.evidenceId || fact.value}`} className="flex gap-1 text-xs">
                    <dt className="capitalize text-muted-foreground">{fact.kind}:</dt>
                    <dd className="font-medium text-foreground">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {notification.target && <Button variant="link" size="xs" className="mt-2 h-auto px-0" onClick={() => { announce('Opening related records'); onView(notification); }}>{notification.target.label}</Button>}
          </div>
        </div>
      </div>
    </article>
  );
}
