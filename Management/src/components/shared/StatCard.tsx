import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export type StatCardColor = 'primary' | 'success' | 'warning' | 'destructive' | 'muted';

const colorClasses: Record<StatCardColor, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
};

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  trend?: string;
  trendDirection?: 'up' | 'down';
  trailingIcon?: LucideIcon;
  color?: StatCardColor;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  subtitle,
  trend,
  trendDirection = 'up',
  trailingIcon: TrailingIcon,
  color = 'primary',
  loading = false,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <Card className={cn('animate-pulse', className)}>
        <CardContent className="flex items-center gap-4">
          <div className="size-11 shrink-0 rounded-lg bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-6 w-16 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const TrendIcon = trendDirection === 'up' ? TrendingUp : TrendingDown;

  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {value}
            {unit ? <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span> : null}
          </p>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
          {trend ? (
            <div
              className={cn(
                'mt-2 flex items-center gap-1 font-mono text-xs font-medium tabular-nums',
                trendDirection === 'up' ? 'text-success' : 'text-destructive'
              )}
            >
              <TrendIcon className="size-3.5" />
              <span>{trend}</span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={cn('flex size-11 items-center justify-center rounded-lg', colorClasses[color])}>
            <Icon className="size-5" />
          </div>
          {TrailingIcon ? <TrailingIcon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
