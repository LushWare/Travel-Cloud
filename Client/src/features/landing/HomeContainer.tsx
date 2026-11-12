import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import RecentlyBookedSlider from './components/RecentlyBookedSlider';
import DestinationsSection from './components/DestinationsSection';
import FeaturedPackages from './components/FeaturedPackages';
import TestimonialsSection from './components/TestimonialsSection';
import FAQSection from './components/FAQ';
import KeyPartnersSection from './components/KeyPartners';
import Stats from './components/Stats';
import TrustSection from './components/TrustSection';
import { fetchPackages } from '../../services/api/packages';
import type { NormalizedPackage, AggregatedDestination } from '../../services/api/packages.transform';
import { fetchRecentBookings } from '../../services/api/booking';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import { HERO_CONTENT } from '../../content/home';
import { MONTHS } from './utils/constants';
import { HERO_MEDIA } from '../../config/media';
import HeroBackground from '../../components/shared/HeroBackground';
import AIPlanningExplainer from './components/AIPlanningExplainer';
import {
  InlineMapPin,
  InlineCalendar,
  InlineSearch,
  InlineArrowRight,
} from './components/icons';

/** Raw shape of a recent booking as returned by `fetchRecentBookings`. It never names the traveller. */
interface RecentBooking {
  id?: string;
  packageId?: string | null;
  packageName?: string | null;
  packageDestination?: string | null;
  packageDuration?: number | null;
  packageCoverImage?: string | null;
  packageSlug?: string | null;
  packagePrice?: number | null;
  createdAt?: string;
  numberOfTravelers?: number | null;
}

const travellerLabel = (count?: number | null) =>
  count && count > 1 ? `${count} travellers` : 'A traveller';

