import { useState, useEffect, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Hotel, Search, ChevronRight, ChevronLeft,
  Loader2, CheckCircle2, Ban, ListChecks, Star,
  Users, MapPin, Building2, Info,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import HotelService from '../services/hotel.service';
import CountrySelect from '../components/CountrySelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';
import PageHeader from '../components/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface HotelRate {
  offerId?: string;
  roomType?: string;
  boardType?: string;
  refundable?: boolean;
  totalAmount?: number;
  currency?: string;
}

interface HotelOffer {
  hotelId: string;
  name: string;
  starRating?: number;
  address?: string;
  images?: string[];
  cheapestRate?: HotelRate;
}

interface Guest {
  firstName: string;
  lastName: string;
  title: string;
}

interface Booking {
  id: string;
  hotelName?: string;
  checkin?: string;
  guestInfo?: unknown[];
  totalAmount?: number;
  currency?: string;
  status?: string;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const tomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

function fmtDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtMoney(amount?: number, currency?: string) {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount);
}

function StarRating({ rating }: { rating?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < (rating || 0) ? 'fill-warning text-warning' : 'text-muted'}`}
        />
      ))}
    </div>
  );
}

function HotelCard({ offer, onSelect }: { offer: HotelOffer; onSelect: (offer: HotelOffer) => void }) {
  const rate = offer.cheapestRate || {};
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col md:flex-row gap-4 hover:border-primary/40 hover:shadow-[var(--shadow-card)] transition-all">
      <div className="w-full md:w-48 h-36 rounded-lg overflow-hidden bg-muted shrink-0">
        {offer.images?.[0] ? (
          <img src={offer.images[0]} alt={offer.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Building2 className="w-10 h-10" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <h3 className="font-semibold text-foreground">{offer.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <StarRating rating={offer.starRating || 3} />
              <span className="text-xs text-muted-foreground">{offer.starRating}-star</span>
            </div>
          </div>
        </div>
        {offer.address && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
            <MapPin className="w-3 h-3" /> {offer.address}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">
            {rate.roomType || 'Standard'}
          </Badge>
          <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">
            {rate.boardType || 'Room Only'}
          </Badge>
          {rate.refundable && (
            <Badge variant="outline" className="bg-success/10 text-success border-transparent">
              Refundable
            </Badge>
          )}
        </div>
      </div>

      <div className="text-right shrink-0 flex flex-col justify-between">
        <div>
          <div className="text-2xl font-bold font-mono tabular-nums text-foreground">
            {fmtMoney(rate.totalAmount, rate.currency)}
          </div>
          <div className="text-xs text-muted-foreground">incl. taxes</div>
        </div>
        <Button onClick={() => onSelect(offer)} className="mt-3 gap-1.5 h-9">
          Select <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

type Tab = 'search' | 'bookings';
type Step = 'results' | 'guests' | 'review' | 'confirmation';

export default function HotelSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const linkedBookingIds = new Set((searchParams.get('ids') || '').split(',').filter(Boolean));
  const [activeTab, setActiveTab] = useState<Tab>(() => searchParams.get('tab') === 'bookings' ? 'bookings' : 'search');

  useEffect(() => {
    if (searchParams.get('tab') === 'bookings') setActiveTab('bookings');
  }, [searchParams]);

  const [form, setForm] = useState({
    city: '',
    country: 'LK',
    checkin: todayStr(),
    checkout: tomorrowStr(),
    adults: 1,
    children: 0,
    currency: 'USD',
  });
  const [searching, setSearching] = useState(false);
  const [offers, setOffers] = useState<HotelOffer[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [step, setStep] = useState<Step>('results');
  const [selectedOffer, setSelectedOffer] = useState<HotelOffer | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [booking, setBooking] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<{ id: string; reason: string } | null>(null);

  const paxCount = form.adults + form.children;

  const handleSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.city && !form.checkin) {
      toast.error('City and dates are required');
      return;
    }

    setSearching(true);
    setHasSearched(true);
    setOffers([]);
    setStep('results');
    try {
      const response = await HotelService.search({
        city: form.city || undefined,
        country: form.country,
        checkin: form.checkin,
        checkout: form.checkout,
        occupancies: [{ adults: form.adults, children: form.children || 0 }],
        currency: form.currency,
        guestNationality: form.country,
        limit: 20,
      });
      setOffers(response.data || []);
      if (!response.data?.length) toast('No hotels found', { type: 'info' });
    } catch (err) {
      toast.error((err as Error)?.message || 'Hotel search failed');
    } finally {
      setSearching(false);
    }
  };

  const selectOffer = (offer: HotelOffer) => {
    setSelectedOffer(offer);
    setGuests(Array.from({ length: paxCount }, () => ({ firstName: '', lastName: '', title: 'Mr' })));
    setStep('guests');
  };

  const updateGuest = (i: number, field: keyof Guest, value: string) =>
    setGuests((prev) => prev.map((g, idx) => (idx === i ? { ...g, [field]: value } : g)));

  const goToReview = () => {
    for (const g of guests) {
      if (!g.firstName || !g.lastName) {
        toast.error('Every guest needs a first and last name');
        return;
      }
    }
    if (!contact.email) {
      toast.error('Contact email is required');
      return;
    }
    setStep('review');
  };

  const confirmBooking = async () => {
    setBooking(true);
    try {
      const offerId = selectedOffer?.cheapestRate?.offerId;
      const pre = await HotelService.prebook({ offerId: offerId || 'mock-offer' });
      const response = await HotelService.book({
        prebookId: pre.data?.prebookId || 'mock-prebook-id',
        guests,
        contact,
        offer: selectedOffer,
      });
      setConfirmedBooking(response.data);
      setStep('confirmation');
      toast.success('Hotel booked');
    } catch (err) {
      toast.error((err as Error)?.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const resetSearch = () => {
    setOffers([]);
    setHasSearched(false);
    setSelectedOffer(null);
    setGuests([]);
    setContact({ name: '', email: '', phone: '' });
    setConfirmedBooking(null);
    setStep('results');
  };

  const fetchBookings = async () => {
    setLoadingBookings(true);
    try {
      const r = await HotelService.listBookings();
      setBookings(r.data || []);
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load bookings');
    } finally {
      setLoadingBookings(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'bookings') fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'bookings' || linkedBookingIds.size === 0 || !recommendationFocus || loadingBookings) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, searchParams, recommendationFocus, loadingBookings]);

  const visibleBookings = linkedBookingIds.size > 0
    ? bookings.filter((booking) => linkedBookingIds.has(booking.id))
    : bookings;

  const cancelBooking = async (id: string, reason: string) => {
    try {
      await HotelService.cancelBooking(id, reason);
      toast.success('Cancelled');
      setCancelDialog(null);
      fetchBookings();
    } catch (err) {
      toast.error((err as Error)?.message || 'Cancel failed');
    }
  };

  return (
    <>
      <PageHeader title="Hotels" subtitle="Search and book hotels worldwide" />
      <div className="mx-auto max-w-7xl px-4 pt-4 md:px-6"><RecommendationStrip module="hotels" /></div>
      <div className="min-h-screen bg-background p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (!value) return;
            setActiveTab(value as Tab);
            setSearchParams({ tab: value });
            if (value === 'search') resetSearch();
          }}
        >
          <TabsList>
            <TabsTrigger value="search" className="gap-1.5">
              <Search className="w-4 h-4" /> Search & Book
            </TabsTrigger>
            <TabsTrigger value="bookings" className="gap-1.5">
              <ListChecks className="w-4 h-4" /> Bookings
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === 'search' && (
        <>
          {step === 'results' && (
            <>
              <form onSubmit={handleSearch} className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">City</label>
                    <Input
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      placeholder="e.g. Colombo, Dubai"
                      className="h-10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Country</label>
                    <CountrySelect
                      value={form.country}
                      onChange={(code: string) => setForm({ ...form, country: code })}
                      placeholder="Search country..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Check-in</label>
                    <Input
                      type="date"
                      value={form.checkin}
                      min={todayStr()}
                      onChange={(e) => setForm({ ...form, checkin: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Check-out</label>
                    <Input
                      type="date"
                      value={form.checkout}
                      min={form.checkin || todayStr()}
                      onChange={(e) => setForm({ ...form, checkout: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Guests</label>
                    <div className="flex items-center gap-1">
                      <select
                        value={form.adults}
                        onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })}
                        className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none flex-1"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                          <option key={n} value={n}>
                            {n} adult{n > 1 ? 's' : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        value={form.children}
                        onChange={(e) => setForm({ ...form, children: Number(e.target.value) })}
                        className="h-10 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none flex-1"
                      >
                        {[0, 1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n} child{n !== 1 ? 'ren' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <Button type="submit" disabled={searching} className="gap-2 h-10">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {searching ? 'Searching...' : 'Search Hotels'}
                </Button>
              </form>

              {searching && (
                <div className="text-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  <p className="text-sm text-muted-foreground mt-2">Searching hotels...</p>
                </div>
              )}
              {hasSearched &&
                !searching &&
                (offers.length === 0 ? (
                  <div className="text-center py-16 bg-card rounded-xl border border-border">
                    <Hotel className="w-12 h-12 text-muted mx-auto mb-3" />
                    <p className="text-muted-foreground">No hotels found. Try a different city or dates.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {offers.length} hotel{offers.length !== 1 ? 's' : ''} found
                    </p>
                    {offers.map((offer) => (
                      <HotelCard key={offer.hotelId} offer={offer} onSelect={selectOffer} />
                    ))}
                  </div>
                ))}
            </>
          )}

          {step === 'guests' && selectedOffer && (
            <div className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-6">
              <button
                onClick={() => setStep('results')}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back to results
              </button>
              <div className="bg-muted/50 rounded-lg p-4 mb-6 flex items-center gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-foreground">{selectedOffer.name}</div>
                  <StarRating rating={selectedOffer.starRating} />
                </div>
                <div className="ml-auto text-right">
                  <div className="text-lg font-bold font-mono tabular-nums text-foreground">
                    {fmtMoney(selectedOffer.cheapestRate?.totalAmount, selectedOffer.cheapestRate?.currency)}
                  </div>
                  <div className="text-xs text-muted-foreground">total</div>
                </div>
              </div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
                <Users className="w-5 h-5 text-muted-foreground" /> Guest Details
              </h2>
              {guests.map((g, i) => (
                <div key={i} className="border border-border rounded-lg p-4 mb-3">
                  <div className="text-sm font-semibold text-foreground mb-3">Guest {i + 1}</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <select
                      value={g.title}
                      onChange={(e) => updateGuest(i, 'title', e.target.value)}
                      className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {['Mr', 'Mrs', 'Ms', 'Miss'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <Input
                      placeholder="First name *"
                      value={g.firstName}
                      onChange={(e) => updateGuest(i, 'firstName', e.target.value)}
                      className="h-9"
                    />
                    <Input
                      placeholder="Last name *"
                      value={g.lastName}
                      onChange={(e) => updateGuest(i, 'lastName', e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
              ))}
              <div className="border border-border rounded-lg p-4 mb-6">
                <div className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4 text-muted-foreground" /> Contact
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    placeholder="Full name"
                    value={contact.name}
                    onChange={(e) => setContact({ ...contact, name: e.target.value })}
                    className="h-9"
                  />
                  <Input
                    placeholder="Email *"
                    type="email"
                    value={contact.email}
                    onChange={(e) => setContact({ ...contact, email: e.target.value })}
                    className="h-9"
                  />
                  <Input
                    placeholder="Phone"
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
              <Button onClick={goToReview} className="gap-1.5 h-10">
                Review Booking <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {step === 'review' && selectedOffer && (
            <div className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-6">
              <button
                onClick={() => setStep('guests')}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <h2 className="text-lg font-semibold mb-4 text-foreground">Review & Confirm</h2>
              <div className="bg-muted/50 rounded-lg p-4 mb-4">
                <div className="font-semibold text-foreground">{selectedOffer.name}</div>
                <div className="text-sm text-muted-foreground">
                  {fmtDate(form.checkin)} &rarr; {fmtDate(form.checkout)} &middot; {guests.length} guest
                  {guests.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="mb-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Guests</div>
                {guests.map((g, i) => (
                  <div key={i} className="text-sm text-foreground">
                    {g.title} {g.firstName} {g.lastName}
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-4 mb-6">
                <div className="flex justify-between text-lg font-bold text-foreground">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">
                    {fmtMoney(selectedOffer.cheapestRate?.totalAmount, selectedOffer.cheapestRate?.currency)}
                  </span>
                </div>
              </div>
              <Button onClick={confirmBooking} disabled={booking} className="gap-2 h-11">
                {booking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {booking ? 'Booking...' : 'Confirm Booking'}
              </Button>
            </div>
          )}

          {step === 'confirmation' && confirmedBooking && (
            <div className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-9 h-9 text-success" />
              </div>
              <h2 className="text-xl font-bold mb-1 text-foreground">Booking Confirmed</h2>
              <p className="text-muted-foreground mb-4">
                {confirmedBooking.hotelName || 'Hotel'} &middot; {confirmedBooking.bookingId}
              </p>
              <Button onClick={resetSearch} className="h-10">
                New Search
              </Button>
            </div>
          )}
        </>
      )}

      {activeTab === 'bookings' && (
        <>
        {linkedBookingIds.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-sm text-foreground">Active filter: linked hotel bookings <span className="font-mono tabular-nums">({visibleBookings.length})</span></p>
            <Button variant="ghost" size="sm" onClick={() => setSearchParams({ tab: 'bookings' })}>Clear filter</Button>
          </div>
        )}
        <div id="recommendation-target" className="scroll-mt-20 bg-card rounded-xl shadow-[var(--shadow-card)] border border-border overflow-hidden">
          {loadingBookings ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : visibleBookings.length === 0 ? (
            <div className="p-16 text-center">
              <ListChecks className="w-12 h-12 text-muted mx-auto mb-3" />
              <p className="text-muted-foreground">{bookings.length === 0 ? 'No hotel bookings yet.' : 'No matching hotel bookings.'}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3">Hotel</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Guests</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{b.hotelName || 'Unknown'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(b.checkin)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.guestInfo?.length || '-'}</td>
                    <td className="px-4 py-3 font-medium font-mono tabular-nums text-foreground">
                      {fmtMoney(b.totalAmount, b.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={
                          b.status === 'cancelled'
                            ? 'bg-destructive/10 text-destructive border-transparent'
                            : 'bg-success/10 text-success border-transparent'
                        }
                      >
                        {b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {b.status !== 'cancelled' && (
                        <button
                          onClick={() => setCancelDialog({ id: b.id, reason: '' })}
                          className="flex items-center gap-1 text-destructive hover:text-destructive/80 text-xs font-medium transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}

      <Dialog open={!!cancelDialog} onOpenChange={(open) => !open && setCancelDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Booking</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason (optional)"
            value={cancelDialog?.reason || ''}
            onChange={(e) => cancelDialog && setCancelDialog({ ...cancelDialog, reason: e.target.value })}
            rows={2}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelDialog && cancelBooking(cancelDialog.id, cancelDialog.reason)}
            >
              Cancel Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}
