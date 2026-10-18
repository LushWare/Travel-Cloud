import { AlertTriangle, Calendar, Check, CheckCircle2, Globe, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SOURCE_OPTIONS = [
  { id: 'website', label: 'Website' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'phone_call', label: 'Phone Call' },
  { id: 'email', label: 'Email' },
  { id: 'referral', label: 'Referral' },
  { id: 'walk_in', label: 'Walk-in' },
  { id: 'booking', label: 'Booking' },
  { id: 'chatbot', label: 'Chatbot' },
  { id: 'other', label: 'Other' },
];

const AI_OPTIONS = [
  { id: 'needsRepFollowup', label: 'Needs check', icon: AlertTriangle },
  { id: 'aiHandled', label: 'AI handled', icon: Sparkles },
  { id: 'aiVerified', label: 'AI verified', icon: CheckCircle2 },
];

interface FilterDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filterTravelDateStart: string;
  setFilterTravelDateStart: (value: string) => void;
  filterTravelDateEnd: string;
  setFilterTravelDateEnd: (value: string) => void;
  filterSources: string[];
  setFilterSources: (value: string[]) => void;
  filterAi: string[];
  setFilterAi: (value: string[]) => void;
}

const FilterDialog = ({
  isOpen,
  onClose,
  filterTravelDateStart,
  setFilterTravelDateStart,
  filterTravelDateEnd,
  setFilterTravelDateEnd,
  filterSources,
  setFilterSources,
  filterAi,
  setFilterAi,
}: FilterDialogProps) => {
  const clearFilters = () => {
    setFilterTravelDateStart('');
    setFilterTravelDateEnd('');
    setFilterSources([]);
    setFilterAi([]);
  };

  const hasActiveFilters = Boolean(
    filterTravelDateStart || filterTravelDateEnd || filterSources.length || filterAi.length
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lead Filters</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Travel Date Range */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Travel Date Range
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Input
                  type="date"
                  value={filterTravelDateStart}
                  onChange={(e) => setFilterTravelDateStart(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Input
                  type="date"
                  value={filterTravelDateEnd}
                  onChange={(e) => setFilterTravelDateEnd(e.target.value)}
                  min={filterTravelDateStart || undefined}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Lead Source
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_OPTIONS.map(({ id, label }) => {
                  const selected = filterSources.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilterSources(selected ? filterSources.filter((value) => value !== id) : [...filterSources, id])}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Voice Agent</p>
            <div className="flex flex-wrap gap-1.5">
              {AI_OPTIONS.map(({ id, label, icon: Icon }) => {
                const selected = filterAi.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFilterAi(selected ? filterAi.filter((value) => value !== id) : [...filterAi, id])}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Filters Summary */}
          {hasActiveFilters && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">
                Active filters:
                {filterTravelDateStart && ` From ${filterTravelDateStart}`}
                {filterTravelDateEnd && ` To ${filterTravelDateEnd}`}
                {filterSources.length > 0 && ` • ${filterSources.length} source(s)`}
                {filterAi.length > 0 && ` • ${filterAi.length} Voice Agent filter(s)`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={clearFilters} disabled={!hasActiveFilters} className="flex-1">
            Clear All
          </Button>
          <Button onClick={onClose} className="flex-1">
            Apply Filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FilterDialog;
