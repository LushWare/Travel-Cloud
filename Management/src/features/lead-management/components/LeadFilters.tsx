import { Search, X, Filter, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LifecycleStatus } from './LeadStatusBadge';

type FilterKey = 'all' | LifecycleStatus;

// Subset of the 10 lifecycle statuses worth a quick filter tab; dot colors
// reuse LeadStatusBadge's semantic grouping (muted/primary/success/destructive)
// so a status reads the same color here as it does on the lead's own badge,
// instead of each filter inventing its own hue.
const STATUSES: { key: FilterKey; label: string; shortLabel: string; dot: string }[] = [
  { key: 'all', label: 'All', shortLabel: 'All', dot: 'bg-muted-foreground' },
  { key: 'NEW', label: 'New', shortLabel: 'New', dot: 'bg-muted-foreground' },
  { key: 'PENDING_VERIFICATION', label: 'Pending Verification', shortLabel: 'Pend.', dot: 'bg-warning' },
  { key: 'DRAFTING', label: 'Drafting', shortLabel: 'Draft', dot: 'bg-muted-foreground' },
  { key: 'QUOTED', label: 'Quoted', shortLabel: 'Quot.', dot: 'bg-primary' },
  { key: 'APPROVED', label: 'Approved', shortLabel: 'Appr.', dot: 'bg-success' },
  { key: 'BOOKING_IN_PROGRESS', label: 'Booking', shortLabel: 'Book', dot: 'bg-primary' },
  { key: 'CONFIRMED', label: 'Confirmed', shortLabel: 'Conf.', dot: 'bg-success' },
  { key: 'CLOSED_LOST', label: 'Lost', shortLabel: 'Lost', dot: 'bg-destructive' },
];

interface LeadFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  filterStatus: FilterKey;
  setFilterStatus: (value: FilterKey) => void;
  statusCounts: Record<string, number>;
  onAdvancedFilterClick: () => void;
  onClearFilters: () => void;
  activeFilterCount: number;
}

const LeadFilters = ({
  searchTerm,
  setSearchTerm,
  filterStatus,
  setFilterStatus,
  statusCounts,
  onAdvancedFilterClick,
  onClearFilters,
  activeFilterCount,
}: LeadFiltersProps) => {
  const hasActiveFilters = Boolean(searchTerm || filterStatus !== 'all' || activeFilterCount > 0);

  return (
    <Card className="overflow-visible p-2 sm:p-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, phone, destination..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-full transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>

          <Button
            variant="outline"
            onClick={onAdvancedFilterClick}
            className="shrink-0 whitespace-nowrap"
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{activeFilterCount}</span>
            )}
          </Button>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Tabs
            value={filterStatus}
            onValueChange={(value) => setFilterStatus(String(value) as FilterKey)}
            className="min-w-0 flex-1 overflow-hidden"
          >
            <TabsList className="w-full justify-start overflow-x-auto scrollbar-hide">
              {STATUSES.map((status) => (
                <TabsTrigger key={status.key} value={status.key} className="gap-1.5">
                  <span className={`hidden sm:block w-2 h-2 rounded-full ${status.dot}`} />
                  <span className="sm:hidden">{status.shortLabel}</span>
                  <span className="hidden sm:inline">{status.label}</span>
                  <span className="px-1 sm:px-1.5 py-0.5 rounded bg-muted text-xs font-semibold text-muted-foreground">
                    {statusCounts[status.key] || 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            title="Clear all filters"
            aria-label="Clear all filters"
            onClick={onClearFilters}
            disabled={!hasActiveFilters}
            className="h-8 shrink-0 border-destructive bg-destructive px-2 text-black hover:bg-destructive/90 hover:text-black disabled:bg-destructive/30 disabled:text-black disabled:opacity-100 dark:text-white dark:hover:text-white dark:disabled:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default LeadFilters;
