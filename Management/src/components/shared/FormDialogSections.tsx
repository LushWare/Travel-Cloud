import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * Shared scaffolding for "big multi-section edit form" dialogs (lead
 * create/edit, package create/edit). Any dialog using these must set
 * DialogContent to a responsive bounded size with "p-0 gap-0 overflow-hidden
 * flex flex-col" - header/footer pin via shrink-0, FormDialogBody is the only
 * scrolling region.
 */

export interface FormDialogHeaderTab {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

interface FormDialogHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  tabs?: FormDialogHeaderTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Buttons shown at the header's right edge (kept clear of the close X). */
  actions?: ReactNode;
}

export function FormDialogHeader({
  icon: Icon, title, subtitle, tabs, activeTab, onTabChange, actions,
}: FormDialogHeaderProps) {
  return (
    <DialogHeader className="bg-primary text-primary-foreground p-4 sm:p-6 shrink-0 space-y-0">
      <div className={cn('flex items-center gap-4', actions && 'pr-10')}>
        <div className="p-3 bg-primary-foreground/15 rounded-xl shrink-0">
          <Icon className="w-7 h-7" />
        </div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-xl sm:text-2xl text-primary-foreground">{title}</DialogTitle>
          {subtitle && (
            <DialogDescription className="text-primary-foreground/80 mt-0.5">{subtitle}</DialogDescription>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {tabs && tabs.length > 1 && (
        <div className="flex gap-1 pt-4 -mb-4 sm:-mb-6" role="tablist">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange?.(tab.key)}
                className={cn(
                  'flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-background text-foreground'
                    : 'text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground'
                )}
              >
                {TabIcon && <TabIcon className="w-4 h-4" />}
                <span>{tab.label}</span>
                {tab.count != null && tab.count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[11px] font-bold',
                      isActive ? 'bg-muted text-muted-foreground' : 'bg-primary-foreground/20'
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </DialogHeader>
  );
}

interface FormDialogBodyProps {
  className?: string;
  children: ReactNode;
}

export function FormDialogBody({ className, children }: FormDialogBodyProps) {
  return <div className={cn('flex-1 overflow-y-auto p-4 sm:p-6 space-y-4', className)}>{children}</div>;
}

interface FormDialogSectionProps {
  id: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  count?: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

export function FormDialogSection({
  id,
  icon: Icon,
  title,
  subtitle,
  count,
  expanded,
  onToggle,
  children,
}: FormDialogSectionProps) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        className={cn(
          'w-full px-6 py-4 flex items-center justify-between transition-colors',
          expanded ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
              expanded ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'
            )}
          >
            <Icon className={cn('w-5 h-5', expanded && 'text-primary-foreground')} />
          </div>
          <div className="text-left">
            <h3 className="text-base font-heading font-semibold flex items-center gap-2">
              {title}
              {count !== undefined && (
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    expanded ? 'bg-primary-foreground/20' : 'bg-secondary'
                  )}
                >
                  {count}
                </span>
              )}
            </h3>
            {subtitle && (
              <p className={cn('text-sm', expanded ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 shrink-0" /> : <ChevronDown className="w-5 h-5 shrink-0" />}
      </button>
      {/*
        Deliberately ONE padding layer for the body (px-6 pb-6 pt-4), inside
        ONE outer frame with zero padding of its own. Do not re-wrap children
        in another box (e.g. bg-muted/50 rounded-2xl border) - that
        double-boxing is exactly the extra margin-layer problem this
        component replaces.
      */}
      {expanded && <div className="px-6 pb-6 pt-4 border-t border-border">{children}</div>}
    </div>
  );
}

interface FormDialogFooterProps {
  className?: string;
  children: ReactNode;
}

/**
 * Deliberately does NOT compose DialogFooter. DialogFooter's base classes
 * (-mx-4 -mb-4 rounded-b-xl bg-muted/50 p-4) are tuned to cancel out
 * DialogContent's *default* p-4 padding - correct for ordinary dialogs, but
 * wrong once DialogContent is p-0 (required by this component set), since
 * the negative margins then pull the footer outside the zero-padding box
 * and produce a full-bleed colored band instead of an inset one. This
 * component just inherits DialogContent's bg-popover directly.
 */
export function FormDialogFooter({ className, children }: FormDialogFooterProps) {
  return (
    <div
      className={cn(
        'shrink-0 border-t border-border p-4 sm:p-6',
        'flex flex-col-reverse gap-3 sm:flex-row sm:justify-end',
        className
      )}
    >
      {children}
    </div>
  );
}
