import { useState } from 'react';
import { Banknote, ChevronRight, MapPin, RefreshCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { getPriceRangeOptions } from '../lib/currency';
import type { RangeOption } from './shared/RangeFilterGroup';
import type { AggregatedDestination } from '@/services/api/packages.transform';

const BUDGET_OPTIONS = getPriceRangeOptions();

interface RegionOption {
  region: string;
  destinations: AggregatedDestination[];
}

interface DestinationFiltersProps {
  regionOptions: RegionOption[];
  selectedDestinationFilters: string[];
  searchQuery: string;
  selectedBudget: RangeOption | null;
  onSearchChange: (value: string) => void;
  onToggleDestinationFilter: (value: string) => void;
  onBudgetChange: (range: RangeOption | null) => void;
  onClearFilters: () => void;
  onClose: () => void;
}

const DestinationFilters = ({
  regionOptions,
  selectedDestinationFilters,
  searchQuery,
  selectedBudget,
  onSearchChange,
  onToggleDestinationFilter,
  onBudgetChange,
  onClearFilters,
  onClose,
}: DestinationFiltersProps) => {
  const [expandedRegions, setExpandedRegions] = useState<string[]>([]);
  const activeFilterCount =
    selectedDestinationFilters.length + Number(Boolean(searchQuery.trim())) + Number(selectedBudget !== null);
  const activeFilterLabels = [
    ...selectedDestinationFilters.map((destination) => `Location: ${destination}`),
    ...(searchQuery.trim() ? [`Search: ${searchQuery.trim()}`] : []),
    ...(selectedBudget ? [`Budget: ${selectedBudget.label}`] : []),
  ];

  const toggleExpandedRegion = (region: string) => {
    setExpandedRegions((current) =>
      current.includes(region) ? current.filter((value) => value !== region) : [...current, region],
    );
  };

  return (
    <aside className="w-full flex-shrink-0 lg:w-72">
      <div className="sticky top-24 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_40px_-24px_rgba(15,23,42,0.35)]">
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 shadow-sm lg:static lg:z-auto lg:shadow-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                <SlidersHorizontal aria-hidden="true" className="h-[18px] w-[18px]" />
              </span>
              <h2 className="whitespace-nowrap text-base font-semibold text-slate-900">Filters</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 lg:hidden"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-emerald-900">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-600" />
                  {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} active
                </span>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  Clear All
                </button>
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                {activeFilterLabels.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    title={label}
                    className="max-w-full whitespace-normal break-words rounded-md border border-emerald-100 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                  >
                    {label}
                  </span>
                ))}
                {activeFilterLabels.length > 3 && (
                  <span className="rounded-md border border-emerald-100 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                    +{activeFilterLabels.length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6 p-5">
          <section aria-labelledby="destination-search-label">
            <label
              id="destination-search-label"
              htmlFor="destination-search"
              className="mb-2.5 block text-sm font-semibold text-slate-800"
            >
              Search
            </label>
            <div className="group relative">
              <Search
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-700"
              />
              <input
                id="destination-search"
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Places, countries..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-3 pl-11 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear destination search"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>

          <section aria-labelledby="destination-regions-label">
            <div className="mb-3 flex items-center gap-2">
              <MapPin aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              <h3 id="destination-regions-label" className="text-sm font-semibold text-slate-800">
                Explore by region
              </h3>
            </div>
            {regionOptions.length > 0 ? (
              <div className="space-y-2">
                {regionOptions.map(({ region, destinations }) => {
                  const isExpanded = expandedRegions.includes(region);
                  const filterOptions = Array.from(
                    new Set(
                      destinations.flatMap((destination) =>
                        [destination.name, destination.country].map((value) => value.trim()).filter(Boolean),
                      ),
                    ),
                  );
                  const regionId = `destination-region-${encodeURIComponent(region)}`;

                  return (
                    <div key={region}>
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={regionId}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${region}`}
                        onClick={() => toggleExpandedRegion(region)}
                        className={`group flex w-full cursor-pointer items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
                          isExpanded
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-950'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/60'
                        }`}
                      >
                        <span className="text-sm font-medium">{region}</span>
                        <span className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              isExpanded ? 'bg-white/80 text-emerald-800' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {destinations.length}
                          </span>
                          <ChevronRight
                            aria-hidden="true"
                            className={`h-4 w-4 transition-transform duration-200 ${
                              isExpanded ? 'rotate-90 text-emerald-700' : 'text-slate-400 group-hover:text-emerald-700'
                            }`}
                          />
                        </span>
                      </button>
                      {isExpanded && (
                        <div
                          id={regionId}
                          className="ml-4 mt-2 space-y-1 border-l-2 border-emerald-100 py-1 pl-3"
                        >
                          {filterOptions.map((value) => {
                            const isSelected = selectedDestinationFilters.includes(value);
                            return (
                              <label
                                key={value}
                                className={`group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                                  isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => onToggleDestinationFilter(value)}
                                  className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-700 focus:ring-emerald-500"
                                />
                                <span
                                  className={`text-sm transition-colors ${
                                    isSelected
                                      ? 'font-medium text-emerald-900'
                                      : 'text-slate-600 group-hover:text-slate-900'
                                  }`}
                                >
                                  {value}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">
                No regions available yet.
              </p>
            )}
          </section>

          <section aria-labelledby="destination-budget-label">
            <div className="mb-3 flex items-center gap-2">
              <Banknote aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              <h3 id="destination-budget-label" className="text-sm font-semibold text-slate-800">
                Budget
              </h3>
            </div>
            <div className="space-y-1">
              {BUDGET_OPTIONS.map((option) => {
                const isSelected = selectedBudget?.label === option.label;
                return (
                  <label
                    key={option.label}
                    className={`group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                      isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onBudgetChange(isSelected ? null : option)}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-700 focus:ring-emerald-500"
                    />
                    <span
                      className={`text-base transition-colors ${
                        isSelected
                          ? 'font-medium text-emerald-900'
                          : 'text-slate-600 group-hover:text-slate-900'
                      }`}
                    >
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <button
            type="button"
            onClick={onClearFilters}
            disabled={activeFilterCount === 0}
            className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600"
          >
            <RefreshCcw
              aria-hidden="true"
              className="h-4 w-4 transition-transform group-hover:rotate-[-45deg]"
            />
            Reset filters
          </button>
        </div>
      </div>
    </aside>
  );
};

export default DestinationFilters;
