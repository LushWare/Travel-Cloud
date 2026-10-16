import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Eye, ListChecks, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { STATUS_TABS, BOOKINGS_PAGE_SIZE, fmtDate, fmtMoney } from './helpers';
import { routeChain } from '@/features/shared/utils/flightSegments';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { FlightBookingRecord, FlightCancellationQuote } from './types';

const STATUS_STYLES: Record<string, string> = {
  cancelled: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
  confirmed: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
};

function BookingStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

interface BookingsPanelProps {
  bookings: FlightBookingRecord[];
  filteredBookings: FlightBookingRecord[];
  loading: boolean;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  statusCounts: Record<string, number>;
  search: string;
  setSearch: (value: string) => void;
  onLoadBooking: (id: string) => Promise<FlightBookingRecord | null>;
  onRequestCancellationQuote: (id: string, reason: string) => Promise<FlightCancellationQuote | null>;
  onCancel: (id: string, reason: string, cancellationId?: string | null) => Promise<boolean>;
}

export default function BookingsPanel({
  bookings,
  filteredBookings,
  loading,
  statusFilter,
  setStatusFilter,
  statusCounts,
  search,
  setSearch,
  onLoadBooking,
  onRequestCancellationQuote,
  onCancel,
}: BookingsPanelProps) {
  const [visibleCount, setVisibleCount] = useState(BOOKINGS_PAGE_SIZE);
  const [selectedBooking, setSelectedBooking] = useState<FlightBookingRecord | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [cancellationBooking, setCancellationBooking] = useState<FlightBookingRecord | null>(null);
  const [cancellationError, setCancellationError] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationQuote, setCancellationQuote] = useState<FlightCancellationQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const visibleBookings = filteredBookings.slice(0, visibleCount);
  const selectedServices = selectedBooking?.providerOrder?.services?.length
    ? selectedBooking.providerOrder.services
    : selectedBooking?.searchSnapshot?.selectedServices || [];

  const openBooking = async (booking: FlightBookingRecord) => {
    setSelectedBooking(booking);
    setLoadingDetails(true);
    setDetailsError('');
    try {
      const details = await onLoadBooking(booking.id);
      if (details) setSelectedBooking(details);
    } catch (error) {
      setDetailsError(apiErrorMessage(error));
    } finally {
      setLoadingDetails(false);
    }
  };

  const openCancellation = async (booking: FlightBookingRecord) => {
    setCancellationBooking(booking);
    setCancellationQuote(null);
    setCancellationReason('');
    setCancellationError('');
    setLoadingQuote(true);
    try {
      const details = await onLoadBooking(booking.id);
      if (!details) {
        setCancellationError('Could not load the current booking details.');
        return;
      }
      setCancellationBooking(details);
      if (!details.canCancel) {
        setCancellationError('The airline does not currently allow cancellation through this booking flow.');
        return;
      }
      const quote = await onRequestCancellationQuote(details.id, '');
      if (quote) setCancellationQuote(quote);
    } catch (error) {
      setCancellationError(apiErrorMessage(error));
    } finally {
      setLoadingQuote(false);
    }
  };

  const confirmCancellation = async () => {
    if (!cancellationBooking || !cancellationQuote) return;
    setConfirmingCancellation(true);
    setCancellationError('');
    try {
      const cancelled = await onCancel(cancellationBooking.id, cancellationReason, cancellationQuote.cancellationId);
      if (cancelled) setCancellationBooking(null);
    } catch (error) {
      setCancellationError(apiErrorMessage(error));
    } finally {
      setConfirmingCancellation(false);
    }
  };

  const closeDetails = () => {
    if (loadingQuote || confirmingCancellation) return;
    setSelectedBooking(null);
    setCancellationQuote(null);
    setDetailsError('');
  };

  const closeCancellation = () => {
    if (loadingQuote || confirmingCancellation) return;
    setCancellationBooking(null);
    setCancellationQuote(null);
    setCancellationError('');
  };

  useEffect(() => {
    setVisibleCount(BOOKINGS_PAGE_SIZE);
  }, [bookings, statusFilter, search]);

  const columns: DataTableColumn<FlightBookingRecord>[] = [
    { key: 'pnr', header: 'PNR', className: 'font-mono font-medium text-foreground', render: (b) => b.pnr || '-' },
    {
      key: 'route',
      header: 'Route',
      render: (b) => routeChain(b.segments) || '-',
    },
    { key: 'departure', header: 'Departure', numeric: true, render: (b) => fmtDate(b.segments?.[0]?.departureAt) },
    { key: 'travelers', header: 'Travelers', numeric: true, render: (b) => b.travelers?.length || 0 },
    { key: 'fare', header: 'Fare', numeric: true, render: (b) => fmtMoney(b.totalAmount, b.currency) },
    { key: 'status', header: 'Status', render: (b) => <BookingStatusBadge status={b.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (booking) => (
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => void openBooking(booking)}>
            <Eye className="h-3.5 w-3.5" /> Details
          </Button>
          {booking.status !== 'cancelled' && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void openCancellation(booking)}>
              <Ban className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={statusFilter} onValueChange={(value) => value && setStatusFilter(value)}>
            <TabsList>
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label} <span>{statusCounts[tab.id]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Input
            type="text"
            placeholder="Search by PNR or route..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
          <p className="text-sm">Loading bookings...</p>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="p-16 text-center">
          <ListChecks className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
          <h3 className="mb-1 text-lg font-semibold text-muted-foreground">
            {bookings.length === 0 ? 'No flight bookings yet' : 'No matching bookings'}
          </h3>
          <p className="text-sm text-muted-foreground/80">
            {bookings.length === 0 ? 'Search and book flights to see them here' : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <>
          <DataTable columns={columns} data={visibleBookings} getRowKey={(b) => b.id} className="rounded-none border-0 shadow-none" />
          <div className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
            Showing {visibleBookings.length} of {filteredBookings.length} booking{filteredBookings.length !== 1 ? 's' : ''}
            {visibleBookings.length < filteredBookings.length && (
              <Button variant="outline" size="sm" className="ml-3" onClick={() => setVisibleCount((c) => c + BOOKINGS_PAGE_SIZE)}>
                Show {Math.min(BOOKINGS_PAGE_SIZE, filteredBookings.length - visibleBookings.length)} more
              </Button>
            )}
          </div>
        </>
      )}

      <Dialog open={selectedBooking !== null} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] !max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Flight booking details</DialogTitle>
            <DialogDescription>
              {selectedBooking?.pnr ? `PNR ${selectedBooking.pnr}` : 'Booking reference pending'}
              {selectedBooking?.travelportOrderId ? ` · ${selectedBooking.travelportOrderId}` : ''}
            </DialogDescription>
          </DialogHeader>

          {loadingDetails ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading current booking details...
            </div>
          ) : selectedBooking ? (
            <div className="space-y-6">
              {detailsError && <p role="alert" className="text-sm text-destructive">{detailsError}</p>}
              <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-3">
                <div><div className="text-xs text-muted-foreground">Status</div><BookingStatusBadge status={selectedBooking.status} /></div>
                <div><div className="text-xs text-muted-foreground">Trip / cabin</div><div className="text-sm font-medium">{selectedBooking.tripType || 'Flight'} · {selectedBooking.cabinClass || 'Cabin not recorded'}</div></div>
                <div><div className="text-xs text-muted-foreground">Booked</div><div className="text-sm">{selectedBooking.bookedAt ? fmtDate(selectedBooking.bookedAt) : selectedBooking.createdAt ? fmtDate(selectedBooking.createdAt) : 'Not recorded'}</div></div>
                {selectedBooking.cancelledAt && <div><div className="text-xs text-muted-foreground">Cancelled</div><div className="text-sm">{fmtDate(selectedBooking.cancelledAt)}</div></div>}
                {selectedBooking.cancellationReason && <div className="sm:col-span-2"><div className="text-xs text-muted-foreground">Cancellation reason</div><div className="text-sm">{selectedBooking.cancellationReason}</div></div>}
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Itinerary</h3>
                <div className="divide-y divide-border">
                  {(selectedBooking.segments || []).map((segment, index) => (
                    <div key={`${segment.sequence ?? index}-${segment.flightNumber ?? ''}`} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <div>
                        <div className="font-mono text-sm font-semibold">{segment.origin} → {segment.destination}</div>
                        <div className="text-xs text-muted-foreground">{segment.marketingCarrier || ''} {segment.flightNumber || ''}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{segment.stops === 0 ? 'Nonstop' : `${segment.stops ?? 0} stop(s)`}</div>
                      <div className="sm:text-right">
                        <div className="text-sm">{fmtDate(segment.departureAt)}</div>
                        <div className="text-xs text-muted-foreground">Arrives {fmtDate(segment.arrivalAt)}</div>
                      </div>
                    </div>
                  ))}
                  {(!selectedBooking.segments || selectedBooking.segments.length === 0) && (
                    <p className="py-3 text-sm text-muted-foreground">No itinerary segments are stored for this booking.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Travelers</h3>
                <div className="divide-y divide-border">
                  {(selectedBooking.travelers || []).map((traveler, index) => (
                    <div key={`${traveler.firstName}-${traveler.lastName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium">{traveler.title ? `${traveler.title} ` : ''}{traveler.firstName} {traveler.lastName}</span>
                      <span className="text-muted-foreground">{traveler.type || 'Traveler'}{traveler.dob ? ` · DOB ${new Date(traveler.dob).toLocaleDateString()}` : ''}{traveler.gender ? ` · ${traveler.gender}` : ''}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Price and services</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Base fare</dt><dd className="text-right font-mono">{fmtMoney(selectedBooking.baseFare, selectedBooking.currency)}</dd>
                  <dt className="text-muted-foreground">Taxes</dt><dd className="text-right font-mono">{fmtMoney(selectedBooking.taxes, selectedBooking.currency)}</dd>
                  <dt className="font-semibold">Total</dt><dd className="text-right font-mono font-semibold">{fmtMoney(selectedBooking.totalAmount, selectedBooking.currency)}</dd>
                </dl>
                {selectedServices.length ? (
                  <ul className="mt-3 divide-y divide-border border-t border-border text-sm">
                    {selectedServices.map((service, index) => (
                      <li key={service.id || index} className="flex justify-between gap-3 py-2">
                        <span>{('type' in service && service.type) || 'Flight service'}{service.quantity ? ` × ${service.quantity}` : ''}</span>
                        <span className="font-mono">{'total_amount' in service && service.total_amount
                          ? fmtMoney(Number(service.total_amount), service.total_currency)
                          : service.id}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              {(selectedBooking.providerOrder?.conditions || selectedBooking.searchSnapshot?.refundable !== undefined || selectedBooking.searchSnapshot?.changeable !== undefined) && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Fare conditions</h3>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {selectedBooking.searchSnapshot?.refundable !== undefined && <p>Refund before departure: {selectedBooking.searchSnapshot.refundable ? 'Allowed' : 'Not allowed'}</p>}
                    {selectedBooking.searchSnapshot?.changeable !== undefined && <p>Change before departure: {selectedBooking.searchSnapshot.changeable ? 'Allowed' : 'Not allowed'}</p>}
                    {selectedBooking.providerOrder?.conditions?.refund_before_departure && (
                      <p>Current airline refund rule: {selectedBooking.providerOrder.conditions.refund_before_departure.allowed == null ? 'Unknown' : selectedBooking.providerOrder.conditions.refund_before_departure.allowed ? 'Allowed' : 'Not allowed'}
                        {selectedBooking.providerOrder.conditions.refund_before_departure.penalty_amount != null
                          ? ` · penalty ${fmtMoney(Number(selectedBooking.providerOrder.conditions.refund_before_departure.penalty_amount), selectedBooking.providerOrder.conditions.refund_before_departure.penalty_currency ?? undefined)}`
                          : ''}
                      </p>
                    )}
                    {selectedBooking.providerOrder?.conditions?.change_before_departure && (
                      <p>Current airline change rule: {selectedBooking.providerOrder.conditions.change_before_departure.allowed == null ? 'Unknown' : selectedBooking.providerOrder.conditions.change_before_departure.allowed ? 'Allowed' : 'Not allowed'}
                        {selectedBooking.providerOrder.conditions.change_before_departure.penalty_amount != null
                          ? ` · penalty ${fmtMoney(Number(selectedBooking.providerOrder.conditions.change_before_departure.penalty_amount), selectedBooking.providerOrder.conditions.change_before_departure.penalty_currency ?? undefined)}`
                          : ''}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {selectedBooking.providerOrder?.paymentStatus && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Payment status</h3>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>{selectedBooking.providerOrder.paymentStatus.paid_at ? 'Paid' : selectedBooking.providerOrder.paymentStatus.awaiting_payment ? 'Awaiting payment' : 'Payment status not provided'}</p>
                    {selectedBooking.providerOrder.paymentStatus.paid_at && <p>Paid at {fmtDate(selectedBooking.providerOrder.paymentStatus.paid_at)}</p>}
                    {selectedBooking.providerOrder.paymentStatus.payment_required_by && <p>Payment due by {fmtDate(selectedBooking.providerOrder.paymentStatus.payment_required_by)}</p>}
                    {selectedBooking.providerOrder.paymentStatus.price_guarantee_expires_at && <p>Price guaranteed until {fmtDate(selectedBooking.providerOrder.paymentStatus.price_guarantee_expires_at)}</p>}
                  </div>
                </section>
              )}

              {selectedBooking.providerOrder?.documents?.length ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Issued documents</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {selectedBooking.providerOrder.documents.map((document, index) => (
                      <li key={`${document.unique_identifier || document.type}-${index}`}>
                        {document.type || 'Document'}{document.unique_identifier ? ` · ${document.unique_identifier}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDetails} disabled={loadingQuote || confirmingCancellation}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellationBooking !== null} onOpenChange={(open) => !open && closeCancellation()}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cancel flight booking</DialogTitle>
            <DialogDescription>
              {cancellationBooking?.pnr ? `PNR ${cancellationBooking.pnr}` : 'Review the cancellation details before confirming.'}
              {cancellationBooking?.pnr ? ` · ${routeChain(cancellationBooking.segments)}` : ''}
            </DialogDescription>
          </DialogHeader>

          {loadingQuote ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Requesting the airline cancellation quote...
            </div>
          ) : (
            <div className="space-y-4">
              {cancellationError && <p role="alert" className="text-sm text-destructive">{cancellationError}</p>}
              {cancellationQuote && (
                <div className="space-y-2 border-l-2 border-warning pl-4">
                  {!cancellationQuote.quoteAvailable ? (
                    <p className="flex items-start gap-2 text-sm text-warning">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The provider did not return a refund quote. The refund amount and destination are unknown.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">
                        Refund: {cancellationQuote.refundAmount == null || cancellationQuote.refundCurrency == null
                          ? 'Amount not provided by airline'
                          : fmtMoney(Number(cancellationQuote.refundAmount), cancellationQuote.refundCurrency)}
                      </p>
                      <p className="text-sm text-muted-foreground">Refund destination: {cancellationQuote.refundTo?.replace(/_/g, ' ') || 'Not specified'}</p>
                      {cancellationQuote.expiresAt && <p className="text-xs text-muted-foreground">Quote expires {new Date(cancellationQuote.expiresAt).toLocaleString()}</p>}
                      {cancellationQuote.airlineCredits?.map((credit, index) => (
                        <p key={`${credit.credit_name || 'credit'}-${index}`} className="text-sm text-muted-foreground">
                          {credit.credit_name || 'Airline credit'}: {credit.credit_amount && credit.credit_currency ? fmtMoney(Number(credit.credit_amount), credit.credit_currency) : 'Amount not provided'}
                          {credit.credit_code ? ` · ${credit.credit_code}` : ''}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
              <Textarea
                placeholder="Cancellation reason (optional)"
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                rows={2}
                disabled={confirmingCancellation}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeCancellation} disabled={loadingQuote || confirmingCancellation}>Keep booking</Button>
            {cancellationQuote && (
              <Button variant="destructive" onClick={() => void confirmCancellation()} disabled={confirmingCancellation}>
                {confirmingCancellation ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm cancellation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
