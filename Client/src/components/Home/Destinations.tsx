import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Compass, MapPin, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchPackages } from '@/services/api/packages';
import { aggregateDestinations, type AggregatedDestination } from '@/services/api/packages.transform';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';

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

const PopularDestinations = () => {
  const [destinations, setDestinations] = useState<AggregatedDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideStep, setSlideStep] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 640);
  const firstCardRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const loadDestinations = async () => {
      const firstPage = await fetchPackages({ limit: 100 });
      const remainingPages = await Promise.all(
        Array.from({ length: getTotalPages(firstPage.pagination) - 1 }, (_, index) =>
          fetchPackages({ limit: 100, page: index + 2 }),
        ),
      );
      return aggregateDestinations(
        [firstPage, ...remainingPages].flatMap(({ packages }) => packages),
      ).sort((a, b) => b.packagesCount - a.packagesCount);
    };

    loadDestinations()
      .then((packagesDestinations) => {
        if (mounted) {
          setSlideIndex(0);
          setTransitionEnabled(true);
          setDestinations(packagesDestinations);
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
    const updateMobileViewport = () => setIsMobileViewport(window.innerWidth < 640);
    window.addEventListener('resize', updateMobileViewport);
    return () => window.removeEventListener('resize', updateMobileViewport);
  }, []);

  useEffect(() => {
    const updateSlideStep = () => {
      const card = firstCardRef.current;
      if (!card?.parentElement) return;
      const gap = Number.parseFloat(getComputedStyle(card.parentElement).columnGap) || 0;
      setSlideStep(card.getBoundingClientRect().width + gap);
    };

    updateSlideStep();
    window.addEventListener('resize', updateSlideStep);
    return () => window.removeEventListener('resize', updateSlideStep);
  }, [destinations.length]);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (destinations.length <= 5 || isMobileViewport || prefersReducedMotion) return;

    const intervalId = window.setInterval(() => {
      setSlideIndex((currentIndex) => Math.min(currentIndex + 1, destinations.length));
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [destinations.length, isMobileViewport]);

  useEffect(() => {
    if (transitionEnabled) return;
    const frameId = window.requestAnimationFrame(() => setTransitionEnabled(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [transitionEnabled]);

  const handleTrackTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || slideIndex !== destinations.length) return;
    setTransitionEnabled(false);
    setSlideIndex(0);
  };

  return (
    <section className="relative z-10 flow-root bg-white">
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-20 z-0 h-20 w-full sm:-top-24 sm:h-24 md:-top-28 md:h-28"
        preserveAspectRatio="none"
        viewBox="0 0 1440 140"
      >
        <path
          d="M0 54C180 91 379 112 590 83C818 51 1005 24 1197 43C1296 53 1375 73 1440 89V140H0V54Z"
          fill="#ffffff"
        />
        <path
          d="M0 54C180 91 379 112 590 83C818 51 1005 24 1197 43C1296 53 1375 73 1440 89"
          fill="none"
          stroke="#07c26b"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 54C180 91 379 112 590 83C818 51 1005 24 1197 43C1296 53 1375 73 1440 89"
          fill="none"
          stroke="#04713b"
          strokeWidth="4"
          transform="translate(0 8)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="relative z-20 mx-auto -mt-24 max-w-6xl px-6">
        <nav
          aria-label="Explore travel options"
          className="grid grid-cols-1 divide-y divide-gray-100 rounded-2xl bg-white p-3 shadow-[0_18px_28px_-8px_rgba(15,23,42,0.3)] md:grid-cols-3 md:divide-x md:divide-y-0"
        >
          <Link
            to="/destinations"
            className="group flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-gray-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#16a34a]">
              <MapPin className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">Explore Destinations</span>
              <span className="mt-1 block text-xs text-gray-500">Find a place you will love</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-[#16a34a]" />
          </Link>

          <Link
            to="/packages"
            className="group flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-gray-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#16a34a]">
              <Compass className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">Browse Travel Packages</span>
              <span className="mt-1 block text-xs text-gray-500">Discover handpicked trips</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-[#16a34a]" />
          </Link>

          <Link
            to="/planner"
            className="group flex items-center gap-4 rounded-xl p-4 transition-colors hover:bg-gray-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[#16a34a]">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">Plan a Custom Trip</span>
              <span className="mt-1 block text-xs text-gray-500">Create your own itinerary</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-1 group-hover:text-[#16a34a]" />
          </Link>
        </nav>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl bg-white px-6 pb-24 pt-24">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="mb-2 font-serif text-3xl leading-tight text-slate-800 sm:text-4xl md:text-5xl">Popular Destinations</h2>
            <p className="text-gray-500">Handpicked destinations for your next escape</p>
          </div>
          <Link to="/destinations" className="flex items-center gap-1 text-sm font-medium text-[#16a34a] hover:underline">
            View All Destinations <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-gray-500">Loading destinations...</p>
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
        ) : destinations.length === 0 ? (
          <p className="text-sm text-gray-500">No destinations are available yet.</p>
        ) : (
          <div className="overflow-hidden" role="region" aria-label="Popular destinations carousel">
            <div
              className={`destination-carousel-track flex gap-4 lg:gap-5 ${transitionEnabled ? 'transition-transform duration-700 ease-in-out motion-reduce:transition-none' : 'transition-none'}`}
              onTransitionEnd={handleTrackTransitionEnd}
              style={{ transform: `translateX(-${slideIndex * slideStep}px)` }}
            >
              {[...destinations, ...(destinations.length > 5 ? destinations.slice(0, 5) : [])].map((destination, index) => {
                const isDuplicate = index >= destinations.length;
                return (
                  <Link
                    key={isDuplicate ? `clone-${destination.id}-${index}` : destination.id}
                    ref={index === 0 ? firstCardRef : undefined}
                    to={`/packages?destination=${encodeURIComponent(destination.slug)}`}
                    tabIndex={isDuplicate ? -1 : undefined}
                    aria-hidden={isDuplicate || undefined}
                    className="destination-carousel-card group relative h-[340px] shrink-0 overflow-hidden rounded-2xl bg-slate-200 shadow-sm transition-shadow hover:shadow-md sm:h-[360px]"
                  >
                    {destination.image_url && (
                      <img
                        src={destination.image_url}
                        alt={isDuplicate ? '' : destination.name}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />
                    <div className="absolute bottom-4 left-4 right-4 z-20 flex items-end justify-between sm:bottom-5 sm:left-5 sm:right-5">
                      <div className="min-w-0">
                        <h3 className="mb-1 truncate text-lg font-semibold text-white sm:text-xl">{destination.name}</h3>
                        <div className="flex items-center gap-1 text-sm text-white/90">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{destination.country || destination.region}</span>
                        </div>
                      </div>
                      <div className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/60 text-white transition-colors group-hover:bg-white group-hover:text-slate-800">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
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

export default PopularDestinations;
