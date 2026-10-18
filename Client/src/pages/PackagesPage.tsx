import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import FilterPanelShell from '../components/shared/FilterPanelShell';
import type { RangeOption } from '../components/shared/RangeFilterGroup';
import { fetchPackages, getCachedPackages } from '@/services/api/packages';
import type { NormalizedPackage } from '@/services/api/packages.transform';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import PackageCard from '../components/PackageCard';
import PackageFilters from '../components/PackageFilters';

const API_PAGE_SIZE = 100;
const PACKAGES_PER_PAGE = 12;
type PackageSortOption = 'popularity' | 'price-low' | 'price-high' | 'duration';

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

const slugify = (value: string): string =>
  value.toLocaleLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-{2,}/g, '-');

const getPackageLocation = (pkg: NormalizedPackage): string =>
  pkg.destination.raw ||
  [pkg.destination.name, pkg.destination.country].filter(Boolean).join(', ') ||
  pkg.destinationRaw;

const PackagesPage = () => {
  const cachedFirstPage = getCachedPackages({ limit: API_PAGE_SIZE });
  const [searchParams] = useSearchParams();
  const destinationQuery = (
    searchParams.get('destination') ||
    searchParams.get('state') ||
    searchParams.get('country') ||
    ''
  ).toLocaleLowerCase();
  const categoryQuery = searchParams.get('category')?.toLocaleLowerCase() ?? '';
  const [packages, setPackages] = useState<NormalizedPackage[]>(() => cachedFirstPage?.packages ?? []);
  const [selectedBudget, setSelectedBudget] = useState<RangeOption | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<RangeOption | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<PackageSortOption>('popularity');
  const [currentPage, setCurrentPage] = useState(1);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loading, setLoading] = useState(() => !cachedFirstPage);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);

    const loadPackages = async () => {
      const firstPage = await fetchPackages({ limit: API_PAGE_SIZE });
      const remainingPages = await Promise.all(
        Array.from({ length: getTotalPages(firstPage.pagination) - 1 }, (_, index) =>
          fetchPackages({ limit: API_PAGE_SIZE, page: index + 2 }),
        ),
      );
      return [firstPage, ...remainingPages]
        .flatMap(({ packages: pagePackages }) => pagePackages)
        .sort((left, right) => right.bookings - left.bookings);
    };

    loadPackages()
      .then((loadedPackages) => {
        if (mounted) setPackages(loadedPackages);
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

  const filteredPackages = useMemo(
    () =>
      packages
        .filter((pkg) => {
        const matchesCategory = !categoryQuery || pkg.category.toLocaleLowerCase() === categoryQuery;
        const matchesBudget =
          selectedBudget === null ||
          (pkg.price_from >= selectedBudget.min && pkg.price_from <= selectedBudget.max);
        const matchesDuration =
          selectedDuration === null ||
          (pkg.duration_days >= selectedDuration.min && pkg.duration_days <= selectedDuration.max);
        const matchesLocation =
          selectedLocations.length === 0 || selectedLocations.includes(getPackageLocation(pkg));
          return matchesCategory && matchesBudget && matchesDuration && matchesLocation;
        })
        .sort((left, right) => {
          switch (sortBy) {
            case 'price-low':
              return left.price_from - right.price_from;
            case 'price-high':
              return right.price_from - left.price_from;
            case 'duration':
              return left.duration_days - right.duration_days;
            case 'popularity':
            default:
              return right.bookings - left.bookings;
          }
        }),
    [packages, destinationQuery, categoryQuery, selectedBudget, selectedDuration, selectedLocations, sortBy],
  );

  const locations = useMemo(
    () => [...new Set(packages.map(getPackageLocation).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [packages],
  );

  useEffect(() => {
    if (!destinationQuery) {
      setSelectedLocations([]);
      return;
    }

    const matchingLocations = packages
      .filter((pkg) =>
        [pkg.destination.slug, pkg.destination.nameSlug, pkg.destination.countrySlug, slugify(pkg.destination.raw)]
          .includes(destinationQuery),
      )
      .map(getPackageLocation);
    setSelectedLocations([...new Set(matchingLocations)]);
    setCurrentPage(1);
  }, [packages, destinationQuery]);

  const totalPages = Math.ceil(filteredPackages.length / PACKAGES_PER_PAGE);
  const startIndex = (currentPage - 1) * PACKAGES_PER_PAGE;
  const visiblePackages = filteredPackages.slice(startIndex, startIndex + PACKAGES_PER_PAGE);
  const activeFilterCount =
    Number(selectedBudget !== null) + Number(selectedDuration !== null) + selectedLocations.length;

  const clearFilters = () => {
    setSelectedBudget(null);
    setSelectedDuration(null);
    setSelectedLocations([]);
    setCurrentPage(1);
  };
  const changeSort = (value: PackageSortOption) => {
    setSortBy(value);
    setCurrentPage(1);
  };

  const filterPanel = (
    <PackageFilters
      selectedBudget={selectedBudget}
      selectedDuration={selectedDuration}
      locations={locations}
      selectedLocations={selectedLocations}
      onBudgetChange={(range) => {
        setSelectedBudget(range);
        setCurrentPage(1);
      }}
      onDurationChange={(range) => {
        setSelectedDuration(range);
        setCurrentPage(1);
      }}
      onLocationsChange={(nextLocations) => {
        setSelectedLocations(nextLocations);
        setCurrentPage(1);
      }}
      onClearFilters={clearFilters}
      onClose={() => setShowMobileFilters(false)}
    />
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" role="status" aria-label="Loading packages">
        <div className="h-16 w-16 animate-spin rounded-full border-b-4 border-t-4 border-brand-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center" role="alert">
          <h2 className="mb-4 text-2xl font-bold text-gray-900">Unable to load packages</h2>
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
    <div className="flex min-h-screen flex-col bg-gray-50 font-sans">
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
            Travel Packages
          </h1>
          <p className="max-w-xl text-base font-light leading-6 text-white/90 sm:text-lg">
            Discover thoughtfully planned trips, with options for every destination and budget.
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
                  {filteredPackages.length === 0
                    ? 0
                    : `${startIndex + 1}–${Math.min(startIndex + PACKAGES_PER_PAGE, filteredPackages.length)}`}
                </span>{' '}
                of {filteredPackages.length} packages
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
              <label htmlFor="packages-sort" className="shrink-0 text-gray-500">Sort by:</label>
              <select
                id="packages-sort"
                aria-label="Sort packages"
                value={sortBy}
                onChange={(event) => changeSort(event.target.value as PackageSortOption)}
                className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800 outline-none transition-colors hover:border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="popularity">Most Popular</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="duration">Shortest Trip</option>
              </select>
            </div>
          </div>

          {visiblePackages.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {visiblePackages.map((pkg) => (
                <PackageCard
                  key={pkg.id || pkg.slug}
                  id={pkg.id || pkg.slug}
                  image={pkg.image_url}
                  days={pkg.duration_days}
                  title={pkg.title}
                  location={pkg.destination.raw || pkg.destinationRaw}
                  price={pkg.price_from}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-white px-6 py-16 text-center">
              <h2 className="mb-2 text-xl font-semibold text-slate-800">
                {packages.length === 0 ? 'No packages available yet' : 'No packages match these filters'}
              </h2>
              <p className="mb-6 text-sm text-gray-600">
                {packages.length === 0
                  ? 'Please check back soon for available trips.'
                  : 'Try another budget or trip duration.'}
              </p>
              {(selectedBudget || selectedDuration || selectedLocations.length > 0) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-xl bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
                >
                  Clear filters
                </button>
              )}
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

export default PackagesPage;
