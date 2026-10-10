import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bed, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchPackages } from '@/services/api/packages';
import type { NormalizedPackage } from '@/services/api/packages.transform';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import { formatCurrency } from '@/lib/currency';

const PAGE_SIZE = 100;
const AUTOPLAY_INTERVAL_MS = 4_000;

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

const getVisibleCardCount = (): number => {
  if (typeof window === 'undefined') return 1;
  if (window.innerWidth >= 1024) return 4;
  if (window.innerWidth >= 640) return 2;
  return 1;
};

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PopularPackages = () => {
  const [packages, setPackages] = useState<NormalizedPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [visibleCardCount, setVisibleCardCount] = useState(getVisibleCardCount);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideStep, setSlideStep] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const firstCardRef = useRef<HTMLAnchorElement>(null);

  const canSlide = packages.length > visibleCardCount;
  const cloneCount = canSlide ? visibleCardCount : 0;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const loadPackages = async () => {
      const firstPage = await fetchPackages({ limit: PAGE_SIZE });
      const remainingPages = await Promise.all(
        Array.from({ length: getTotalPages(firstPage.pagination) - 1 }, (_, index) =>
          fetchPackages({ limit: PAGE_SIZE, page: index + 2 }),
        ),
      );
      return [firstPage, ...remainingPages].flatMap(({ packages: pagePackages }) => pagePackages);
    };

    loadPackages()
      .then((allPackages) => {
        if (mounted) {
          setSlideIndex(0);
          setTransitionEnabled(true);
          setPackages(allPackages);
        }
      })
      .catch((err: Error) => {
        if (mounted) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [retryCount]);

  useEffect(() => {
    const updateVisibleCardCount = () => setVisibleCardCount(getVisibleCardCount());
    window.addEventListener('resize', updateVisibleCardCount);
    return () => window.removeEventListener('resize', updateVisibleCardCount);
  }, []);

  useEffect(() => {
    setSlideIndex(0);
  }, [visibleCardCount]);

  useEffect(() => {
    const card = firstCardRef.current;
    if (!card?.parentElement) return;
    const gap = Number.parseFloat(getComputedStyle(card.parentElement).columnGap) || 0;
    setSlideStep(card.getBoundingClientRect().width + gap);
  }, [packages.length, cloneCount, visibleCardCount]);

  useEffect(() => {
    if (!canSlide || visibleCardCount === 1 || prefersReducedMotion()) return;

    const intervalId = window.setInterval(() => {
      setSlideIndex((currentIndex) => Math.min(currentIndex + 1, packages.length));
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [canSlide, packages.length, visibleCardCount]);

  useEffect(() => {
    if (transitionEnabled) return;
    const frameId = window.requestAnimationFrame(() => setTransitionEnabled(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [transitionEnabled]);

  const handleTrackTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (slideIndex === packages.length) {
      setTransitionEnabled(false);
      setSlideIndex(0);
    } else if (slideIndex === -1) {
      setTransitionEnabled(false);
      setSlideIndex(packages.length - 1);
    }
  };

  const moveNext = () => {
    if (prefersReducedMotion()) {
      setSlideIndex((currentIndex) => (currentIndex + 1) % packages.length);
      return;
    }
    setSlideIndex((currentIndex) => Math.min(currentIndex + 1, packages.length));
  };

  const movePrevious = () => {
    if (prefersReducedMotion()) {
      setSlideIndex((currentIndex) => (currentIndex - 1 + packages.length) % packages.length);
      return;
    }
    setSlideIndex((currentIndex) => Math.max(currentIndex - 1, -1));
  };

  return (
    <section className="w-full bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 sm:min-w-[auto]">
            <h2 className="mb-2 font-serif text-3xl leading-tight text-slate-800 sm:text-5xl md:text-6xl">Popular Travel Packages</h2>
            <p className="text-base text-gray-500">Carefully designed packages for every kind of traveler</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {canSlide && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Show previous packages"
                  onClick={movePrevious}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-700 transition-colors hover:bg-gray-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Show next packages"
                  onClick={moveNext}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-700 transition-colors hover:bg-gray-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <Link to="/packages" className="flex items-center gap-1 text-sm font-medium text-[#16a34a] hover:underline">
              View All Packages <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-gray-500">Loading packages...</p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              className="font-medium text-[#16a34a] hover:underline"
            >
              Try again
            </button>
          </div>
        ) : packages.length === 0 ? (
          <p className="text-sm text-gray-500">No travel packages are available yet.</p>
        ) : (
          <div className="overflow-hidden pb-3" role="region" aria-label="Popular travel packages carousel">
            <div
              className={`flex gap-6 ${transitionEnabled ? 'transition-transform duration-700 ease-in-out motion-reduce:transition-none' : 'transition-none'}`}
              onTransitionEnd={handleTrackTransitionEnd}
              style={{ transform: `translateX(-${(cloneCount + slideIndex) * slideStep}px)` }}
            >
              {[
                ...(cloneCount ? packages.slice(-cloneCount) : []),
                ...packages,
                ...(cloneCount ? packages.slice(0, cloneCount) : []),
              ].map((pkg, index) => {
                const isDuplicate = index < cloneCount || index >= cloneCount + packages.length;
                const packageIndex = (index - cloneCount + packages.length) % packages.length;
                const packageId = pkg.id || pkg.slug;
                const nights = Math.max(pkg.duration_days - 1, 0);
                return (
                  <Link
                    key={isDuplicate ? `clone-${pkg.id || pkg.slug}-${index}` : pkg.id || pkg.slug}
                    ref={index === cloneCount ? firstCardRef : undefined}
                    to={`/packages/${packageId}`}
                    tabIndex={isDuplicate ? -1 : undefined}
                    aria-hidden={isDuplicate || undefined}
                    className="group flex w-full basis-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 border-b-2 border-b-slate-300 bg-white shadow-md transition-all duration-300 hover:border-emerald-300 hover:shadow-lg sm:w-[calc((100%-1.5rem)/2)] sm:basis-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-4.5rem)/4)] lg:basis-[calc((100%-4.5rem)/4)]"
                  >
                    <div className="relative h-48">
                      {pkg.image_url && (
                        <img
                          src={pkg.image_url}
                          alt={isDuplicate ? '' : pkg.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      )}
                      <div className="absolute top-3 left-3 rounded-full bg-[#16a34a]/90 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                        {pkg.duration_days} Days / {nights} Nights
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="mb-1 text-lg font-semibold text-slate-800">{pkg.title}</h3>
                      <p className="mb-4 truncate text-xs text-gray-500">
                        {pkg.destinationRaw || pkg.destination.country || pkg.destination.region}
                      </p>
                      <div className="mb-6 flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {pkg.duration_days} Days</span>
                        <span className="flex items-center gap-1"><Bed className="h-3.5 w-3.5" /> {nights} Nights</span>
                      </div>
                      <div className="mt-auto flex items-center justify-between border-t-2 border-slate-200 pt-4">
                        <div className="text-xs text-gray-500">
                          From <span className="ml-1 text-lg font-bold text-slate-800">{formatCurrency(pkg.price_from)}</span> / person
                        </div>
                        <span className="rounded-full p-1.5 text-[#16a34a] transition-colors group-hover:bg-[#16a34a]/10">
                          <ArrowRight className="h-5 w-5" />
                        </span>
                      </div>
                    </div>
                    <span className="sr-only">Package {packageIndex + 1} of {packages.length}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default PopularPackages;
