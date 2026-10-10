import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Quote, Star } from 'lucide-react';
import { fetchPackageReviews, fetchPackages } from '@/services/api/packages';
import type { NormalizedPackage } from '@/services/api/packages.transform';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';

const PAGE_SIZE = 100;
const MAX_REVIEWED_PACKAGES = 8;
const MAX_TESTIMONIALS = 24;
const AUTOPLAY_INTERVAL_MS = 5_000;

type Testimonial = {
  id: string;
  packageId: string;
  packageTitle: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
};

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
  if (window.innerWidth >= 768) return 3;
  if (window.innerWidth >= 640) return 2;
  return 1;
};

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Testimonials = () => {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [visibleCardCount, setVisibleCardCount] = useState(getVisibleCardCount);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideStep, setSlideStep] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const firstCardRef = useRef<HTMLDivElement>(null);

  const canSlide = testimonials.length > visibleCardCount;
  const cloneCount = canSlide ? visibleCardCount : 0;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const loadTestimonials = async () => {
      const firstPage = await fetchPackages({ limit: PAGE_SIZE });
      const remainingPages = await Promise.all(
        Array.from({ length: getTotalPages(firstPage.pagination) - 1 }, (_, index) =>
          fetchPackages({ limit: PAGE_SIZE, page: index + 2 }),
        ),
      );
      const packages = [firstPage, ...remainingPages]
        .flatMap(({ packages: pagePackages }) => pagePackages)
        .filter((pkg): pkg is NormalizedPackage & { id: string } => Boolean(pkg.id) && pkg.reviews_count > 0)
        .sort((a, b) => b.reviews_count - a.reviews_count)
        .slice(0, MAX_REVIEWED_PACKAGES);

      const packageReviews = await Promise.all(
        packages.map(async (pkg) => {
          const { reviews } = await fetchPackageReviews(pkg.id);
          return reviews.map((review) => ({
            id: review.id,
            packageId: pkg.id,
            packageTitle: pkg.title,
            name: review.name?.trim() || 'Traveler',
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt || '',
          }));
        }),
      );

      return packageReviews
        .flat()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, MAX_TESTIMONIALS);
    };

    loadTestimonials()
      .then((loadedTestimonials) => {
        if (mounted) {
          setSlideIndex(0);
          setTransitionEnabled(true);
          setTestimonials(loadedTestimonials);
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
  }, [testimonials.length, cloneCount, visibleCardCount]);

  useEffect(() => {
    if (!canSlide || visibleCardCount === 1 || prefersReducedMotion()) return;
    const intervalId = window.setInterval(() => {
      setSlideIndex((currentIndex) => Math.min(currentIndex + 1, testimonials.length));
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [canSlide, testimonials.length, visibleCardCount]);

  useEffect(() => {
    if (transitionEnabled) return;
    const frameId = window.requestAnimationFrame(() => setTransitionEnabled(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [transitionEnabled]);

  const handleTrackTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (slideIndex === testimonials.length) {
      setTransitionEnabled(false);
      setSlideIndex(0);
    } else if (slideIndex === -1) {
      setTransitionEnabled(false);
      setSlideIndex(testimonials.length - 1);
    }
  };

  const moveNext = () => {
    if (prefersReducedMotion()) {
      setSlideIndex((currentIndex) => (currentIndex + 1) % testimonials.length);
      return;
    }
    setSlideIndex((currentIndex) => Math.min(currentIndex + 1, testimonials.length));
  };

  const movePrevious = () => {
    if (prefersReducedMotion()) {
      setSlideIndex((currentIndex) => (currentIndex - 1 + testimonials.length) % testimonials.length);
      return;
    }
    setSlideIndex((currentIndex) => Math.max(currentIndex - 1, -1));
  };

  return (
    <section className="overflow-hidden bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 flex items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Travel stories
            </p>
            <h2 className="font-serif text-4xl leading-tight text-slate-800 md:text-5xl">
              Loved by our travelers
            </h2>
            <p className="mt-3 text-base text-gray-500">
              Real words from guests who have explored with us.
            </p>
          </div>
          {canSlide && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="Show previous testimonials"
                onClick={movePrevious}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-emerald-300 hover:text-emerald-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Show next testimonials"
                onClick={moveNext}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-emerald-300 hover:text-emerald-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <p role="status" className="text-sm text-gray-500">Loading traveler reviews...</p>
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
              className="font-medium text-emerald-700 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : testimonials.length === 0 ? (
          <p className="text-sm text-gray-500">Traveler reviews will appear here soon.</p>
        ) : (
          <div className="overflow-hidden pb-3" role="region" aria-label="Traveler testimonials carousel">
            <div
              className={`flex gap-5 ${transitionEnabled ? 'transition-transform duration-700 ease-in-out motion-reduce:transition-none' : 'transition-none'}`}
              onTransitionEnd={handleTrackTransitionEnd}
              style={{ transform: `translateX(-${(cloneCount + slideIndex) * slideStep}px)` }}
            >
              {[
                ...(cloneCount ? testimonials.slice(-cloneCount) : []),
                ...testimonials,
                ...(cloneCount ? testimonials.slice(0, cloneCount) : []),
              ].map((testimonial, index) => {
                const isDuplicate = index < cloneCount || index >= cloneCount + testimonials.length;
                const packageIndex = (index - cloneCount + testimonials.length) % testimonials.length;
                return (
                  <article
                    key={isDuplicate ? `clone-${testimonial.id}-${index}` : testimonial.id}
                    ref={index === cloneCount ? firstCardRef : undefined}
                    aria-hidden={isDuplicate || undefined}
                    className="flex w-full basis-full shrink-0 flex-col rounded-2xl border border-slate-200 border-b-2 border-b-slate-300 bg-white p-6 shadow-md transition-all duration-300 hover:border-emerald-300 hover:shadow-lg sm:w-[calc((100%-1.25rem)/2)] sm:basis-[calc((100%-1.25rem)/2)] md:w-[calc((100%-2.5rem)/3)] md:basis-[calc((100%-2.5rem)/3)]"
                  >
                    <div className="mb-5 flex items-start justify-between">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                        <Quote className="h-5 w-5" />
                      </span>
                      <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${testimonial.rating} out of 5 stars`}>
                        {Array.from({ length: 5 }, (_, starIndex) => (
                          <Star
                            key={starIndex}
                            className={`h-4 w-4 ${starIndex < testimonial.rating ? 'fill-current' : 'text-slate-200'}`}
                          />
                        ))}
                      </span>
                    </div>
                    <p className="mb-6 line-clamp-5 flex-1 text-sm leading-6 text-slate-600">
                      “{testimonial.comment}”
                    </p>
                    <div className="border-t border-slate-200 pt-4">
                      <p className="font-semibold text-slate-800">{testimonial.name}</p>
                      <p className="mt-1 text-xs text-gray-500">{testimonial.packageTitle}</p>
                    </div>
                    <span className="sr-only">Testimonial {packageIndex + 1} of {testimonials.length}</span>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default Testimonials;
