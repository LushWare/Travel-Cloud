import { useState, useEffect } from 'react';
import { Building2, Loader2, AlertCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { getCountryCodeFromDestination, getMappedCityFromDestination } from '@/features/itinerary/utils/destinationMapping';
import HotelService from '../../../services/hotel.service';
import { deriveItemState, ITEM_STATE_LABELS, ITEM_STATE_COLORS } from '../utils/bookingState';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(amount: number | null | undefined, currency: string | undefined) {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
}

function sameHotelStay(left: any, right: any) {
  const leftAccommodation = left.accommodation || {};
  const rightAccommodation = right.accommodation || {};
  const leftId = leftAccommodation.hotelId;
  const rightId = rightAccommodation.hotelId;
  if (leftId && rightId) return String(leftId) === String(rightId);

  const leftName = String(leftAccommodation.name || '').trim().toLocaleLowerCase();
  const rightName = String(rightAccommodation.name || '').trim().toLocaleLowerCase();
  const leftLocation = String(leftAccommodation.address || leftAccommodation.city || '').trim().toLocaleLowerCase();
  const rightLocation = String(rightAccommodation.address || rightAccommodation.city || '').trim().toLocaleLowerCase();
  return Boolean(leftName && leftName === rightName && (!leftLocation || !rightLocation || leftLocation === rightLocation));
}

function groupHotelStays(days: any[]) {
  const stays: Array<{ startDay: any; endDay: any }> = [];
  const orderedDays = days
    .filter((day) => day?.accommodation?.name)
    .sort((left, right) => left.dayNumber - right.dayNumber);

  orderedDays.forEach((day) => {
    const currentStay = stays[stays.length - 1];
    if (
      currentStay
      && day.dayNumber === currentStay.endDay.dayNumber + 1
      && sameHotelStay(currentStay.endDay, day)
    ) {
      currentStay.endDay = day;
      return;
    }
    stays.push({ startDay: day, endDay: day });
  });

  return stays;
}

interface LeadHotelBookingsSectionProps {
  leadId?: string;
  packageId?: string;
  leadStatus?: string;
  itineraryDays?: any[];
  travelDate?: string;
  destination?: string;
  country?: string;
  travelers?: number;
}

export default function LeadHotelBookingsSection({
  leadId,
  packageId,
  leadStatus,
  itineraryDays = [],
  travelDate,
  destination = '',
  country = '',
  travelers = 1,
}: LeadHotelBookingsSectionProps) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(true);

  const fetchBookings = async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await HotelService.getByLead(leadId);
      setBookings(res.data || []);
    } catch (err: any) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (leadId) fetchBookings();
    const refreshWhenActive = () => fetchBookings();
    window.addEventListener('focus', refreshWhenActive);
    return () => window.removeEventListener('focus', refreshWhenActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const hotelSearchHref = (stay: { startDay: any; endDay: any }) => {
    const accommodation = stay.startDay.accommodation || {};
    const endAccommodation = stay.endDay.accommodation || {};
    const params = new URLSearchParams();
    const locationText = [accommodation.city, accommodation.location, accommodation.address, destination, country]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(', ');
    const countryValue = accommodation.countryCode || accommodation.country || country;
    const countryCode = /^[A-Z]{2}$/i.test(countryValue)
      ? countryValue.toUpperCase()
      : getCountryCodeFromDestination(locationText) || countryValue;
    const city = accommodation.city
      || getMappedCityFromDestination(locationText, countryCode)
      || accommodation.location;
    if (city) params.set('city', city);
    if (countryCode) params.set('country', countryCode);
    if (destination) params.set('destination', destination);
    if (accommodation.address) params.set('address', accommodation.address);
    const dateAtDay = (offset: number) => {
      if (!travelDate) return '';
      const date = new Date(`${travelDate.slice(0, 10)}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    params.set('checkin', accommodation.checkin || dateAtDay(stay.startDay.dayNumber - 1));
    params.set('checkout', endAccommodation.checkout || dateAtDay(stay.endDay.dayNumber));
    params.set('adults', String(Math.max(1, travelers)));
    if (leadId) params.set('leadId', leadId);
    if (packageId) params.set('packageId', packageId);
    params.set('dayNumber', String(stay.startDay.dayNumber));
    if (accommodation.name) params.set('hotelName', accommodation.name);
    return `/hotels?${params.toString()}`;
  };

  const hotelBookingHref = (bookingId: string) =>
    `/hotels?tab=bookings&ids=${encodeURIComponent(bookingId)}&bookingId=${encodeURIComponent(bookingId)}&focus=recommendation`;

  const hotelStays = groupHotelStays(itineraryDays);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading hotel bookings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 rounded-xl bg-primary text-primary-foreground"
      >
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          <span className="font-semibold">Hotel Bookings</span>
          {bookings.length > 0 && (
            <span className="text-xs bg-primary-foreground/20 px-2 py-0.5 rounded-full">{bookings.length}</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>

      {expanded && (
        <div className="space-y-4 p-4 bg-muted/40 rounded-2xl border border-border">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
              <button onClick={fetchBookings} className="ml-auto text-destructive font-medium hover:underline">Retry</button>
            </div>
          )}

          {hotelStays.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Itinerary Hotels</div>
              {hotelStays.map((stay) => {
                const stayBookings = bookings.filter((booking) =>
                  booking.dayNumber >= stay.startDay.dayNumber
                  && booking.dayNumber <= stay.endDay.dayNumber
                  && (booking.packageId || null) === (packageId || null));
                const dayBooking = stayBookings.find((booking) => booking.status !== 'cancelled' && booking.status !== 'failed')
                  || stayBookings[0];
                const booked = !!dayBooking && dayBooking.status !== 'cancelled' && dayBooking.status !== 'failed';
                const failed = !!dayBooking && dayBooking.status === 'failed';
                const itemState = deriveItemState(leadStatus ?? '', booked, failed);
                const stateLabel = ITEM_STATE_LABELS[itemState];
                const stateColor = ITEM_STATE_COLORS[itemState];
                const dayLabel = stay.startDay.dayNumber === stay.endDay.dayNumber
                  ? `Day ${stay.startDay.dayNumber}`
                  : `Days ${stay.startDay.dayNumber}-${stay.endDay.dayNumber}`;
                return (
                  <div key={stay.startDay.dayNumber} className="bg-card rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{dayLabel}</span>
                        <span className="text-sm text-muted-foreground">{stay.startDay.accommodation?.name}</span>
                        <span className={`px-1.5 py-0.5 text-xs rounded-full border ${stateColor}`}>
                          {stateLabel}
                        </span>
                      </div>
                      {itemState === 'PENDING' ? (
                        <Button type="button" disabled variant="secondary" size="sm">
                          <Building2 className="w-3.5 h-3.5" /> Select Hotel
                        </Button>
                      ) : itemState === 'READY_TO_BOOK' ? (
                        <a
                          href={hotelSearchHref(stay)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Search &amp; book
                        </a>
                      ) : itemState === 'BOOKED' ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {dayBooking.pnrCode && (
                            <a
                              href={hotelBookingHref(dayBooking.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open hotel booking ${dayBooking.pnrCode}`}
                              className="inline-flex items-center gap-1 font-mono font-medium text-primary hover:underline"
                            >
                              {dayBooking.pnrCode} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <span className="capitalize">{dayBooking.status}</span>
                          {dayBooking.supplierPortalUrl && (
                            <a href={dayBooking.supplierPortalUrl} target="_blank" rel="noopener noreferrer"
                               className="flex items-center gap-1 text-primary hover:text-primary/80">
                              <ExternalLink className="w-3 h-3" /> Portal
                            </a>
                          )}
                          {dayBooking.status !== 'cancelled' && (
                            <a
                              href={hotelBookingHref(dayBooking.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-destructive hover:text-destructive/80"
                            >
                              <ExternalLink className="w-3 h-3" /> Cancel / manage
                            </a>
                          )}
                        </div>
                      ) : itemState === 'FAILED' && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-destructive font-medium">Booking failed</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => window.open(hotelSearchHref(stay), '_blank', 'noopener,noreferrer')}
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Search again
                          </Button>
                        </div>
                      )}
                    </div>
                    {stay.startDay.accommodation?.address && (
                      <div className="mt-1 text-xs text-muted-foreground">{stay.startDay.accommodation.address}</div>
                    )}
                    {booked && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {fmtDate(dayBooking.checkin)} → {fmtDate(dayBooking.checkout)}{' · '}
                        {fmtMoney(dayBooking.totalAmount, dayBooking.currency)}
                      </div>
                    )}
                    {failed && (
                      <div className="mt-1 text-xs text-destructive">
                        Booking attempt failed — manual intervention required.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hotels in this itinerary</p>
              <p className="text-xs mt-1">Add hotel details to the itinerary to start a booking</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
