import { Banknote, Clock, MapPin, RefreshCcw, SlidersHorizontal, X } from 'lucide-react';
import RangeFilterGroup, { type RangeOption } from './shared/RangeFilterGroup';
import { DURATION_OPTIONS, PRICE_RANGE_OPTIONS } from '../features/packages/filterOptions';

interface PackageFiltersProps {
  selectedBudget: RangeOption | null;
  selectedDuration: RangeOption | null;
  locations: string[];
  selectedLocations: string[];
  onBudgetChange: (range: RangeOption | null) => void;
  onDurationChange: (range: RangeOption | null) => void;
  onLocationsChange: (locations: string[]) => void;
  onClearFilters: () => void;
  onClose: () => void;
}

const PackageFilters = ({
  selectedBudget,
  selectedDuration,
  locations,
  selectedLocations,
  onBudgetChange,
  onDurationChange,
  onLocationsChange,
  onClearFilters,
  onClose,
}: PackageFiltersProps) => {
  const activeFilterCount =
    Number(selectedBudget !== null) + Number(selectedDuration !== null) + selectedLocations.length;
  const activeFilterLabels = [
    ...selectedLocations.map((location) => `Location: ${location}`),
    ...(selectedBudget ? [`Budget: ${selectedBudget.label}`] : []),
    ...(selectedDuration ? [`Duration: ${selectedDuration.label}`] : []),
  ];

  const toggleLocation = (location: string) => {
    onLocationsChange(
      selectedLocations.includes(location)
        ? selectedLocations.filter((selected) => selected !== location)
        : [...selectedLocations, location],
    );
  };

  return (
    <aside className="w-full flex-shrink-0 lg:w-72">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_40px_-24px_rgba(15,23,42,0.35)]">
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

        <div className="p-5">
          {locations.length > 0 && (
            <fieldset className="mb-6">
              <legend className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <MapPin aria-hidden="true" className="h-4 w-4 text-gray-600" />
                Location
              </legend>
              <div className="space-y-1">
                {locations.map((location) => (
                  <label
                    key={location}
                    className={`group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                      selectedLocations.includes(location)
                        ? 'bg-emerald-50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedLocations.includes(location)}
                      onChange={() => toggleLocation(location)}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-700 focus:ring-emerald-500"
                    />
                    <span
                      className={`text-sm transition-colors ${
                        selectedLocations.includes(location)
                          ? 'font-medium text-emerald-900'
                          : 'text-slate-600 group-hover:text-slate-900'
                      }`}
                    >
                      {location}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <RangeFilterGroup
            label="Budget"
            icon={<Banknote />}
            options={PRICE_RANGE_OPTIONS}
            selected={selectedBudget}
            onChange={onBudgetChange}
          />
          <RangeFilterGroup
            label="Trip Duration"
            icon={<Clock />}
            options={DURATION_OPTIONS}
            selected={selectedDuration}
            onChange={onDurationChange}
          />
          <button
            type="button"
            onClick={onClearFilters}
            disabled={activeFilterCount === 0}
            className="group mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600"
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

export default PackageFilters;