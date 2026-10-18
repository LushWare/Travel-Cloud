import { ArrowRight, Calendar, Clock, MapPin, Users } from 'lucide-react';
import { formatCurrency } from '../../../lib/currency';
import { pluralize } from '../../../lib/pluralize';

export type AccountTab = 'bookings' | 'customized' | 'manual';

/**
 * A request/booking/plan card. All fields are optional because the three
 * tabs (regular bookings, customized packages, manual itineraries) render
 * different subsets of the same card layout.
 */
export interface RequestCardItem {
  _id?: string;
  id?: string;
  name?: string;
  notes?: string;
  isCustomized?: boolean;
  customizedPackageId?: string | null;
  isFromBooking?: boolean;
  packageId?: string;
  packageName?: string;
  packageDestination?: string;
  packageDuration?: number;
  packageCoverImage?: string;
  packageSlug?: string;
  packagePrice?: number;
  destination?: string;
  coverImage?: string;
  images?: { url?: string }[];
  travelDate?: string;
  numberOfTravelers?: number;
  paymentStatus?: string;
  bookingStatus?: string;
  totalAmount?: number;
  createdAt?: string;
  price?: number;
  duration?: number | string;
  maxGroupSize?: number | string;
  status?: string;
  days?: unknown[];
  lead?: {
    name?: string;
    destination?: string;
    numberOfTravelers?: number;
  };
}

interface RequestListProps {
  activeTab: AccountTab;
  items: RequestCardItem[];
  onExplorePackages: () => void;
  onViewDetails: (packageId?: string) => void;
}

const getStatusColor = (status?: string) => {
  switch (status?.toLowerCase()) {
    case 'confirmed':
      return 'bg-brand-100 text-brand-800';
    case 'pending':
      return 'bg-brand-accent-100 text-brand-accent-800';
    case 'cancelled':
      return 'bg-red-100 text-red-700';
    case 'completed':
      return 'bg-brand-100 text-brand-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getStatusBadge = (status?: string) => {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(status)}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending'}
    </span>
  );
};

