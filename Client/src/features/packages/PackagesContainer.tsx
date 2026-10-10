import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Filter, LoaderCircle } from 'lucide-react';
import { fetchPackages } from '../../services/api/packages';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import type { NormalizedPackage } from '../../services/api/packages.transform';
import type { RangeOption } from '@/components/shared/RangeFilterGroup';
import { DURATION_OPTIONS, PRICE_RANGE_OPTIONS } from './filterOptions';
import HeroSection from './components/HeroSection';
import Toolbar from './components/Toolbar';
import FiltersSidebar from './components/FiltersSidebar';
import PackageCard from '../../components/shared/PackageCard';
import PackageListItem from './components/PackageListItem';
import Pagination from './components/Pagination';
import { Button } from '../../components/ui/button';
import { formatCurrency } from '../../lib/currency';
import { useAssistantViewReport } from '../assistant/capabilities/AssistantCapabilityProvider';
import { pluralize } from '../../lib/pluralize';
import { categoryImage } from '../../config/media';

export type SortOption = 'popularity' | 'price-low' | 'price-high' | 'duration';
export type ViewMode = 'grid' | 'list';

/** A package enriched with the display-oriented duration label used by the cards. */
export interface EnrichedPackage extends NormalizedPackage {
  durationLabel: string;
}

const SORT_OPTIONS: SortOption[] = ['popularity', 'price-low', 'price-high', 'duration'];
const ITEMS_PER_PAGE = 12;

/** Absent, empty and unparseable all mean "this filter is not set". */
const numberParam = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const sortParam = (value: string | null): SortOption =>
  SORT_OPTIONS.includes(value as SortOption) ? (value as SortOption) : 'popularity';

const viewParam = (value: string | null): ViewMode => (value === 'list' ? 'list' : 'grid');

const budgetLabel = (min: number | null, max: number | null): string => {
  if (min !== null && max !== null) return `${formatCurrency(min)} – ${formatCurrency(max)}`;
  if (max !== null) return `Below ${formatCurrency(max)}`;
  return `Above ${formatCurrency(min ?? 0)}`;
};

const durationLabel = (min: number | null, max: number | null): string => {
  if (min !== null && max !== null) return `${min}-${max} days`;
  if (max !== null) return `Up to ${max} days`;
  return `${min ?? 0}+ days`;
};

/**
 * The packages catalogue.
 *
 * Every filter lives in the URL rather than in component state, for three
 * reasons that compound: a filtered view is a shareable link, the back button
 * returns the previous filter state, and a filter can be set by navigating —
 * which is what lets the site-wide assistant drive this page through the
 * router instead of reaching into component internals.
 *
 * Filtering, sorting and pagination are all applied by package-service, so the
 * result set and its total are the real ones. They used to be computed here
 * over a single capped page of 100 packages, which meant a count could
 * disagree with the catalogue it claimed to describe.
 */
