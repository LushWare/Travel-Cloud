import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import DestinationCard from '../components/DestinationCard';
import DestinationFilters from '../components/DestinationFilters';
import FilterPanelShell from '../components/shared/FilterPanelShell';
import type { RangeOption } from '../components/shared/RangeFilterGroup';
import { fetchPackages, getCachedPackages } from '@/services/api/packages';
import { aggregateDestinations, type AggregatedDestination } from '@/services/api/packages.transform';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';

const API_PAGE_SIZE = 100;
const DESTINATIONS_PER_PAGE = 12;
type DestinationSortOption = 'popularity' | 'price-low' | 'price-high' | 'name';

const getTotalPages = (pagination: unknown): number => {
  if (
    typeof pagination === 'object' &&
    pagination !== null &&
    'totalPages' in pagination &&
    typeof pagination.totalPages === 'number' &&
    Number.isFinite(pagination.totalPages)
  ) {
    return Math.max(1, Math.trunc(pagination.totalPages));
  }
  return 1;
};

const DestinationsPage = () => {
  const cachedFirstPage = getCachedPackages({ limit: API_PAGE_SIZE });
  const [destinations, setDestinations] = useState<AggregatedDestination[]>(() =>
    cachedFirstPage
      ? aggregateDestinations(cachedFirstPage.packages).sort((left, right) => right.packagesCount - left.packagesCount)
      : [],
  );
  const [selectedDestinationFilters, setSelectedDestinationFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBudget, setSelectedBudget] = useState<RangeOption | null>(null);
  const [sortBy, setSortBy] = useState<DestinationSortOption>('popularity');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  const [loading, setLoading] = useState(() => !cachedFirstPage);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);

    const loadDestinations = async () => {
      const firstPage = await fetchPackages({ limit: API_PAGE_SIZE });
      const remainingPages = await Promise.all(
        Array.from({ length: getTotalPages(firstPage.pagination) - 1 }, (_, index) =>
          fetchPackages({ limit: API_PAGE_SIZE, page: index + 2 }),
        ),
      );
      const packages = [firstPage, ...remainingPages].flatMap(({ packages: pagePackages }) => pagePackages);
      return aggregateDestinations(packages).sort((left, right) => right.packagesCount - left.packagesCount);
    };

    loadDestinations()
      .then((loadedDestinations) => {
        if (mounted) setDestinations(loadedDestinations);
      })
      .catch((requestError: unknown) => {
        if (mounted) setError(apiErrorMessage(requestError));
      })
      .finally(() => {
        if (mounted) setLoading(false);
     });

    return () => {
      mounted = false;
    };
  }, [retryCount]);

  const regionOptions = useMemo(() => {
    const groups = new Map<string, AggregatedDestination[]>();
    destinations.forEach((destination) => {
      const region = destination.region.trim();
      if (!region) return;
      const regionDestinations = groups.get(region) ?? [];
      regionDestinations.push(destination);
      groups.set(region, regionDestinations);
    });
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([region, regionDestinations]) => ({
        region,
        destinations: regionDestinations,
      }));
  }, [destinations]);

  const filteredDestinations = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return destinations
      .filter((destination) => {
      const matchesDestination =
        selectedDestinationFilters.length === 0 ||
        selectedDestinationFilters.includes(destination.name) ||
        selectedDestinationFilters.includes(destination.country);
      const matchesSearch =
        query.length === 0 ||
        [destination.name, destination.country, destination.description, destination.region]
          .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesBudget =
        selectedBudget === null ||
        (destination.price >= selectedBudget.min && destination.price <= selectedBudget.max);
        return matchesDestination && matchesSearch && matchesBudget;
      })
      .sort((left, right) => {
        switch (sortBy) {
          case 'price-low':
            return left.price - right.price;
          case 'price-high':
            return right.price - left.price;
          case 'name':
            return left.name.localeCompare(right.name);
          case 'popularity':
          default:
            return right.packagesCount - left.packagesCount;
        }
      });
  }, [destinations, searchQuery, selectedBudget, selectedDestinationFilters, sortBy]);

  const totalPages = Math.ceil(filteredDestinations.length / DESTINATIONS_PER_PAGE);
  const startIndex = (currentPage - 1) * DESTINATIONS_PER_PAGE;
  const visibleDestinations = filteredDestinations.slice(startIndex, startIndex + DESTINATIONS_PER_PAGE);

  const toggleDestinationFilter = (value: string) => {
    setSelectedDestinationFilters((current) =>
      current.includes(value)
        ? current.filter((selected) => selected !== value)
        : [...current, value],
    );
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSelectedDestinationFilters([]);
    setSearchQuery('');
    setSelectedBudget(null);
    setCurrentPage(1);
  };
  const changeSort = (value: DestinationSortOption) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  const activeFilterCount =
    selectedDestinationFilters.length + Number(Boolean(searchQuery.trim())) + Number(selectedBudget !== null);
  const filterPanel = (
    <DestinationFilters
      regionOptions={regionOptions}
      selectedDestinationFilters={selectedDestinationFilters}
      searchQuery={searchQuery}
      selectedBudget={selectedBudget}
      onSearchChange={(value) => {
        setSearchQuery(value);
        setCurrentPage(1);
      }}
      onToggleDestinationFilter={toggleDestinationFilter}
      onBudgetChange={(range) => {
        setSelectedBudget(range);
        setCurrentPage(1);
      }}
      onClearFilters={clearFilters}
      onClose={() => setShowMobileFilters(false)}
    />
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" role="status" aria-label="Loading destinations">
        <div className="h-16 w-16 animate-spin rounded-full border-t-4 border-b-4 border-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center" role="alert">
          <h2 className="mb-4 text-2xl font-bold text-gray-900">Unable to load destinations</h2>
          <p className="mb-6 text-gray-600">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setRetryCount((count) => count + 1);
            }}
            className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <section className="relative isolate flex h-[220px] w-full items-center overflow-hidden bg-[#092522] pt-20 sm:h-[310px]">
        <img
          src="/12.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-[1.03] object-cover object-[68%_58%]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(9,37,34,0.88)_0%,rgba(9,37,34,0.72)_30%,rgba(9,37,34,0.35)_55%,rgba(9,37,34,0)_78%)]" />

        <div className="relative z-20 max-w-4xl px-6 pb-6 sm:px-12 md:px-24">
          <h1 className="mb-4 font-serif text-4xl font-medium leading-[1.1] text-white drop-shadow-sm sm:text-6xl">
            Destinations
          </h1>
          <p className="max-w-xl text-base font-light leading-6 text-white/90 sm:text-lg">
            Find your next adventure among breathtaking places, from iconic cities to hidden gems.
          </p>
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:flex-row">
        <div className="hidden lg:block">{filterPanel}</div>

        <div className="flex-1">
          <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
              <p className="text-sm text-gray-600">
                Showing{' '}
                <span className="font-semibold text-slate-800">
                  {filteredDestinations.length === 0 ? 0 : startIndex + 1}–{Math.min(startIndex + DESTINATIONS_PER_PAGE, filteredDestinations.length)}
                </span>{' '}
                of {filteredDestinations.length} destinations
              </p>
              <button
                type="button"
                onClick={() => setShowMobileFilters(true)}
                aria-label="Show filters"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 lg:hidden"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 text-xs text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
            <div className="flex w-full items-center justify-end gap-2 text-sm sm:w-auto">
              <label htmlFor="destinations-sort" className="shrink-0 text-gray-500">Sort by:</label>
              <select
                id="destinations-sort"
                aria-label="Sort destinations"
                value={sortBy}
                onChange={(event) => changeSort(event.target.value as DestinationSortOption)}
                className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800 outline-none transition-colors hover:border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="popularity">Most Popular</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>
          </div>

          {visibleDestinations.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visibleDestinations.map((destination) => (
                <DestinationCard
                  key={destination.id}
                  image={destination.image_url}
                  location={destination.country || destination.region}
                  slug={destination.slug}
                  title={destination.name}
                  description={destination.description}
                  duration={destination.durationLabel || 'Flexible'}
                  packagesCount={destination.packagesCount}
                  startingPrice={destination.price}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-white px-6 py-16 text-center">
              <h2 className="mb-2 text-xl font-semibold text-slate-800">
                {destinations.length === 0 ? 'No destinations available yet' : 'No destinations in this region'}
              </h2>
              <p className="text-sm text-gray-600">
                {destinations.length === 0
                  ? 'Please check back soon for available trips.'
                  : 'Choose another region or clear your filters.'}
              </p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-12 flex items-center justify-center gap-1 sm:gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown className="h-4 w-4 rotate-90" />
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                <button
                  type="button"
                  key={page}
                  aria-current={page === currentPage ? 'page' : undefined}
                  onClick={() => setCurrentPage(page)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors sm:h-10 sm:w-10 ${
                    page === currentPage
                      ? 'bg-brand-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                aria-label="Next page"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown className="h-4 w-4 -rotate-90" />
              </button>
            </div>
          )}
        </div>
      </main>
      {showMobileFilters && (
        <FilterPanelShell forceMobile onClose={() => setShowMobileFilters(false)}>
          {filterPanel}
        </FilterPanelShell>
      )}
    </div>
  );
};

export default DestinationsPage;
