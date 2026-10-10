import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, Star, MapPin, Check, X, Calendar, Download, ChevronLeft, ChevronRight,
  Award, Sparkles, Phone, Mail, Image as ImageIcon, Hotel, Anchor, Sun, Utensils, Compass,
  CarFront, TicketCheck, Mountain, Quote,
} from 'lucide-react';
import { fetchPackageById, getCachedPackageById, submitReview, fetchPackageReviews } from '../../services/api/packages';
import type { NormalizedPackage } from '../../services/api/packages.transform';
import type { PdfPackageData } from './pdf/pdfService';
import { formatCurrency } from '../../lib/currency';
import { pluralize } from '../../lib/pluralize';
import { useElfsightWidget } from '../../lib/elfsight';
import { generateAndDownloadPDF as generateManagementPDF } from './pdf/pdfService';
import { useAuth } from '../../contexts/AuthContext';
import { submitBookingRequest } from '../../services/api/booking';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import { categoryImage } from '../../config/media';
import BRANDING from '../../config/branding';
import BookingModal from './components/BookingModal';
import ReviewModal from './components/ReviewModal';
import type { BookingFormData } from './components/BookingModal';
import type { ReviewFormData } from './components/ReviewModal';

interface Review {
  id: string;
  user_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

const compactFeatureLabel = (label: string): string => {
  const nights = /^(\d+)\s+nights?\s+in\s+family rooms?$/i.exec(label.trim());
  if (nights) return `${nights[1]} nights, family rooms`;
  if (/breakfast/i.test(label) && /dinner/i.test(label)) return 'Breakfast & dinner';
  if (/vehicle|chauffeur|transport/i.test(label)) return 'Private transport';
  if (/entrance fees?|entry fees?/i.test(label)) return 'Entry fees included';

  const words = label.trim().split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}...` : label;
};

export default function PackageDetailsContainer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // A booking handoff from the assistant lands on /package/<id>?book=1 with the
  // booking step already open. Consumed once per mount, and the parameter is
  // removed with a replace so a refresh does not reopen the modal and the Back
  // button is not trapped on the same page.
  const bookingHandoffConsumedRef = useRef(false);
  const cachedPackage = getCachedPackageById(id ?? '');
  const [pkg, setPkg] = useState<NormalizedPackage | null>(() => cachedPackage);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [activeSection, setActiveSection] = useState('overview');
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isImageHovered, setIsImageHovered] = useState(false);
  const [loading, setLoading] = useState(() => !cachedPackage);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [formData, setFormData] = useState<BookingFormData>({
    name: '', email: '', phone: '', travelers: 1, travelDate: null, endDate: null, message: '',
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [submissionType, setSubmissionType] = useState('booking');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;
  const [reviewData, setReviewData] = useState<ReviewFormData>({
    name: '', email: '', rating: 0, comment: '',
  });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewSuccess, setShowReviewSuccess] = useState(false);
  const { user } = useAuth();
  const elRef = useElfsightWidget();

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    const cachedPackage = getCachedPackageById(id);
    setPkg(cachedPackage);
    setLoading(!cachedPackage);
    setError(null);
    
    fetchPackageById(id)
      .then((packageData) => {
        if (!isMounted) return;
        setPkg(packageData);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    fetchPackageReviews(id, 50, 1)
      .then((reviewsData) => {
        if (!isMounted) return;
        const fetchedReviews = Array.isArray(reviewsData.reviews)
          ? reviewsData.reviews.map((review) => ({
              id: review.id,
              user_name: review.name || 'Traveler',
              rating: review.rating || 0,
              comment: review.comment || '',
              created_at: review.createdAt || new Date().toISOString(),
            }))
          : [];
        setReviews(fetchedReviews);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error('Error fetching reviews:', err);
        setReviews([]);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (bookingHandoffConsumedRef.current) return;
    // Waits for the package because the booking request is submitted against
    // it; opening the form before the record is known would collect a booking
    // for nothing.
    if (!pkg || searchParams.get('book') !== '1') return;
    bookingHandoffConsumedRef.current = true;
    setSubmissionType('booking');
    setShowBookingModal(true);
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('book');
    setSearchParams(remaining, { replace: true });
  }, [pkg, searchParams, setSearchParams]);

  const heroImages = pkg?.images || [];
  useEffect(() => {
    if (!heroImages || heroImages.length <= 1 || isImageHovered) return;
    
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => {
        const nextIndex = (prev + 1) % heroImages.length;
        return nextIndex;
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [heroImages, isImageHovered]);

  useEffect(() => {
    setTimeout(() => setIsVisible(true), 100);
  }, []);

  const validateStep = (step: number) => {
    const errors: Record<string, string> = {};
    if (step === 1) {
      // Step 1: Only email is required
      if (!formData.email?.trim()) {
        errors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        errors.email = 'Please enter a valid email address';
      }
    }
    return errors;
  };

  const handleNext = () => {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setFormErrors({});
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmittingBooking) return; // Double-submit guard: a disabled button alone can double-fire before React re-renders (fast repeat Enter/click).
    if (!pkg) return;

    // Validate final step
    const errors = validateStep(1);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setCurrentStep(1);
      return;
    }
    setFormErrors({});

    setIsSubmittingBooking(true);
    try {
      const formatDate = (date: Date | string | null): string => {
        if (!date) return '';
        if (typeof date === 'string') {
          // If it's already a string, try to parse it
          const parsed = new Date(date);
          if (isNaN(parsed.getTime())) return '';
          const year = parsed.getFullYear();
          const month = String(parsed.getMonth() + 1).padStart(2, '0');
          const day = String(parsed.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const packageId = pkg.id || pkg.raw?._id;
      if (!packageId) {
        throw new Error('Package id is missing; cannot submit this request');
      }

      const submissionData = {
        name: formData.name?.trim() || undefined,
        email: formData.email.trim(),
        phone: formData.phone || undefined,
        travelers: Number(formData.travelers) || 1,
        travelDate: formatDate(formData.travelDate),
        endDate: formatDate(formData.endDate) || undefined,
        message: formData.message?.trim() || undefined,
        packageId,
      };
      
      if (submissionType === 'booking') {
        await submitBookingRequest(submissionData);
        setPkg((prevPkg) => {
          if (!prevPkg) return prevPkg;
          const updatedBookings = (prevPkg.bookings || 0) + 1;
          return {
            ...prevPkg,
            bookings: updatedBookings,
            raw: prevPkg.raw
              ? { ...prevPkg.raw, bookings: (prevPkg.raw.bookings || 0) + 1 }
              : prevPkg.raw,
          };
        });
      } else if (submissionType === 'lead') {
        await submitBookingRequest(submissionData);
      }

      setShowSuccessModal(true);
      setCurrentStep(1);
      setFormData({ name: '', email: '', phone: '', travelers: 1, travelDate: null, endDate: null, message: '' });
      
      setSubmissionType('booking');
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        alert(apiErrorMessage(err));
      } else {
        alert('Unable to submit your booking request right now. Please try again.');
      }
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const downloadPDF = async () => {
    if (!pkg) return;
    setIsDownloading(true);
    try {
      // Get the package data - prefer raw (original API response) which has _id
      // If raw doesn't exist, use pkg but ensure it has the ID
      const packageData: NormalizedPackage['raw'] = pkg.raw || (pkg as unknown as NormalizedPackage['raw']);
      
      // Ensure the package has an ID for dynamic fetching
      // The PDF service will fetch the latest package data from API using this ID
      const packageWithId: PdfPackageData = {
        ...packageData,
        _id: packageData._id || packageData.id || id,
        id: packageData.id || packageData._id || id,
        category: packageData.category ?? undefined,
        difficulty: packageData.difficulty ?? undefined,
      };
      
      console.log('[PDF Download] Package ID:', packageWithId._id || packageWithId.id);
      console.log('[PDF Download] Package name:', packageWithId.name || packageWithId.title);
      
      // Use the same approach as management side - pass package with ID
      // The PDF service will fetch latest data dynamically
      await generateManagementPDF(packageWithId);
    } catch (error) {
      console.error('Failed to generate itinerary PDF via management service.', error);
      window.alert('Unable to generate the itinerary PDF right now. Please try again later.');
    } finally {
      setIsDownloading(false);
    }
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % heroImages.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + heroImages.length) % heroImages.length);
  };
  const handleReviewSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id) return;
    if (!reviewData.name || !reviewData.rating || !reviewData.comment) {
      alert('Please fill in all fields');
      return;
    }
    setIsSubmittingReview(true);
    try {
      const newReview = await submitReview(id, reviewData);
      if (newReview) {
        setReviews([
          {
            id: newReview.id,
            user_name: newReview.name || 'Traveler',
            rating: newReview.rating,
            comment: newReview.comment,
            created_at: newReview.createdAt || new Date().toISOString(),
          },
          ...reviews,
        ]);
      }
      setReviewData({ name: '', email: '', rating: 0, comment: '' });
      setShowReviewModal(false);
      setShowReviewSuccess(true);
      setTimeout(() => setShowReviewSuccess(false), 4000);
    } catch (error) {
      console.error('Error submitting review:', error);
      alert('Failed to submit review. Please try again.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const sections = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'itinerary', label: 'Itinerary', icon: Calendar },
    { id: 'inclusions', label: 'What\'s Included', icon: Award },
    { id: 'gallery', label: 'Gallery', icon: ImageIcon },
    { id: 'reviews', label: 'Reviews', icon: Star },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white" role="status" aria-label="Loading package">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-brand-accent-500" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4" role="alert">
        <div className="max-w-md text-center bg-white rounded-3xl shadow-xl p-8">
          <h2 className="text-3xl font-black text-gray-900 mb-4">Unable to load package</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/packages')}
            className="px-8 py-4 bg-gradient-to-r from-brand-accent-500 to-brand-500 text-white rounded-2xl font-black hover:shadow-xl transform hover:scale-105 transition-all"
          >
            Browse packages
          </button>
        </div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center bg-white rounded-3xl shadow-xl p-8">
          <h2 className="text-3xl font-black text-gray-900 mb-2">Package not found</h2>
          <p className="text-gray-600 mb-6">The package you're looking for may have been removed.</p>
          <button
            type="button"
            onClick={() => navigate('/packages')}
            className="px-8 py-4 bg-gradient-to-r from-brand-accent-500 to-brand-500 text-white rounded-2xl font-black hover:shadow-xl transform hover:scale-105 transition-all"
          >
            Explore packages
          </button>
        </div>
      </div>
    );
  }

  // A package with no gallery images still gets the shared brand fallback so the
  // hero never renders a blank media area.
  const galleryFallback = categoryImage(pkg?.category);
  const images = heroImages.length > 0 ? heroImages : [galleryFallback];
  const overviewDescription = pkg.description.trim();
  const overviewFeatures = [...pkg.inclusions, ...pkg.highlights, ...pkg.activities]
    .filter((feature, index, features) => feature && features.indexOf(feature) === index)
    .slice(0, 4)
    .map((label) => {
      const Icon = /hotel|resort|stay|accommodation|villa|lodge/i.test(label)
        ? Hotel
        : /snorkel|dive|boat|sail|sea|water|marine/i.test(label)
          ? Anchor
          : /food|meal|breakfast|lunch|dinner|cuisine/i.test(label)
            ? Utensils
            : /sun|beach|relax|spa/i.test(label)
              ? Sun
              : /vehicle|chauffeur|transfer|transport|drive/i.test(label)
                ? CarFront
                : /entrance|fee|ticket|permit/i.test(label)
                  ? TicketCheck
                  : /trek|hike|mountain|safari|tour|guided/i.test(label)
                    ? Mountain
                    : Compass;
      return { label, Icon };
    });

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <style>{`
        @keyframes kenBurns {
          0% { transform: scale(1); }
          100% { transform: scale(1.15); }
        }
        @keyframes horizontalScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(100%); }
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0) translateX(0);
            opacity: 0;
          }
          10% { opacity: 0.3; }
          50% {
            transform: translateY(-100vh) translateX(50px);
            opacity: 0.5;
          }
          90% { opacity: 0.3; }
          100% {
            transform: translateY(-100vh) translateX(100px);
            opacity: 0;
          }
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes seamlessTransition {
          0% {
            opacity: 1;
            transform: scale(1.05) translateX(0);
          }
          20% {
            opacity: 1;
            transform: scale(1.08) translateX(0);
          }
          25% {
            opacity: 0;
            transform: scale(1.1) translateX(10%);
          }
          30% {
            opacity: 0;
            transform: scale(1.05) translateX(-10%);
          }
          100% {
            opacity: 0;
            transform: scale(1) translateX(0);
          }
        }
        @keyframes seamlessEnter {
          0% {
            opacity: 0;
            transform: scale(0.95) translateX(-10%);
          }
          20% {
            opacity: 1;
            transform: scale(1.02) translateX(0);
          }
          100% {
            opacity: 1;
            transform: scale(1.05) translateX(0);
          }
        }
        .animate-fadeInUp {
          animation: fadeInUp 0.8s ease-out forwards;
        }
        .animate-float {
          animation: float linear infinite;
        }
        .ken-burns-active {
          animation: kenBurns 15s ease-out infinite;
        }
        .slide-horizontal {
          animation: horizontalScroll 1s ease-in-out;
        }
        .seamless-transition-out {
          animation: seamlessTransition 3.5s ease-out forwards;
        }
        .seamless-transition-in {
          animation: seamlessEnter 1.5s ease-out forwards;
        }

        /* Mobile-specific styles */
        @media (max-width: 1024px) {
          .section-tabs-mobile {
            flex-direction: column !important;
          }
          .section-tab-mobile {
            border-bottom: 1px solid #e5e7eb !important;
            border-radius: 0 !important;
            justify-content: flex-start !important;
          }
          .section-tab-mobile:last-child {
            border-bottom: none !important;
          }
          .section-tab-active-mobile {
            background: linear-gradient(135deg, #000 0%, #1f2937 100%) !important;
            color: white !important;
            border-left: 4px solid #f59e0b !important;
          }
          .itinerary-day-mobile {
            flex-direction: column !important;
            gap: 1rem !important;
          }
          .itinerary-day-number-mobile {
            align-self: flex-start !important;
            margin-bottom: 0.5rem !important;
          }
          .itinerary-connector-mobile {
            display: none !important;
          }
          .inclusions-grid-mobile {
            grid-template-columns: 1fr !important;
            gap: 1.5rem !important;
          }
          .reviews-header-mobile {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 1rem !important;
          }
          .reviews-rating-section-mobile {
            align-self: stretch !important;
            text-align: left !important;
          }
          .sidebar-sticky-mobile {
            position: relative !important;
            top: auto !important;
          }
          .pricing-card-mobile {
            padding: 1.5rem !important;
          }
          .pricing-title-mobile {
            font-size: 1.125rem !important;
          }
          .pricing-amount-mobile {
            font-size: 2.5rem !important;
          }
          .booking-buttons-mobile {
            flex-direction: column !important;
            gap: 0.75rem !important;
          }
          .assistance-card-mobile {
            padding: 1.5rem !important;
          }
          .assistance-contact-mobile {
            padding: 1rem !important;
            gap: 1rem !important;
          }
          .modal-max-height-mobile {
            max-height: 95vh !important;
          }
          .modal-padding-mobile {
            padding: 1.5rem !important;
          }
          .form-grid-mobile {
            grid-template-columns: 1fr !important;
            gap: 1rem !important;
          }
          .form-input-mobile {
            padding: 0.875rem 1rem !important;
          }
          .review-modal-mobile {
            max-width: 95vw !important;
            margin: 1rem !important;
          }
          .success-modal-mobile {
            max-width: 90vw !important;
          }
        }

        @media (max-width: 640px) {
          .main-content-padding-sm {
            padding-left: 1rem !important;
            padding-right: 1rem !important;
            padding-top: 1rem !important;
          }
          .section-padding-sm {
            padding: 1.5rem !important;
          }
          .tabs-padding-sm {
            padding-left: 1rem !important;
            padding-right: 1rem !important;
          }
          .itinerary-padding-sm {
            padding: 1.25rem !important;
          }
          .inclusions-padding-sm {
            padding: 1.25rem !important;
          }
          .review-card-padding-sm {
            padding: 1.25rem !important;
          }
          .pricing-padding-sm {
            padding: 1.25rem !important;
          }
          .assistance-padding-sm {
            padding: 1.25rem !important;
          }
          .modal-header-padding-sm {
            padding: 1.5rem 1.25rem !important;
          }
          .modal-form-padding-sm {
            padding: 1.5rem 1.25rem !important;
          }
          .button-padding-sm {
            padding: 0.875rem 1rem !important;
          }
        }
      `}</style>

      {/* Hero Section */}
      <div
        className="relative isolate flex min-h-[700px] flex-col overflow-hidden bg-brand-dark-900 lg:min-h-[610px]"
        onMouseEnter={() => setIsImageHovered(true)}
        onMouseLeave={() => setIsImageHovered(false)}
      >
        <div className="absolute inset-0">
          {images.map((img, idx) => {
            const isCurrent = idx === currentImageIndex;
            const isNext = idx === (currentImageIndex + 1) % images.length;
            const isPrevious = idx === (currentImageIndex - 1 + images.length) % images.length;
           
            return (
              <div
                key={idx}
                className={`
                  absolute inset-0 transition-all duration-1000 ease-out
                  ${isCurrent
                    ? 'opacity-100 z-raised ken-burns-active slide-horizontal seamless-transition-in'
                    : isNext || isPrevious
                      ? 'opacity-0 z-raised seamless-transition-out'
                      : 'opacity-0 scale-100 z-base'
                  }
                `}
              >
                <picture>
                  <source srcSet={img?.replace(/\.(jpg|jpeg|png)$/i, '.webp')} type="image/webp" />
                  <img
                    src={img}
                    alt={`${pkg.title} - ${idx + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = galleryFallback;
                    }}
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/40" />
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => navigate('/packages')}
          className="absolute left-4 top-20 z-lifted inline-flex min-h-10 items-center gap-2 rounded-full bg-black/35 px-3 py-2 text-xs font-medium text-white/90 backdrop-blur-sm transition-colors hover:text-white sm:left-12 sm:top-32 sm:min-h-0 sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-sm sm:text-white/85 sm:backdrop-blur-none lg:left-38"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Packages
        </button>
        
        {/* Hero Content */}
        <div className={`relative z-lifted mx-auto flex w-full max-w-7xl flex-1 flex-col justify-end gap-7 px-6 pb-8 pt-20 transition-all duration-1000 lg:flex-row lg:items-end lg:justify-between lg:gap-12 lg:px-12 lg:pb-10 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
        }`}>
          <div className="max-w-3xl">
            {pkg.destination && (
              <div className="mb-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-white/80">
                <MapPin className="h-4 w-4 text-brand-accent-300" />
                <span>{`${pkg.destination.name}${pkg.destination.country ? `, ${pkg.destination.country}` : ''}`}</span>
              </div>
            )}
            <h1 className="mb-10 max-w-3xl font-display text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
              {pkg.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm font-medium text-white">
              <span className="inline-flex items-center gap-2">
                <Clock className="h-4 w-4 text-brand-accent-300" />
                {pluralize(pkg.duration_days, 'Day')}
              </span>
              <span className="inline-flex items-center gap-2 capitalize">
                <Sparkles className="h-4 w-4 text-brand-accent-300" />
                {pkg.category.toLowerCase()}
              </span>
            </div>
          </div>

          <aside className="w-full max-w-[380px] shrink-0 rounded-xl border border-white/70 bg-white p-6 text-brand-dark-900 shadow-2xl sm:p-7 lg:mb-2">
            <p className="mb-1 text-sm font-medium text-gray-500">Starting from</p>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-4xl font-bold text-brand-dark-900 sm:text-5xl">
                {formatCurrency(pkg.price_from)}
              </span>
              <span className="text-sm text-gray-500">/ person</span>
            </div>
            <div className="mb-6 flex items-center gap-2 text-sm">
              <span className="flex items-center text-yellow-400" aria-label={`${pkg.rating} out of 5 stars`}>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star key={index} className={`h-4 w-4 ${index < Math.round(pkg.rating) ? 'fill-current' : ''}`} />
                ))}
              </span>
              <span className="font-bold text-gray-900">
                {pkg.rating > 0 ? pkg.rating.toFixed(1) : 'New'}
              </span>
              <span className="text-gray-500">
                ({pkg.reviews_count || reviews.length} {pluralize(pkg.reviews_count || reviews.length, 'review')})
              </span>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  setSubmissionType('booking');
                  setShowBookingModal(true);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                <Calendar className="h-4 w-4" />
                Book Now
              </button>
              <button
                type="button"
                onClick={() => navigate(`/package/${pkg.id}/customize`)}
                className="w-full rounded-lg border border-brand-700 px-5 py-3.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                Customize Package
              </button>
            </div>
          </aside>
        </div>

        {images.length > 1 && (
          <>
            <button
              onClick={prevImage}
              className="absolute left-4 lg:left-6 top-1/2 -translate-y-1/2 z-prominent w-10 lg:w-12 h-10 lg:h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/20 rounded-full transition-all hover:scale-110 text-white hidden lg:flex"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-5 h-5 lg:w-6 lg:h-6" />
            </button>
            <button
              onClick={nextImage}
              className="absolute right-4 lg:right-6 top-1/2 -translate-y-1/2 z-prominent w-10 lg:w-12 h-10 lg:h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/20 rounded-full transition-all hover:scale-110 text-white hidden lg:flex"
              aria-label="Next image"
            >
              <ChevronRight className="w-5 h-5 lg:w-6 lg:h-6" />
            </button>
          </>
        )}

      </div>

      {/* Main Content */}
      <div className="relative z-raised pb-16 lg:pb-24">
        <div className="sticky top-[4.5rem] z-30 w-full border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl min-w-0 items-center gap-7 overflow-x-auto px-6 pt-3 lg:px-8 md:gap-10">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-1 pb-4 pt-1 text-sm font-semibold transition-colors ${
                    activeSection === section.id
                      ? 'border-brand-700 text-brand-800'
                      : 'border-transparent text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10">
          <div className="w-full">
            <div className="w-full">

              <div className="py-10 lg:py-14">
                {activeSection === 'overview' && (
                  <div>
                    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2 lg:gap-16">
                      <div className="flex h-full flex-col justify-center">
                        <p className="mb-4 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Your journey</p>
                        <h2 className="mb-7 font-display text-4xl font-semibold leading-[1.08] text-brand-dark-900 sm:text-5xl">About This Package</h2>
                        {overviewDescription && (
                          <p data-testid="package-overview-description" className="text-lg leading-relaxed text-gray-600 sm:text-base">
                            {overviewDescription}
                          </p>
                        )}
                        {overviewFeatures.length > 0 && (
                          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-4 lg:mt-12">
                            {overviewFeatures.map(({ label, Icon }, index) => (
                              <li key={`${label}-${index}`} className="flex min-w-0 flex-col items-center gap-3 text-center">
                                <Icon aria-hidden="true" className="h-8 w-8 text-brand-600" strokeWidth={1.6} />
                                <span aria-label={label} title={label} className="break-words text-[11px] font-medium uppercase leading-snug tracking-wide text-gray-600 sm:text-xs">
                                  {compactFeatureLabel(label)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-brand-50">
                          <img
                            src={images[currentImageIndex] || galleryFallback}
                            alt={`${pkg.title} travel experience`}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        {images.length > 1 && (
                          <div className="mt-3 grid grid-cols-4 gap-3">
                            {images.map((image, index) => (
                              <button
                                key={`${image}-${index}`}
                                type="button"
                                onClick={() => setCurrentImageIndex(index)}
                                aria-label={`Show package photo ${index + 1}`}
                                aria-pressed={currentImageIndex === index}
                                className={`aspect-[4/3] overflow-hidden rounded-md border-2 transition-colors ${
                                  currentImageIndex === index ? 'border-brand-700' : 'border-transparent'
                                }`}
                              >
                                <img src={image} alt={`${pkg.title} photo ${index + 1}`} className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {pkg.highlights.length > 0 && (
                      <section className="-mx-6 mt-14 bg-gray-50 px-6 py-12 lg:-mx-8 lg:mt-16 lg:px-8 lg:py-14">
                        <div className="mx-auto max-w-7xl">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Made for discovery</p>
                          <h3 className="mb-8 font-display text-2xl font-semibold text-brand-dark-900 sm:text-3xl">Trip Highlights</h3>
                          <ul className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
                            {pkg.highlights.map((highlight, index) => (
                              <li key={`${highlight}-${index}`} className="flex items-start gap-3 border-t border-gray-200 pt-4 text-gray-700">
                                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                                <span className="text-sm leading-relaxed sm:text-base">{highlight}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </section>
                    )}
                  </div>
                )}
                {activeSection === 'gallery' && (
                  <section className="-mx-6 bg-white px-6 py-8 lg:-mx-8 lg:px-8 lg:py-8">
                    <div className="mx-auto max-w-7xl">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">A closer look</p>
                      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <h2 className="font-display text-3xl font-semibold text-brand-dark-900 sm:text-4xl">{pkg.title} Gallery</h2>
                        <p className="text-sm text-gray-600">{images.length} {pluralize(images.length, 'photo')}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                        {images.map((image, index) => (
                          <button
                            key={`${image}-${index}`}
                            type="button"
                            onClick={() => setCurrentImageIndex(index)}
                            aria-label={`Show package photo ${index + 1}`}
                            aria-pressed={currentImageIndex === index}
                            className={`group relative aspect-[4/3] overflow-hidden rounded-lg bg-brand-50 text-left ${currentImageIndex === index ? 'ring-2 ring-brand-600 ring-offset-2 ring-offset-white' : ''}`}
                          >
                            <img
                              src={image}
                              alt={`${pkg.title} photo ${index + 1}`}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                )}
                {activeSection === 'itinerary' && (
                  <section className="-mx-6 bg-white px-6 py-14 lg:-mx-8 lg:px-8 lg:py-4">
                    <div className="mx-auto max-w-7xl">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Day by day</p>
                      <h2 className="mb-3 font-display text-3xl font-semibold text-brand-dark-900 sm:text-4xl">Your Itinerary</h2>
                      <p className="max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-base">
                        {pluralize(pkg.duration_days, 'Day')} in {pkg.destination.name || pkg.destinationRaw || 'your destination'}.
                      </p>
                      {pkg.itinerary.length > 0 ? (
                        <ol className="mt-9 grid grid-cols-1 gap-x-12 md:grid-cols-2">
                          {pkg.itinerary.map((day, index) => {
                            const dayNumber = day.dayNumber || index + 1;
                            return (
                              <li key={`${dayNumber}-${day.title}`} className="flex min-w-0 gap-4 border-t border-gray-200 py-6">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 font-display text-sm font-semibold text-brand-700 ring-1 ring-brand-100">
                                  {String(dayNumber).padStart(2, '0')}
                                </span>
                                <article className="min-w-0 pt-0.5">
                                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">Day {dayNumber}</p>
                                  <h3 className="mb-2 font-display text-xl font-semibold leading-snug text-brand-dark-900 sm:text-2xl">{day.title}</h3>
                                  {day.description && <p className="max-w-prose text-sm leading-relaxed text-gray-600 sm:text-base">{day.description}</p>}
                                  {day.locations.length > 0 && (
                                    <p className="mt-3 flex items-start gap-2 text-sm text-gray-600">
                                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                                      <span>{day.locations.join(' · ')}</span>
                                    </p>
                                  )}
                                  {day.activities.length > 0 && (
                                    <ul className="mt-4 flex flex-wrap gap-2">
                                      {day.activities.map((activity, activityIndex) => (
                                        <li key={`${activity}-${activityIndex}`} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-800">
                                          {activity}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </article>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <div className="mt-9 border-t border-gray-200 py-8">
                          <h3 className="mb-2 font-display text-xl font-semibold text-brand-dark-900">Itinerary details are being prepared</h3>
                          <p className="max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-base">
                            Contact our travel team for the latest day-by-day details for this package.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                {activeSection === 'inclusions' && (
                  <section className="-mx-6 bg-white px-6 pb-12 pt-6 lg:-mx-8 lg:px-8 lg:pb-2 lg:pt-6">
                    <div className="mx-auto max-w-7xl">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Know before you go</p>
                      <h2 className="mb-7 font-display text-3xl font-semibold text-brand-dark-900 sm:text-4xl">What's Included</h2>
                      <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2 lg:gap-8">
                        <section className="rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
                          <h3 className="mb-6 font-display text-3xl font-bold text-brand-dark-900">Inclusions</h3>
                          {pkg.inclusions.length > 0 ? (
                            <ul className="space-y-4">
                              {pkg.inclusions.map((item, index) => (
                                <li key={`${item}-${index}`} className="flex items-start gap-3 text-gray-700">
                                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-600 text-brand-600">
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                  <span className="pt-0.5 leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm leading-relaxed text-gray-600">Inclusion details are not available for this package yet.</p>
                          )}
                        </section>
                        <section className="rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
                          <h3 className="mb-6 font-display text-3xl font-bold text-brand-dark-900">Exclusions</h3>
                          {pkg.exclusions.length > 0 ? (
                            <ul className="space-y-4">
                              {pkg.exclusions.map((item, index) => (
                                <li key={`${item}-${index}`} className="flex items-start gap-3 text-gray-700">
                                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-600 text-red-600">
                                    <X className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                  <span className="pt-0.5 leading-relaxed">{item}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-sm leading-relaxed text-gray-600">Exclusion details are not available for this package yet.</p>
                          )}
                        </section>
                      </div>
                    </div>
                  </section>
                )}
                {activeSection === 'reviews' && (
                  <section className="-mx-6 bg-white px-6 pb-10 pt-8 lg:-mx-8 lg:px-8 lg:pb-12 lg:pt-6">
                    <div className="mx-auto max-w-7xl">
                      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16">
                        <aside className="lg:sticky lg:top-28 lg:self-start">
                          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Guest stories</p>
                          <h2 className="font-display text-3xl font-semibold text-brand-dark-900 sm:text-4xl">Traveler Reviews</h2>
                          <p className="mt-3 text-sm leading-relaxed text-gray-600">Firsthand notes from travelers who took this journey.</p>
                          <div className="mt-7 flex items-end gap-3">
                            <span className="font-display text-5xl font-semibold leading-none text-brand-dark-900">{pkg.rating > 0 ? pkg.rating.toFixed(1) : 'New'}</span>
                            <div className="pb-1">
                              <div className="flex items-center text-yellow-400" aria-label={`${pkg.rating} out of 5 stars`}>
                                {Array.from({ length: 5 }).map((_, index) => (
                                  <Star key={index} className={`h-4 w-4 ${index < Math.round(pkg.rating) ? 'fill-current' : ''}`} />
                                ))}
                              </div>
                              <p className="mt-1 text-xs text-gray-500">{pkg.reviews_count || reviews.length} {pluralize(pkg.reviews_count || reviews.length, 'review')}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowReviewModal(true)}
                            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 sm:w-auto"
                          >
                            <Star className="h-4 w-4" /> Write a Review
                          </button>
                        </aside>

                        <div aria-label="Traveler reviews">
                          {reviews.length > 0 ? (
                            <div className="divide-y divide-gray-200 border-y border-gray-200">
                              {reviews.map((review) => (
                                <article key={review.id} className="py-6 first:pt-5 last:pb-5">
                                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 font-display text-sm font-semibold text-brand-700 ring-1 ring-brand-100">
                                        {review.user_name.trim().charAt(0).toUpperCase() || 'T'}
                                      </span>
                                      <div>
                                        <h3 className="text-sm font-semibold text-gray-900">{review.user_name}</h3>
                                        <time className="mt-0.5 block text-xs text-gray-500" dateTime={review.created_at}>
                                          {new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                        </time>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1" aria-label={`${review.rating} out of 5 stars`}>
                                      {Array.from({ length: 5 }).map((_, index) => (
                                        <Star key={index} className={`h-4 w-4 ${index < review.rating ? 'fill-current text-yellow-400' : 'text-gray-300'}`} />
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex gap-3 pl-1">
                                    <Quote aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                                    <p className="max-w-3xl text-base leading-relaxed text-gray-700">{review.comment}</p>
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <div className="border-y border-gray-200 py-8">
                              <p className="font-display text-xl font-semibold text-brand-dark-900">No reviews yet</p>
                              <p className="mt-2 text-sm text-gray-600">Be the first to share a note about this journey.</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-8 border-t border-gray-200 pt-6">
                        <div ref={elRef} className="elfsight-app-29a1900e-0181-4873-aac0-7b426c7a478b" data-elfsight-app-lazy />
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <BookingModal
        open={showBookingModal}
        formData={formData}
        formErrors={formErrors}
        currentStep={currentStep}
        isSubmittingBooking={isSubmittingBooking}
        setFormData={setFormData}
        setFormErrors={setFormErrors}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onSubmit={handleSubmit}
        onClose={() => {
          setShowBookingModal(false);
          setCurrentStep(1);
          setFormErrors({});
        }}
      />

      {/* Review Modal - Mobile Responsive */}
      <ReviewModal
        open={showReviewModal}
        reviewData={reviewData}
        isSubmittingReview={isSubmittingReview}
        setReviewData={setReviewData}
        onSubmit={handleReviewSubmit}
        onClose={() => setShowReviewModal(false)}
      />

      {/* Success Modal - Mobile Responsive */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl success-modal-mobile sm:max-h-none sm:overflow-visible lg:p-8">
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <h2 className="text-2xl lg:text-3xl font-black text-gray-900 mb-3">Booking Submitted Successfully!</h2>
              <p className="text-gray-600 mb-6 leading-relaxed text-sm lg:text-base">
                Thank you for your booking request. We'll review your details and contact you within 24 hours to confirm your adventure!
              </p>
              {isDownloading && (
                <div className="mb-4 p-4 bg-brand-accent-50 border-2 border-brand-accent-200 rounded-xl">
                  <p className="text-sm text-brand-accent-800 font-semibold flex items-center justify-center gap-2">
                    <Download className="w-5 h-5 animate-bounce" />
                    Downloading your itinerary PDF...
                  </p>
                </div>
              )}
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    setIsDownloading(true);
                    try {
                      await downloadPDF();
                    } catch (error) {
                      console.error('Error downloading PDF:', error);
                    } finally {
                      setIsDownloading(false);
                    }
                  }}
                  disabled={isDownloading}
                  className="w-full bg-gradient-to-r from-brand-accent-500 to-brand-500 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-2xl transform hover:scale-105 active:scale-95 transition-all duration-300 button-padding-sm flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <Download className="w-5 h-5" />
                  {isDownloading ? 'Downloading...' : 'Download Itinerary PDF'}
                </button>
                <button
                  onClick={() => {
                    setShowSuccessModal(false);
                    setShowBookingModal(false);
                  }}
                  className="w-full bg-gray-100 text-gray-700 py-4 rounded-2xl font-bold text-lg hover:bg-gray-200 transition-all duration-300 button-padding-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review Success */}
      {showReviewSuccess && (
        <div className="fixed bottom-4 sm:bottom-6 left-4 right-4 sm:right-6 z-overlay animate-in fade-in slide-in-from-bottom-5 duration-300 max-w-sm mx-auto">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 lg:gap-4">
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center h-10 w-10 lg:h-12 lg:w-12 rounded-full bg-white/20 backdrop-blur-sm">
                <Check className="h-5 w-5 lg:h-6 lg:w-6 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm lg:text-base">Review Submitted!</p>
              <p className="text-sm text-white/90 mt-0.5 line-clamp-2">Thank you for sharing your experience.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}