export default function PackagesContainer() {
  const [searchParams, setSearchParams] = useSearchParams();

  // `state` and `country` are aliases the destinations page has always linked
  // with; all three address the same thing, so they collapse into one value.
  const destinationParam = (
    searchParams.get('destination') ||
    searchParams.get('state') ||
    searchParams.get('country') ||
    ''
  ).toLowerCase();
  const categoryQuery = searchParams.get('category');

  const priceMin = numberParam(searchParams.get('priceMin'));
  const priceMax = numberParam(searchParams.get('priceMax'));
  const durationMin = numberParam(searchParams.get('durationMin'));
  const durationMax = numberParam(searchParams.get('durationMax'));
  const minRating = numberParam(searchParams.get('rating')) ?? 0;
  const sortBy = sortParam(searchParams.get('sort'));
  const viewMode = viewParam(searchParams.get('view'));
  const currentPage = numberParam(searchParams.get('page')) ?? 1;

  const [packages, setPackages] = useState<NormalizedPackage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(
    typeof window !== 'undefined' ? window.innerWidth > 1400 : false,
  );
  const [isVisible, setIsVisible] = useState(false);

  // The sidebar opens itself on wide viewports, but only until someone says
  // otherwise. Without this flag every resize silently re-closes a panel that
  // was deliberately opened — a phone keyboard opening is enough to trigger it.
  const filtersPinnedRef = useRef(false);
  const setFiltersVisible = useCallback((next: boolean) => {
    filtersPinnedRef.current = true;
    setShowFilters(next);
  }, []);

  useEffect(() => setIsVisible(true), []);

  useEffect(() => {
    const handleResize = () => {
      if (filtersPinnedRef.current) return;
      setShowFilters(window.innerWidth > 1400);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /**
   * Writes filters into the URL. A patch of `null` clears a key.
   *
   * History is pushed, not replaced, so the back button steps back through
   * filter changes rather than out of the page.
   */
  const updateParams = useCallback(
    (patch: Record<string, string | null>, { resetPage = true }: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      });
      // Collapse the destination aliases into the canonical key so one
      // destination is never expressed two ways in the same link.
      if ('destination' in patch) {
        next.delete('state');
        next.delete('country');
      }
      if (resetPage) next.delete('page');
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchPackages({
      destination: destinationParam || undefined,
      category: categoryQuery || undefined,
      minPrice: priceMin ?? undefined,
      maxPrice: priceMax ?? undefined,
      durationMin: durationMin ?? undefined,
      durationMax: durationMax ?? undefined,
      minRating: minRating > 0 ? minRating : undefined,
      sort: sortBy,
      page: currentPage,
      limit: ITEMS_PER_PAGE,
    })
      .then(({ packages: list, pagination }) => {
        if (!isMounted) return;
        setPackages(list);
        setTotal(pagination?.total ?? list.length);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(apiErrorMessage(err));
        setPackages([]);
        setTotal(0);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [
    destinationParam,
    categoryQuery,
    priceMin,
    priceMax,
    durationMin,
    durationMax,
    minRating,
    sortBy,
    currentPage,
  ]);

  // What the assistant may say about this screen, from the page's own numbers:
  // `total` is the service's filtered count for the URL's filters (the catalogue
  // is filtered server-side) and `packages.length` is what this page of results
  // actually drew. Registered while the page is mounted, so a question about the
  // screen is answered from the screen and not from the page the visitor left.
  const assistantView = useMemo(
    () => ({
      path: '/packages',
      params: Object.fromEntries(searchParams.entries()),
      filteredCount: total,
      renderedCount: packages.length,
    }),
    [searchParams, total, packages.length],
  );
  useAssistantViewReport(assistantView);

  // A URL carries bounds, the sidebar renders labelled bands, and
  // RangeFilterGroup decides what is checked by comparing labels — so a URL
  // is matched back to the band it came from. A budget that matches no band
  // (the assistant can name any number) still reads as a selection.
  const selectedPriceRange = useMemo<RangeOption | null>(() => {
    if (priceMin === null && priceMax === null) return null;
    const match = PRICE_RANGE_OPTIONS.find(
      (option) => option.min === (priceMin ?? 0) && option.max === (priceMax ?? Infinity),
    );
    return match ?? { label: budgetLabel(priceMin, priceMax), min: priceMin ?? 0, max: priceMax ?? Infinity };
  }, [priceMin, priceMax]);

  const selectedDuration = useMemo<RangeOption | null>(() => {
    if (durationMin === null && durationMax === null) return null;
    const match = DURATION_OPTIONS.find(
      (option) => option.min === (durationMin ?? 0) && option.max === (durationMax ?? Infinity),
    );
    return match ?? { label: durationLabel(durationMin, durationMax), min: durationMin ?? 0, max: durationMax ?? Infinity };
  }, [durationMin, durationMax]);

  const enrichedPackages = useMemo<EnrichedPackage[]>(
    () =>
      packages.map((pkg) => {
        const nights = Math.max(pkg.duration_days - 1, 1);
        return {
          ...pkg,
          durationLabel: pkg.duration_days ? `${pkg.duration_days}D/${nights}N` : '',
        };
      }),
    [packages],
  );

  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  const activeFiltersCount = [selectedPriceRange, selectedDuration, minRating > 0 ? minRating : null]
    .filter(Boolean).length;

  const clearAllFilters = () =>
    updateParams({ priceMin: null, priceMax: null, durationMin: null, durationMax: null, rating: null });

  if (loading && packages.length === 0) {
    return (
      <main aria-busy="true" className="flex min-h-screen items-center justify-center bg-white">
        <LoaderCircle aria-label="Loading packages" role="status" className="h-6 w-6 animate-spin text-brand-600" />
      </main>
    );
  }
  if (error) return <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" role="alert"><div className="max-w-md text-center"><h2 className="text-2xl font-bold text-gray-900 mb-4">We ran into an issue</h2><p className="text-gray-600 mb-6">{error}</p><button onClick={() => window.location.reload()} className="px-6 py-3 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-700">Try again</button></div></div>;

  // The destination's own name comes from the returned packages, which all
  // match it; an empty result falls back to the slug so the heading is never
  // blank.
  const destinationLabel = destinationParam
    ? packages[0]?.destination?.name ||
      destinationParam.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    : 'All Destinations';
  const destinationTypeLabel = destinationParam ? 'International' : 'Curated';
  const categoryLabel = categoryQuery
    ? categoryQuery.charAt(0).toUpperCase() + categoryQuery.slice(1)
    : null;

  return (
    <div className="min-h-screen bg-white">
      <HeroSection
        isVisible={isVisible}
        title={categoryLabel || destinationLabel}
        subtitle={`${categoryLabel ? categoryLabel + ' Packages' : destinationTypeLabel} • ${pluralize(total, 'package')} available`}
      />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Sticky Toolbar */}
        <Toolbar
          showFilters={showFilters}
          onToggleFilters={() => setFiltersVisible(!showFilters)}
          activeFiltersCount={activeFiltersCount}
          onClearAllFilters={clearAllFilters}
          sortBy={sortBy}
          onSortChange={(value) => updateParams({ sort: value === 'popularity' ? null : value })}
          viewMode={viewMode}
          onViewModeChange={(mode) => updateParams({ view: mode === 'grid' ? null : mode }, { resetPage: false })}
        />
        {showFilters && (
          <div className="block 2xl:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-elevated" onClick={() => setFiltersVisible(false)} />
        )}

        <div className="flex flex-col md:flex-row gap-4 md:gap-8 relative">
          {/* Filters */}
          {showFilters && (
            <FiltersSidebar
              selectedPriceRange={selectedPriceRange}
              selectedDuration={selectedDuration}
              minRating={minRating}
              onPriceRangeChange={(range) =>
                updateParams(
                  range
                    ? {
                        priceMin: range.min > 0 ? String(range.min) : null,
                        priceMax: Number.isFinite(range.max) ? String(range.max) : null,
                      }
                    : { priceMin: null, priceMax: null },
                )
              }
              onDurationChange={(range) =>
                updateParams(
                  range
                    ? {
                        durationMin: String(range.min),
                        durationMax: Number.isFinite(range.max) ? String(range.max) : null,
                      }
                    : { durationMin: null, durationMax: null },
                )
              }
              onMinRatingChange={(rating) => updateParams({ rating: rating > 0 ? String(rating) : null })}
              onClose={() => setFiltersVisible(false)}
            />
          )}

          {/* Packages */}
          <div className="flex-1">
            {enrichedPackages.length === 0 ? (
              <div className="text-center py-24 bg-gray-50 rounded-2xl">
                <Filter className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">No packages found</h3>
                <p className="text-gray-600 mb-8">Try adjusting your filters</p>
                <Button
                  type="button"
                  variant="default"
                  size="lg"
                  onClick={clearAllFilters}
                  className="h-12 rounded-xl bg-brand-600 px-8 font-semibold text-white hover:bg-brand-700"
                >
                  Clear all filters
                </Button>
              </div>
            ) : viewMode === 'grid' ? (
              <>
                <div className={`grid gap-4 md:gap-6 lg:gap-8 ${showFilters ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                  {enrichedPackages.map(pkg => (
                    <PackageCard
                      key={pkg.id}
                      href={`/package/${pkg.id}`}
                      image={pkg.images?.[0] || pkg.image_url}
                      fallbackImage={categoryImage(pkg.category)}
                      title={pkg.title}
                      price={formatCurrency(pkg.price_from)}
                      description={pkg.description}
                      overlayMeta={
                        <>
                          <Clock className="size-4 text-brand-accent-300" />
                          <span className="text-sm font-medium">{pkg.durationLabel}</span>
                        </>
                      }
                      meta={
                        <div className="flex items-center justify-between">
                          <div className="flex-1 text-center">
                            <div className="text-sm font-bold text-gray-900">{pkg.durationLabel}</div>
                            <p className="mt-1 text-xs text-gray-500">Duration</p>
                          </div>
                          <div aria-hidden="true" className="h-9 w-px bg-gray-200" />
                          <div className="flex-1 text-center">
                            <div className="text-sm font-bold text-gray-900">{pkg.rating || 'N/A'}</div>
                            <p className="mt-1 text-xs text-gray-500">Rating</p>
                          </div>
                        </div>
                      }
                    />
                  ))}
                </div>
                {totalPages > 1 && (
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={(page) => updateParams({ page: page > 1 ? String(page) : null }, { resetPage: false })}
                  />
                )}
              </>
            ) : (
              <>
                <div className={`space-y-6 transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
                  {enrichedPackages.map(pkg => (
                    <PackageListItem key={pkg.id} pkg={pkg} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={(page) => updateParams({ page: page > 1 ? String(page) : null }, { resetPage: false })}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1); }
        }
        .animate-twinkle {
          animation: twinkle 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