export default function RequestList({ activeTab, items, onExplorePackages, onViewDetails }: RequestListProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
        <div className="mb-6">
          <Calendar className="w-20 h-20 text-gray-300 mx-auto" />
        </div>
        <h3 className="mb-3 font-serif text-2xl font-semibold text-gray-900">
          {activeTab === 'bookings' && 'No Regular Bookings'}
          {activeTab === 'customized' && 'No Customized Packages'}
          {activeTab === 'manual' && 'No Trip Plans'}
        </h3>
        <p className="text-gray-600 mb-8 text-lg">
          {activeTab === 'bookings' && "You haven't made any regular bookings yet. Start planning your next adventure!"}
          {activeTab === 'customized' && "You haven't created any customized packages yet. Create your perfect trip!"}
          {activeTab === 'manual' && "You haven't created any trip plans yet. Plan your journey with us!"}
        </p>
        <button
          onClick={onExplorePackages}
          className="inline-flex min-h-12 min-w-64 items-center justify-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-sans font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Explore Packages
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
      {items.map((item) => (
        <div
          key={item._id || item.id}
          className="group bg-white rounded-2xl overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors duration-300"
        >
          <div className="relative h-44 overflow-hidden bg-gray-200 sm:h-52 lg:h-56">
            {(() => {
              const imageUrl =
                activeTab === 'bookings'
                  ? item.packageCoverImage
                  : activeTab === 'customized'
                  ? item.coverImage || item.images?.[0]?.url
                  : undefined;
              return imageUrl ? (
                <>
                  <img
                    src={imageUrl}
                    alt={item.packageName || item.name || 'Trip'}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <MapPin className="w-16 h-16 text-gray-400" />
                </div>
              );
            })()}
            <div className="absolute top-4 right-4">
              {getStatusBadge(activeTab === 'bookings' ? item.bookingStatus : item.status || 'pending')}
            </div>
            <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur rounded-xl px-4 py-2">
              <p className="text-xs text-gray-600 font-semibold">
                {activeTab === 'bookings' ? 'Total Amount' : activeTab === 'customized' ? 'Price per Person' : 'Duration'}
              </p>
              <p className="text-xl font-bold text-brand-600">
                {activeTab === 'bookings' && formatCurrency(item.totalAmount)}
                {activeTab === 'customized' && formatCurrency(item.price)}
                {activeTab === 'manual' && pluralize(item.days?.length || 0, 'Day')}
              </p>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <h3 className="mb-1 line-clamp-2 font-serif text-lg font-semibold text-gray-900 transition-colors duration-300 group-hover:text-brand-600 sm:text-xl">
              {activeTab === 'bookings' && (item.packageName || 'Package')}
              {activeTab === 'customized' && (item.name || 'Customized Package')}
              {activeTab === 'manual' && (item.lead?.name || 'Trip Plan')}
            </h3>
            <div className="mb-3 flex items-center gap-2 text-gray-600">
              <MapPin className="w-4 h-4 text-brand-500 flex-shrink-0" />
              <span className="line-clamp-1">
                {activeTab === 'bookings' && (item.packageDestination || 'N/A')}
                {activeTab === 'customized' && (item.destination || 'N/A')}
                {activeTab === 'manual' && (item.lead?.destination || 'N/A')}
              </span>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 border-y border-gray-200 py-3">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold mb-1">
                  {activeTab === 'bookings' ? 'Travel Date' : activeTab === 'customized' ? 'Duration' : 'Days'}
                </p>
                <div className="flex items-center gap-1 text-gray-900 font-bold">
                  <Calendar className="w-4 h-4 text-brand-500" />
                  <span className="text-sm">
                    {activeTab === 'bookings' && (
                      item.travelDate
                        ? new Date(item.travelDate).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'N/A'
                    )}
                    {activeTab === 'customized' && `${item.duration ?? 0} days`}
                    {activeTab === 'manual' && pluralize(item.days?.length || 0, 'day')}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold mb-1">
                  {activeTab === 'bookings' ? 'Travelers' : 'Group Size'}
                </p>
                <div className="flex items-center gap-1 text-gray-900 font-bold">
                  <Users className="w-4 h-4 text-brand-500" />
                  <span className="text-sm">
                    {activeTab === 'bookings' && (item.numberOfTravelers || 1)}
                    {activeTab === 'customized' && (item.maxGroupSize || 'Any')}
                    {activeTab === 'manual' && (item.lead?.numberOfTravelers || 1)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                {activeTab === 'bookings' ? 'Payment Status' : 'Request Status'}
              </p>
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    activeTab === 'bookings'
                      ? item.paymentStatus === 'paid'
                        ? 'bg-brand-500'
                        : item.paymentStatus === 'partial'
                        ? 'bg-brand-accent-500'
                        : 'bg-red-600'
                      : item.status === 'confirmed' || item.status === 'completed'
                      ? 'bg-brand-500'
                      : item.status === 'pending'
                      ? 'bg-brand-accent-500'
                      : 'bg-gray-500'
                  }`}
                />
                <span className="font-semibold text-gray-900 text-sm capitalize">
                  {activeTab === 'bookings' && (item.paymentStatus || 'Pending')}
                  {(activeTab === 'customized' || activeTab === 'manual') && (item.status || 'Pending')}
                </span>
              </div>
            </div>
            <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4 text-brand-500" />
              <span>
                {activeTab === 'bookings' && 'Booked on'} {(activeTab === 'customized' || activeTab === 'manual') && 'Created on'}{' '}
                {(() => {
                  const dateValue = item.createdAt || item.travelDate;
                  return dateValue
                    ? new Date(dateValue).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'N/A';
                })()}
              </span>
            </div>
            {activeTab === 'bookings' && (
              <button
                onClick={() => {
                  onViewDetails(item.packageId);
                }}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-sans font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                View Details
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
