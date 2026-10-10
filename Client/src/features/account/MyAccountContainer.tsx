import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Edit2, Loader, Mail, Phone } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchUserBookings } from '../../services/api/booking';
import { fetchUserCustomizedPackages } from '../../services/api/customization';
import { fetchUserManualItineraries } from '../../services/api/manualItinerary';
import { updateProfile } from '../../services/api/account';
import { mergeStoredUser } from '../../services/auth/tokenStorage';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import ProfileEditModal from './components/ProfileEditModal';
import type { ProfileFormData, UpdateMessage } from './components/ProfileEditModal';
import RequestList from './components/RequestList';
import type { AccountTab, RequestCardItem } from './components/RequestList';

export default function MyAccountContainer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<RequestCardItem[]>([]);
  const [customizedPackages, setCustomizedPackages] = useState<RequestCardItem[]>([]);
  const [manualItineraries, setManualItineraries] = useState<RequestCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AccountTab>('bookings');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [formData, setFormData] = useState<ProfileFormData>({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<UpdateMessage | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    const settled = await Promise.all([
      fetchUserBookings().then(
        data => ({ data: data as RequestCardItem[] }),
        err => {
          console.error('Error loading bookings:', err);
          return { error: apiErrorMessage(err) };
        },
      ),
      fetchUserCustomizedPackages().then(
        data => ({ data: data as RequestCardItem[] }),
        err => {
          console.error('Error loading customized packages:', err);
          return { error: apiErrorMessage(err) };
        },
      ),
      fetchUserManualItineraries().then(
        data => ({ data: data as RequestCardItem[] }),
        err => {
          console.error('Error loading manual itineraries:', err);
          return { error: apiErrorMessage(err) };
        },
      ),
    ]);
    const [bookingsResult, customizedResult, manualResult] = settled;
    if ('data' in bookingsResult) setBookings(bookingsResult.data);
    if ('data' in customizedResult) setCustomizedPackages(customizedResult.data);
    if ('data' in manualResult) setManualItineraries(manualResult.data);
    const failures = settled.filter(
      (result): result is { error: string } => 'error' in result,
    );
    if (failures.length > 0) {
      setError(failures[0].error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
    });
    loadRequests();
  }, [user, navigate, authLoading, location, loadRequests]);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const normalBookings = bookings.filter(booking => {
    const hasCustomizedReference = booking.notes && booking.notes.includes('CustomizedPackage:');
    return !booking.isCustomized && !hasCustomizedReference;
  });

  const customizedFromBookings = bookings.filter(booking => {
    return booking.notes && booking.notes.includes('CustomizedPackage:');
  }).map(booking => {
    const match = booking.notes?.match(/CustomizedPackage:([a-f0-9]+)/);
    return {
      ...booking,
      customizedPackageId: match ? match[1] : null,
      isFromBooking: true,
    };
  });

  const allCustomizedPackages = customizedPackages.length > 0
    ? customizedPackages
    : customizedFromBookings;

  let activeData: RequestCardItem[] = [];
  if (activeTab === 'bookings') {
    activeData = normalBookings;
  } else if (activeTab === 'customized') {
    activeData = allCustomizedPackages;
  } else if (activeTab === 'manual') {
    activeData = manualItineraries;
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    setUpdateMessage(null);
    try {
      await updateProfile(formData);
      setUpdateMessage({ type: 'success', text: 'Profile updated successfully!' });
      setIsEditMode(false);

      mergeStoredUser(formData);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      console.error('Profile update error:', err);
      setUpdateMessage({ type: 'error', text: apiErrorMessage(err) });
      setTimeout(() => setUpdateMessage(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditMode(false);
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
    });
    setUpdateMessage(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Hero Section */}
      <div className="relative isolate flex min-h-[360px] items-end overflow-visible bg-brand-950 pb-14 pt-28 text-white sm:pb-16">
        <img
          src="/2.png"
          alt="A bright shoreline framed by tropical greenery"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-brand-950/90 via-brand-950/60 to-transparent" aria-hidden="true" />
        <div className="relative z-raised w-full max-w-7xl px-6 sm:px-12 md:px-24">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent-200">Your travel account</p>
          <h1
            className="mb-4 max-w-none font-serif text-4xl font-medium leading-[1.1] text-white drop-shadow-sm sm:text-6xl xl:whitespace-nowrap"
          >
            Welcome back, <span className="text-brand-accent-200">{user?.name || 'Traveler'}.</span>
          </h1>
          <p className="max-w-4xl text-base font-light leading-6 text-white/90 sm:text-lg xl:whitespace-nowrap">
            Manage your bookings, customized packages, and travel plans all in one place.
          </p>
        </div>

        {/* Tabs Overlay */}
        <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-12 z-elevated">
          <div className="bg-white rounded-2xl border border-gray-200 p-1 flex justify-center gap-2 flex-wrap w-fit">
            <button
              onClick={() => setActiveTab('bookings')}
              className={`min-h-12 rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:text-base ${
                activeTab === 'bookings'
                  ? 'bg-brand-600 text-white'
                  : 'text-brand-800 hover:bg-brand-50'
              }`}
            >
              Regular Bookings ({normalBookings.length})
            </button>
            <button
              onClick={() => setActiveTab('customized')}
              className={`min-h-12 rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:text-base ${
                activeTab === 'customized'
                  ? 'bg-brand-600 text-white'
                  : 'text-brand-800 hover:bg-brand-50'
              }`}
            >
              Customized Packages ({allCustomizedPackages.length})
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`min-h-12 rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:text-base ${
                activeTab === 'manual'
                  ? 'bg-brand-600 text-white'
                  : 'text-brand-800 hover:bg-brand-50'
              }`}
            >
              Trip Plans ({manualItineraries.length})
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-8xl mx-auto px-4 py-12 pt-20">
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="w-full flex-shrink-0 rounded-2xl border border-gray-200 bg-white p-6 lg:sticky lg:top-24 lg:w-80 lg:self-start">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-16 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
                {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-serif text-xl font-semibold text-gray-900">{user?.name || 'Traveler'}</h2>
              </div>
            </div>

            <div className="mb-4 space-y-2">
              <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <Mail className="mt-0.5 size-4 flex-shrink-0 text-brand-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-600">Email:</p>
                  <p className="truncate text-sm font-medium text-gray-900">{user?.email}</p>
                </div>
              </div>
              {user?.phone && (
                <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <Phone className="mt-0.5 size-4 flex-shrink-0 text-brand-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-600">Phone:</p>
                    <p className="truncate text-sm font-medium text-gray-900">{user.phone}</p>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              <Edit2 className="size-4" aria-hidden="true" />
              Edit Profile
            </button>
          </aside>

          {/* Right Column */}
          <div className="flex-1 w-full lg:w-auto" data-main-content>
            <div>
              <h2 className="mb-12 font-serif text-3xl font-semibold text-gray-900">My Requests</h2>

              {loading ? (
                <div className="flex items-center justify-center py-24" role="status">
                  <div className="text-center">
                    <Loader className="w-16 h-16 text-brand-500 animate-spin mx-auto mb-4" aria-hidden="true" />
                    <p className="text-gray-600 font-semibold text-lg">Loading your requests...</p>
                  </div>
                </div>
              ) : error ? (
                <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-10 text-center">
                  <p className="text-red-700 font-semibold text-lg mb-2">Error Loading Requests</p>
                  <p className="text-red-600 mb-6">{error}</p>
                  <button
                    type="button"
                    onClick={() => { void loadRequests(); }}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 py-3 font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <RequestList
                  activeTab={activeTab}
                  items={activeData}
                  onExplorePackages={() => navigate('/packages')}
                  onViewDetails={(packageId) => navigate(`/package/${packageId}`)}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile */}
      {isEditMode && (
        <ProfileEditModal
          formData={formData}
          onChange={handleInputChange}
          onSave={handleSaveProfile}
          onCancel={handleCancel}
          isSaving={isSaving}
          updateMessage={updateMessage}
        />
      )}
    </div>
  );
}
