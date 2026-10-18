import { Search, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StatusTab {
  id: string | null;
  label: string;
  count: number;
}

interface PackageFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string | null;
  onStatusFilterChange: (value: string | null) => void;
  statusTabs: StatusTab[];
  linkedPackageCount?: number;
  onClearLinkedFilter?: () => void;
}

const ALL_TAB_VALUE = 'all';

const PackageFilters = ({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  statusTabs,
  linkedPackageCount,
  onClearLinkedFilter,
}: PackageFiltersProps) => {
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search packages by name or region..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchTerm && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-full transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {linkedPackageCount !== undefined ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-sm text-foreground">
              Active filter: linked packages <span className="font-mono tabular-nums">({linkedPackageCount})</span>
            </p>
            <button type="button" onClick={onClearLinkedFilter} className="text-sm font-medium text-primary hover:underline">
              Clear filter
            </button>
          </div>
        ) : (
          <Tabs
            value={statusFilter ?? ALL_TAB_VALUE}
            onValueChange={(value) => onStatusFilterChange(value === ALL_TAB_VALUE ? null : String(value))}
            className="min-w-0"
          >
            <TabsList className="w-full justify-start overflow-x-auto scrollbar-hide sm:w-fit">
              {statusTabs.map((tab) => (
                <TabsTrigger key={tab.id ?? ALL_TAB_VALUE} value={tab.id ?? ALL_TAB_VALUE} className="gap-1.5">
                  {tab.label}
                  <span className="px-1.5 py-0.5 rounded bg-muted text-xs font-semibold text-muted-foreground">
                    {tab.count}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>
    </Card>
  );
};

export default PackageFilters;