export default function HomeContainer() {
  const navigate = useNavigate();
  const [destinations, setDestinations] = useState<AggregatedDestination[]>([]);
  const [packages, setPackages] = useState<NormalizedPackage[]>([]);
  const [bookings, setBookings] = useState<RecentBooking[]>([]);
  // Kept for parity with the original Home.jsx: the loading flag drives the
  // old fetch flow but is not read in the rendered tree.
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchFilters, setSearchFilters] = useState({ destination: '', when: '' });
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const monthDropdownRef = useRef<HTMLDivElement | null>(null);
  const monthButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownPanelRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = monthDropdownRef.current?.contains(target);
      const insidePanel = dropdownPanelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        setMonthDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!monthDropdownOpen) return;
    const updatePosition = () => {
      const rect = monthButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: rect.width });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [monthDropdownOpen]);

  useEffect(() => {
    let mounted = true;
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        if (!mounted) return;
        setLoading(true);
        fetchPackages({ limit: 6 })
          .then(({ packages: pkg, destinations: dest }) => {
            if (!mounted) return;
            const sorted = dest.slice().sort((a, b) => (b.packagesCount || 0) - (a.packagesCount || 0));
            setPackages(pkg);
            setDestinations(sorted);
          })
          .catch((err: Error) => {
            if (!mounted) return;
            setError(apiErrorMessage(err));
          })
          .finally(() => {
            if (mounted) setLoading(false);
          });
      });
    } else {
      setTimeout(() => {
        if (!mounted) return;
        setLoading(true);
        fetchPackages({ limit: 6 })
          .then(({ packages: pkg, destinations: dest }) => {
            if (!mounted) return;
            const sorted = dest.slice().sort((a, b) => (b.packagesCount || 0) - (a.packagesCount || 0));
            setPackages(pkg);
            setDestinations(sorted);
          })
          .catch((err: Error) => {
            if (!mounted) return;
            setError(apiErrorMessage(err));
          })
          .finally(() => {
            if (mounted) setLoading(false);
          });
      }, 0);
    }
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchRecentBookings(8)
      .then((bookingsData) => {
        if (!mounted) return;
        setBookings((bookingsData as RecentBooking[]) || []);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        console.error('Failed to fetch recent bookings:', err);
        setBookings([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (searchFilters.destination) {
      params.append('destination', searchFilters.destination);
    }
    if (searchFilters.when) {
      params.append('month', searchFilters.when);
    }
    navigate(`/packages?${params.toString()}`);
  };

  const recentItems = useMemo(() => {
    if (!bookings || bookings.length === 0) {
      return [];
    }

    return bookings
      .map((booking) => {
        try {
          if (!booking.packageId) return null;

          const timeDiffSeconds = booking.createdAt
            ? Math.floor((Date.now() - new Date(booking.createdAt).getTime()) / 1000)
            : 0;

          let bookedAgoText = 'Just now';
          if (timeDiffSeconds < 1) {
            bookedAgoText = 'Just now';
          } else if (timeDiffSeconds < 60) {
            bookedAgoText = timeDiffSeconds === 1 ? '1 second' : `${timeDiffSeconds} seconds`;
          } else if (timeDiffSeconds < 3600) {
            const minutes = Math.floor(timeDiffSeconds / 60);
            bookedAgoText = minutes === 1 ? '1 minute' : `${minutes} minutes`;
          } else if (timeDiffSeconds < 86400) {
            const hours = Math.floor(timeDiffSeconds / 3600);
            bookedAgoText = hours === 1 ? '1 hour' : `${hours} hours`;
          } else if (timeDiffSeconds < 2592000) {
            const days = Math.floor(timeDiffSeconds / 86400);
            bookedAgoText = days === 1 ? '1 day' : `${days} days`;
          } else if (timeDiffSeconds < 31536000) {
            const months = Math.floor(timeDiffSeconds / 2592000);
            bookedAgoText = months === 1 ? '1 month' : `${months} months`;
          } else {
            const years = Math.floor(timeDiffSeconds / 31536000);
            bookedAgoText = years === 1 ? '1 year' : `${years} years`;
          }

          return {
            id: booking.packageId,
            packageName: booking.packageName ?? undefined,
            image: booking.packageCoverImage || '',
            duration:
              booking.packageDuration && booking.packageDuration > 0
                ? `${booking.packageDuration}D/${booking.packageDuration - 1}N`
                : '',
            price: booking.packagePrice ?? undefined,
            pax: booking.numberOfTravelers ?? undefined,
            bookedAgo: bookedAgoText,
            traveler: {
              name: travellerLabel(booking.numberOfTravelers),
              from: booking.packageDestination ?? undefined,
            },
            slug: booking.packageSlug ?? undefined,
          };
        } catch (error) {
          console.error('Error mapping booking:', error, booking);
          return null;
        }
      })
      .filter((item) => item !== null);
  }, [bookings]);

  if (error && packages.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-center">
        <div className="max-w-md">
          <h2 className="text-2xl font-bold mb-4">We couldn't load travel experiences</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            Try again
          </button>
        </div>
      </div>
    );
  }

  const heroWords = HERO_CONTENT.title.split(' ');
  const heroLastWord = heroWords.pop();
  const heroHeadline = (
    <>
      {heroWords.join(' ')}{' '}
      <span className="text-brand-accent-400">{heroLastWord}</span>
    </>
  );

  const searchControls = (
    <>
      <div className="lg:col-span-5 relative group">
        <label className="flex items-center text-sm sm:text-base font-semibold text-white mb-3">
          <InlineMapPin /> Where to?
        </label>
        <div className="relative">
          <select
            value={searchFilters.destination}
            onChange={(e) => setSearchFilters(p => ({ ...p, destination: e.target.value }))}
            className="w-full px-4 sm:px-5 py-2.5 sm:py-3 bg-gray-100/80 border-2 border-gray-200 rounded-2xl text-gray-900 font-medium text-sm sm:text-base appearance-none cursor-pointer transition-all focus:border-brand-500 focus:bg-white focus:shadow-lg hover:border-gray-300"
          >
            <option value="" disabled hidden>Select Destination</option>
            <optgroup label="🌏 Destinations">
              {destinations.slice(0, 30).map((d) => (
                <option key={d.id} value={d.name.toLowerCase()}>
                  {d.name} {d.packagesCount ? `(${d.packagesCount} packages)` : ''}
                </option>
              ))}
            </optgroup>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-5 h-5 text-brand-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      <div className="lg:col-span-4 relative group" ref={monthDropdownRef}>
        <label className="flex items-center text-sm sm:text-base font-semibold text-white mb-3">
          <InlineCalendar /> When?
        </label>
        <div className="relative">
          <button
            type="button"
            ref={monthButtonRef}
            onClick={() => setMonthDropdownOpen(!monthDropdownOpen)}
            className="w-full px-4 sm:px-5 py-2.5 sm:py-3 bg-gray-100/80 border-2 border-gray-200 rounded-2xl text-left text-gray-900 font-medium text-sm sm:text-base flex items-center justify-between transition-all focus:border-brand-500 focus:bg-white hover:border-gray-300"
          >
            <span>
              {searchFilters.when
                ? MONTHS.find(m => m.value === searchFilters.when)?.label || 'Any Month'
                : 'Any Month'}
            </span>
            <svg className={`w-5 h-5 text-brand-800 transition-transform ${monthDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Month */}
          {monthDropdownOpen && dropdownPos && createPortal(
            <>
              <div
                className="fixed inset-0 z-prominent"
                onClick={() => setMonthDropdownOpen(false)}
              />
              <div
                ref={dropdownPanelRef}
                className="absolute z-prominent"
                style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
              >
                <div className="mt-2 w-full sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-80 overflow-y-auto">
                  <div className="p-4 grid grid-cols-3 gap-3">
                    {MONTHS.map((month) => (
                      <button
                        key={month.value}
                        onClick={() => {
                          setSearchFilters(p => ({ ...p, when: month.value }));
                          setMonthDropdownOpen(false);
                        }}
                        className={`px-4 py-3 rounded-xl text-sm font-medium transition-all text-center ${searchFilters.when === month.value
                            ? 'bg-brand-600 text-white shadow-lg'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
                          }`}
                      >
                        {month.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Search button */}
      <div className="lg:col-span-3">
        <button
          onClick={handleSearch}
          className="w-full px-6 sm:px-8 py-2.5 sm:py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold text-sm sm:text-base shadow-floating transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
        >
          <span className="relative flex items-center justify-center space-x-2">
            <InlineSearch />
            <span>Search</span>
          </span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen font-body">
      {/* HERO SECTION — one static composition (Phase 2 rewamp): single
          headline + subline + integrated search, replacing the old
          4-slide auto-rotating carousel with a detached search section
          below it (an outside design review's hard rejection — a message
          rotation with no narrative purpose). The Ken Burns background
          zoom is the hero's only motion (DESIGN.md motion budget). */}
      <div className="relative z-base min-h-[80vh] lg:min-h-[80vh] bg-brand-dark-950 flex flex-col justify-end">
        <style>{`
          @media (min-width: 768px) and (max-width: 1024px) {
            .relative.min-h-\\[80vh\\] {
              min-height: 65vh;
            }
          }
          /* Short viewports (common on phones in landscape or small
             devices): the fixed-position floating action launcher is
             anchored to the viewport bottom in raw pixels, not vh, so it
             can sit on top of the hero subtitle once the 80vh hero shrinks
             below ~700px tall. Reserve extra bottom space in that case
             regardless of viewport width. */
          @media (max-height: 700px) {
            .hero-content {
              padding-bottom: 9rem;
            }
          }
        `}</style>
        {/* Background — clipped to the hero's own box via a dedicated
            overflow-hidden wrapper (not the hero root itself), so the Ken
            Burns zoom stays contained without also clipping popups (e.g.
            the "When?" dropdown below) anchored to the hero's edge. */}
        <div className="absolute inset-0 overflow-hidden z-base">
          {(() => {
            const heroMedia = HERO_MEDIA.find((m) => m.id === 'v1');
            return heroMedia ? <HeroBackground item={heroMedia} eager /> : null;
          })()}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/50 to-black/20" />
          <div className="absolute inset-0 bg-black/20" />
        </div>

        {/* Hero Content — headline, subline, and search integrated into
            the hero itself, not a separate section beneath it. */}
        <div className="hero-content relative z-lifted max-w-4xl px-6 md:px-16 pb-10 sm:pb-12 md:pb-16">
          <h1 className="max-w-2xl text-3xl sm:text-4xl md:text-5xl lg:text-hero font-display text-white mb-4 sm:mb-5 md:mb-6 leading-tight lg:leading-[1.02]">
            {heroHeadline}
          </h1>
          <p className="max-w-2xl text-lg sm:text-xl md:text-xl text-gray-200 leading-relaxed mb-8">
            {HERO_CONTENT.subtitle}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            {searchControls}
          </div>
        </div>
      </div>

      <Stats />
      <TrustSection />
      <RecentlyBookedSlider items={recentItems} />
      <DestinationsSection />
      <AIPlanningExplainer />
      <FeaturedPackages packages={packages} />
      <TestimonialsSection />
      <FAQSection />
      <KeyPartnersSection />

      {/* CTA */}
      <section className="py-12 relative overflow-hidden font-body bg-brand-dark-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-raised">
          <div className="text-center mb-6">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight font-display">
              Ready to Explore<br className="hidden md:block" /> the World?
            </h2>
            <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-snug mb-6">
              Transform your travel dreams into reality with personalized itineraries crafted by our expert team
            </p>
          </div>
          <div className="w-full max-w-3xl mx-auto rounded-2xl py-2 px-0 lg:py-6">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
              <Link to="/planner" className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold shadow-floating transform hover:scale-105 transition-all duration-300">
                Customize Your Trip <InlineArrowRight />
              </Link>
              <Link to="/contact" className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-white text-gray-900 rounded-xl font-semibold border border-gray-200 hover:border-gray-300 transform hover:scale-105 transition-all duration-300">
                Still Have Questions?
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
