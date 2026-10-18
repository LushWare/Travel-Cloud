import { useState, useEffect, useMemo } from 'react';
import { Filter, LoaderCircle, X } from 'lucide-react';
import { fetchPackages } from '../../services/api/packages';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import type { AggregatedDestination } from '../../services/api/packages.transform';
import HeroSection from './components/HeroSection';
import Toolbar from './components/Toolbar';
import FiltersSidebar, { type PriceRange } from './components/FiltersSidebar';
import DestinationCard from './components/DestinationCard';
import DestinationListItem from './components/DestinationListItem';

export type SortOption = 'popularity' | 'price-low' | 'price-high' | 'name';
export type ViewMode = 'grid' | 'list';

/** A destination with the display-oriented defaults applied by this container. */
export interface PreparedDestination extends AggregatedDestination {
  duration: string;
}

export default function DestinationsContainer() {
  const [destinations, setDestinations] = useState<AggregatedDestination[]>([]);
  const [filteredDestinations, setFilteredDestinations] = useState<PreparedDestination[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>(['All']);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [selectedPriceRange, setSelectedPriceRange] = useState<PriceRange | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>('popularity');
  const [showFilters, setShowFilters] = useState(typeof window !== 'undefined' ? window.innerWidth > 1400 : false);
  const [activeFiltersCount, setActiveFiltersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => setIsVisible(true), []);

  useEffect(() => {
    const handleResize = () => {
      setShowFilters(window.innerWidth > 1400);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchPackages({ limit: 100 })
      .then(({ destinations: dest }) => {
        if (!isMounted) return;
        setDestinations(dest);
      })
      .catch(err => {
        if (!isMounted) return;
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });
    return () => { isMounted = false; };
  }, []);

  const preparedDestinations = useMemo<PreparedDestination[]>(() => (
    destinations.map(dest => ({
      ...dest,
      price: dest.price || 0,
      rating: dest.rating || 0,
      reviews: dest.reviews || 0,
      duration: dest.durationLabel || 'Flexible',
      packagesCount: dest.packagesCount || 0,
      country: dest.country || dest.region || 'Worldwide',
    }))
  ), [destinations]);

  const countriesByRegion = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    preparedDestinations.forEach(dest => {
      const region = dest.region || 'Other';
      if (!map[region]) map[region] = new Set();
      if (dest.country) map[region].add(dest.country);
    });
    return Object.fromEntries(
      Object.entries(map).map(([r, c]) => [r, Array.from(c).sort()])
    );
  }, [preparedDestinations]);

  useEffect(() => {
    let filtered = [...preparedDestinations];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d =>
        d.name?.toLowerCase().includes(q) ||
        d.country?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q)
      );
    }
    if (!selectedRegions.includes('All')) filtered = filtered.filter(d => selectedRegions.includes(d.region));
    if (selectedCountries.length > 0) filtered = filtered.filter(d => selectedCountries.includes(d.country));
    if (selectedPriceRange) filtered = filtered.filter(d => d.price >= selectedPriceRange.min && d.price <= selectedPriceRange.max);
    if (minRating > 0) filtered = filtered.filter(d => d.rating >= minRating);

    switch (sortBy) {
      case 'popularity': filtered.sort((a, b) => b.packagesCount - a.packagesCount); break;
      case 'price-low': filtered.sort((a, b) => a.price - b.price); break;
      case 'price-high': filtered.sort((a, b) => b.price - a.price); break;
      case 'name': filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    setFilteredDestinations(filtered);

    let count = 0;
    if (!selectedRegions.includes('All')) count += selectedRegions.length;
    if (selectedCountries.length > 0) count += selectedCountries.length;
    if (selectedActivities.length > 0) count += selectedActivities.length;
    if (selectedPriceRange) count += 1;
    if (minRating > 0) count += 1;
    setActiveFiltersCount(count);
    setCurrentPage(1);
  }, [preparedDestinations, searchQuery, selectedRegions, selectedCountries, selectedActivities, selectedPriceRange, minRating, sortBy]);

  const toggleCountry = (c: string) => setSelectedCountries(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c]);
  const toggleRegion = (r: string) => {
    if (r === 'All') { setSelectedRegions(['All']); setSelectedCountries([]); return; }
    setSelectedRegions(p => {
      const next = new Set(p.filter(x => x !== 'All'));
      if (next.has(r)) next.delete(r); else next.add(r);
      return next.size === 0 ? ['All'] : Array.from(next);
    });
  };
  const clearAllFilters = () => {
    setSearchQuery(''); setSelectedRegions(['All']); setSelectedCountries([]); setSelectedActivities([]); setSelectedPriceRange(null); setMinRating(0);
    setCurrentPage(1);
  };

  const paginatedDestinations = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredDestinations.slice(startIndex, endIndex);
  }, [filteredDestinations, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredDestinations.length / itemsPerPage);

  if (loading && destinations.length === 0) {
    return (
      <main aria-busy="true" className="flex min-h-screen items-center justify-center bg-white">
        <LoaderCircle aria-label="Loading destinations" role="status" className="h-6 w-6 animate-spin text-brand-600" />
      </main>
    );
  }
  if (error) return <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" role="alert"><div className="max-w-md text-center"><h2 className="text-2xl font-bold text-gray-900 mb-4">Unable to load destinations</h2><p className="text-gray-600 mb-6">{error}</p><button onClick={() => window.location.reload()} className="px-6 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700">Try again</button></div></div>;

  return (
    <div className="min-h-screen bg-white">
      <HeroSection isVisible={isVisible} destinationCount={destinations.length} />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Sticky Toolbar */}
        <Toolbar
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((prev) => !prev)}
          activeFiltersCount={activeFiltersCount}
          onClearAllFilters={clearAllFilters}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          destinationCount={filteredDestinations.length}
        />
        {showFilters && (
          <div className="block 2xl:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-elevated" onClick={() => setShowFilters(false)} />
        )}

        <div className="flex flex-col md:flex-row gap-4 md:gap-8 relative">
          {showFilters && (
            <FiltersSidebar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedRegions={selectedRegions}
              onToggleRegion={toggleRegion}
              countriesByRegion={countriesByRegion}
              selectedCountries={selectedCountries}
              onToggleCountry={toggleCountry}
              selectedPriceRange={selectedPriceRange}
              onPriceRangeChange={setSelectedPriceRange}
              minRating={minRating}
              onMinRatingChange={setMinRating}
              onClose={() => setShowFilters(false)}
            />
          )}

          <div className="flex-1">
            {filteredDestinations.length === 0 ? (
              <div className="text-center px-6 py-24 bg-gray-50 rounded-2xl">
                <Filter className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <h3 className="text-2xl font-bold text-gray-900 mb-2">No destinations found</h3>
                <p className="text-gray-600 mb-6">Try adjusting your filters</p>
                <button
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold text-sm transition-colors duration-300"
                >
                  <X className="w-4 h-4" />
                  Clear all filters
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className={`grid gap-4 md:gap-5 lg:gap-6 ${showFilters ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                {paginatedDestinations.map(dest => (
                  <DestinationCard key={dest.id} dest={dest} />
                ))}
              </div>
            ) : (
              /* LIST VIEW */
              <div className="space-y-6">
                {paginatedDestinations.map(dest => (
                  <DestinationListItem key={dest.id} dest={dest} />
                ))}
              </div>
            )}
            {filteredDestinations.length > itemsPerPage && (
              <div className="flex items-center justify-between mt-12 pt-8 border-t border-gray-200">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-6 py-3 bg-gray-100 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 hover:text-white rounded-xl font-semibold transition-colors duration-300"
                >
                  ← Previous
                </button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-10 h-10 rounded-xl font-semibold transition-colors duration-300 ${currentPage === page
                          ? 'bg-brand-600 text-white'
                          : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                        }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-6 py-3 bg-gray-100 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 hover:text-white rounded-xl font-semibold transition-colors duration-300"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
