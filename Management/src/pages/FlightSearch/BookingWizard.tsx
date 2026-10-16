import { useState } from 'react';
import { DuffelAncillaries, DuffelCardForm, createThreeDSecureSession, useDuffelCardFormActions } from '@duffel/components';
import { ChevronLeft, ChevronRight, Info, Users, AlertCircle, CheckCircle2, Loader2, Copy, ArrowRightLeft, CreditCard, Luggage, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { fmtDate, fmtMoney } from './helpers';
import { routeChain } from '@/features/shared/utils/flightSegments';
import type { ContactForm, DuffelCheckoutData, DuffelPassenger, FlightOffer, SelectedDuffelService, TravelerForm, TravelerType } from './types';

const TRAVELER_TYPE_LABEL: Record<TravelerType, string> = { adult: 'Adults', child: 'Children', infant: 'Infants' };
const GENDER_LABEL: Record<string, string> = { M: 'Male', F: 'Female' };

// ── Flight summary bar (shared by the traveler-details and review steps) ──
function FlightSummary({ offer }: { offer: FlightOffer }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg bg-muted/50 p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {offer.airlineCode}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{offer.airline} · {offer.cabinClass}</div>
        <div className="text-xs text-muted-foreground">
          {(offer.segments || []).map((s, i) => (
            <span key={i}>
              {s.origin} → {s.destination}
              {i < (offer.segments || []).length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="ml-auto text-right">
        <div className="font-mono text-lg font-bold tabular-nums text-foreground">{fmtMoney(offer.fareTotal, offer.currency)}</div>
        <div className="text-xs text-muted-foreground">total fare</div>
      </div>
    </div>
  );
}

interface TravelerDetailsStepProps {
  selectedOffer: FlightOffer;
  checkoutData: DuffelCheckoutData;
  priceChange: { previousTotal: number; currentTotal: number; currency: string } | null;
  priceChangeAccepted: boolean;
  onPriceChangeAccepted: (accepted: boolean) => void;
  travelers: TravelerForm[];
  updateTraveler: (index: number, field: keyof TravelerForm, value: string) => void;
  contact: ContactForm;
  setContact: (contact: ContactForm) => void;
  onSelectUpsell: (offerId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function TravelerDetailsStep({ selectedOffer, checkoutData, priceChange, priceChangeAccepted, onPriceChangeAccepted, travelers, updateTraveler, contact, setContact, onSelectUpsell, onBack, onNext }: TravelerDetailsStepProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to results
      </button>

      <FlightSummary offer={selectedOffer} />
      <DuffelOfferDetails offer={checkoutData.offer} />

      {priceChange && (
        <label className="mb-6 flex cursor-pointer items-start gap-3 border border-warning/40 bg-warning/5 p-4 text-sm">
          <input
            type="checkbox"
            checked={priceChangeAccepted}
            onChange={(event) => onPriceChangeAccepted(event.target.checked)}
            className="mt-1"
          />
          <span>
            The fare changed from <strong>{fmtMoney(priceChange.previousTotal, priceChange.currency)}</strong> to{' '}
            <strong>{fmtMoney(priceChange.currentTotal, priceChange.currency)}</strong>. I accept the updated fare.
          </span>
        </label>
      )}

      {checkoutData.upsellOffers.length > 0 && (
        <section className="mb-6 rounded-lg border border-border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Fare Options &amp; Cabin Upgrades
            </h3>
            <span className="text-xs text-muted-foreground">Select your preferred fare conditions</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Current chosen fare */}
            <div className="flex flex-col justify-between rounded-lg border-2 border-primary bg-card p-4 shadow-sm">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-primary">Selected Fare</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Active</span>
                </div>
                <div className="mt-1 text-base font-bold text-foreground">
                  {selectedOffer.cabinMarketingName || selectedOffer.fareBrandName || selectedOffer.cabinClass || 'Economy'}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-1.5">
                    <Luggage className="h-3.5 w-3.5 text-primary" />
                    {selectedOffer.baggageAllowance?.checkedBags ? `${selectedOffer.baggageAllowance.checkedBags} checked bag` : 'Cabin bag only'}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    {selectedOffer.refundable === true ? 'Refundable' : selectedOffer.refundable === false ? 'Non-refundable' : 'Refund policy unknown'}
                  </li>
                </ul>
              </div>
              <div className="mt-4 pt-3 border-t border-border">
                <span className="font-mono text-base font-bold text-foreground">
                  {fmtMoney(selectedOffer.fareTotal, selectedOffer.currency)}
                </span>
              </div>
            </div>

            {/* Upsell alternatives */}
            {checkoutData.upsellOffers.map((upsell) => {
              const pax = upsell.slices?.[0]?.segments?.[0]?.passengers?.[0];
              const brand = pax?.cabin_class_marketing_name || upsell.slices?.[0]?.fare_brand_name || 'Alternative Fare';
              const checkedBags = pax?.baggages?.find((b: any) => b.type === 'checked')?.quantity ?? 0;
              const isRefundable = upsell.conditions?.refund_before_departure?.allowed;
              const isChangeable = upsell.conditions?.change_before_departure?.allowed;

              return (
                <div key={upsell.id} className="flex flex-col justify-between rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
                  <div>
                    <span className="text-xs font-semibold uppercase text-muted-foreground">{upsell.owner?.name}</span>
                    <div className="mt-1 text-base font-bold text-foreground">{brand}</div>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <li className="flex items-center gap-1.5">
                        <Luggage className="h-3.5 w-3.5 text-muted-foreground" />
                        {checkedBags > 0 ? `${checkedBags} checked bag${checkedBags > 1 ? 's' : ''}` : 'Cabin bag only'}
                      </li>
                      <li className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {isRefundable === true ? 'Refundable' : isRefundable === false ? 'Non-refundable' : 'Refund policy unknown'}
                      </li>
                      {isChangeable && (
                        <li className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                          Changeable
                        </li>
                      )}
                    </ul>
                  </div>
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-border">
                    <span className="font-mono text-base font-bold text-foreground">
                      {fmtMoney(Number(upsell.total_amount), upsell.total_currency)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => onSelectUpsell(upsell.id)}>
                      Select
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Users className="h-5 w-5 text-muted-foreground" /> Traveler Details
      </h2>

      {(['adult', 'child', 'infant'] as TravelerType[]).map((type) => {
        const indexes = travelers.map((t, i) => (t.type === type ? i : -1)).filter((i) => i >= 0);
        if (indexes.length === 0) return null;
        return (
          <div key={type} className="mb-5">
            <div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
              {TRAVELER_TYPE_LABEL[type]} ({indexes.length})
            </div>
            {indexes.map((idx) => {
              const t = travelers[idx];
              return (
                <div key={idx} className="mb-3 rounded-lg border border-border p-4 transition-colors hover:border-primary/30">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    Traveler {idx + 1}
                    <span className="text-xs font-normal capitalize text-muted-foreground">({t.type})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
                      <Select value={t.title} onValueChange={(value) => value && updateTraveler(idx, 'title', value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['Mr', 'Mrs', 'Ms', 'Miss'].map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">First name *</label>
                      <Input
                        placeholder="First name *"
                        value={t.firstName}
                        onChange={(e) => updateTraveler(idx, 'firstName', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last name *</label>
                      <Input
                        placeholder="Last name *"
                        value={t.lastName}
                        onChange={(e) => updateTraveler(idx, 'lastName', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date of birth *</label>
                      <Input
                        type="date"
                        value={t.dob}
                        onChange={(e) => updateTraveler(idx, 'dob', e.target.value)}
                        title="Date of birth"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passenger email *</label>
                      <Input
                        type="email"
                        placeholder="Passenger email *"
                        value={t.email}
                        onChange={(e) => updateTraveler(idx, 'email', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passenger phone *</label>
                      <Input
                        type="tel"
                        inputMode="tel"
                        placeholder="+442079460018"
                        value={t.phone}
                        onChange={(e) => updateTraveler(idx, 'phone', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Gender *</label>
                      <Select value={t.gender || null} onValueChange={(value) => value && updateTraveler(idx, 'gender', value)}>
                        <SelectTrigger>
                          <SelectValue>{(value: string) => GENDER_LABEL[value] || 'Gender *'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passport number</label>
                      <Input
                        placeholder="Passport number"
                        value={t.passportNumber}
                        onChange={(e) => updateTraveler(idx, 'passportNumber', e.target.value.toUpperCase())}
                        className="font-mono"
                        maxLength={12}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passport expiry</label>
                      <Input
                        type="date"
                        value={t.passportExpiry}
                        onChange={(e) => updateTraveler(idx, 'passportExpiry', e.target.value)}
                        title="Passport expiry date"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nationality</label>
                      <Input
                        placeholder="Nationality (e.g. LK)"
                        value={t.nationality}
                        onChange={(e) => updateTraveler(idx, 'nationality', e.target.value.toUpperCase())}
                        maxLength={2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Frequent flyer #</label>
                      <Input
                        placeholder="Frequent flyer #"
                        value={t.frequentFlyerNumber}
                        onChange={(e) => updateTraveler(idx, 'frequentFlyerNumber', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Meal preference</label>
                      <Select value={t.mealPreference || 'None'} onValueChange={(value) => value && updateTraveler(idx, 'mealPreference', value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Meal preference" />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            'None',
                            'Standard',
                            'Vegetarian (VGML)',
                            'Vegan (VGML)',
                            'Halal (MOML)',
                            'Kosher (KSML)',
                            'Gluten-Free (GFML)',
                            'Diabetic (DBML)',
                            'Child Meal (CHML)',
                          ].map((x) => (
                            <SelectItem key={x} value={x}>
                              {x === 'None' ? 'No special meal' : x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Special assistance</label>
                      <Select value={t.specialAssistance || 'None'} onValueChange={(value) => value && updateTraveler(idx, 'specialAssistance', value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Special assistance" />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            'None',
                            'Wheelchair - Ramp (WCHR)',
                            'Wheelchair - Steps (WCHS)',
                            'Wheelchair - Cabin (WCHC)',
                            'Meet & Assist',
                            'Visual Assistance',
                            'Hearing Assistance',
                          ].map((x) => (
                            <SelectItem key={x} value={x}>
                              {x === 'None' ? 'No assistance required' : x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="mb-6 rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Info className="h-4 w-4 text-muted-foreground" /> Contact Details
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input placeholder="Full name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <Input placeholder="Email *" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <Input placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
        </div>
      </div>

      <Button onClick={onNext} disabled={Boolean(priceChange && !priceChangeAccepted)}>
        Review Booking <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function DuffelOfferDetails({ offer }: { offer: DuffelCheckoutData['offer'] }) {
  return (
    <section className="mb-6 border-b border-border pb-5" aria-label="Full flight details">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Flight details</h3>
        <span className="text-xs text-muted-foreground">
          Fare expires {new Date(offer.expires_at).toLocaleString()}
        </span>
      </div>
      <div className="space-y-4">
        {offer.slices.map((slice, sliceIndex) => (
          <div key={slice.id || sliceIndex} className="space-y-3">
            {slice.segments.map((segment) => (
              <div key={segment.id} className="grid gap-2 border-l-2 border-primary/30 pl-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <div className="font-mono text-sm font-semibold">{new Date(segment.departing_at).toLocaleString()}</div>
                  <div className="text-sm">{segment.origin.name} ({segment.origin.iata_code})</div>
                  {segment.origin_terminal && <div className="text-xs text-muted-foreground">Terminal {segment.origin_terminal}</div>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {segment.duration} · {segment.marketing_carrier.iata_code}{segment.marketing_carrier_flight_number}
                </div>
                <div className="sm:text-right">
                  <div className="font-mono text-sm font-semibold">{new Date(segment.arriving_at).toLocaleString()}</div>
                  <div className="text-sm">{segment.destination.name} ({segment.destination.iata_code})</div>
                  {segment.destination_terminal && <div className="text-xs text-muted-foreground">Terminal {segment.destination_terminal}</div>}
                </div>
                <div className="text-xs text-muted-foreground sm:col-span-3">
                  Operated by {segment.operating_carrier.name}
                  {segment.operating_carrier.iata_code !== segment.marketing_carrier.iata_code
                    ? ` · marketed by ${segment.marketing_carrier.name}`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
        <div className="text-muted-foreground">Base fare</div>
        <div className="text-right font-mono">{fmtMoney(Number(offer.base_amount), offer.base_currency)}</div>
        <div className="text-muted-foreground">Taxes</div>
        <div className="text-right font-mono">{fmtMoney(Number(offer.tax_amount || 0), offer.tax_currency || offer.total_currency)}</div>
        <div className="font-semibold">Current total</div>
        <div className="text-right font-mono font-semibold">{fmtMoney(Number(offer.total_amount), offer.total_currency)}</div>
      </div>
      {offer.conditions?.refund_before_departure && (
        <p className="mt-3 text-xs text-muted-foreground">
          Refund before departure: {offer.conditions.refund_before_departure.allowed ? 'allowed' : 'not allowed'}
        </p>
      )}
    </section>
  );
}

interface DuffelAncillariesStepProps {
  checkoutData: DuffelCheckoutData;
  passengers: DuffelPassenger[];
  onServicesChange: (services: SelectedDuffelService[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function DuffelAncillariesStep({ checkoutData, passengers, onServicesChange, onBack, onNext }: DuffelAncillariesStepProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to traveler details
      </button>
      <DuffelOfferDetails offer={checkoutData.offer} />
      <h2 className="mb-4 text-lg font-semibold text-foreground">Bags and seats</h2>
      <DuffelAncillaries
        offer={checkoutData.offer}
        seat_maps={checkoutData.seatMaps}
        passengers={passengers}
        services={['bags', 'seats']}
        styles={{ accentColor: '30, 112, 90', buttonCornerRadius: '6px' }}
        onPayloadReady={(payload) => onServicesChange(payload.services || [])}
      />
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext}>Review and pay <ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

interface ReviewStepProps {
  selectedOffer: FlightOffer;
  checkoutData: DuffelCheckoutData;
  selectedServices: SelectedDuffelService[];
  cardCheckoutEnabled: boolean;
  travelers: TravelerForm[];
  contact: ContactForm;
  booking: boolean;
  onPriceWithCard: (cardId: string, services: SelectedDuffelService[], expectedTotal: number) => Promise<{ totalAmount: number; currency: string; priceChanged: boolean }>;
  onBack: () => void;
  onConfirm: (payment?: { cardId: string; threeDSecureSessionId: string }, expectedTotal?: number, expectedCurrency?: string) => Promise<void>;
}

export function ReviewStep({ selectedOffer, checkoutData, selectedServices, cardCheckoutEnabled, travelers, contact, booking, onPriceWithCard, onBack, onConfirm }: ReviewStepProps) {
  const { ref, createCardForTemporaryUse } = useDuffelCardFormActions();
  const [cardValid, setCardValid] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pricedCard, setPricedCard] = useState<{ cardId: string; totalAmount: number; currency: string } | null>(null);
  const [cardPriceAccepted, setCardPriceAccepted] = useState(false);
  const servicePrices = new Map<string, { total_amount: string; total_currency: string; type?: string }>();
  for (const service of checkoutData.offer.available_services || []) {
    servicePrices.set(service.id, service);
  }
  for (const seatMap of checkoutData.seatMaps) {
    for (const cabin of seatMap.cabins || []) {
      for (const row of cabin.rows || []) {
        for (const section of row.sections || []) {
          for (const element of section.elements || []) {
            if ('available_services' in element) {
              for (const service of element.available_services || []) servicePrices.set(service.id, service);
            }
          }
        }
      }
    }
  }
  const selectedServicePrices = selectedServices.map((selection) => ({
    ...selection,
    service: servicePrices.get(selection.id),
  }));
  const selectedServicesTotal = selectedServicePrices.reduce(
    (total, selection) => total + (Number(selection.service?.total_amount) || 0) * selection.quantity,
    0,
  );
  const reviewedTotal = selectedOffer.fareTotal + selectedServicesTotal;

  const finishCardPayment = async (cardId: string, totalAmount: number, currency: string) => {
    const session = await createThreeDSecureSession(
      checkoutData.clientKey,
      cardId,
      checkoutData.offer.id,
      selectedServices,
      false,
    );
    if (session.status !== 'ready_for_payment') {
      throw new Error('Your bank could not authenticate this payment. Try again or use another card.');
    }
    await onConfirm({ cardId, threeDSecureSessionId: session.id }, totalAmount, currency);
  };

  const handleCardCreated = async ({ id: cardId }: { id: string }) => {
    try {
      const quote = await onPriceWithCard(cardId, selectedServices, reviewedTotal);
      const priceDiffers = quote.priceChanged || quote.currency !== (selectedOffer.currency || 'USD');
      if (priceDiffers) {
        setPricedCard({ cardId, totalAmount: quote.totalAmount, currency: quote.currency });
        setCardPriceAccepted(false);
        setCardBusy(false);
        return;
      }
      await finishCardPayment(cardId, quote.totalAmount, quote.currency);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment authentication failed. Try again.');
    } finally {
      setCardBusy(false);
    }
  };

  const handlePaymentAction = () => {
    if (!cardCheckoutEnabled) {
      void onConfirm(undefined, reviewedTotal, selectedOffer.currency || 'USD');
      return;
    }
    if (pricedCard && cardPriceAccepted) {
      setCardBusy(true);
      setPaymentError('');
      void finishCardPayment(pricedCard.cardId, pricedCard.totalAmount, pricedCard.currency)
        .catch((error) => setPaymentError(error instanceof Error ? error.message : 'Payment authentication failed. Try again.'))
        .finally(() => setCardBusy(false));
      return;
    }
    setCardBusy(true);
    setPaymentError('');
    createCardForTemporaryUse();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to traveler details
      </button>
      <h2 className="mb-4 text-lg font-semibold text-foreground">Review &amp; Confirm</h2>

      <div className="mb-4 rounded-lg bg-muted/50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {selectedOffer.airlineCode}
          </div>
          <span className="text-sm font-semibold text-foreground">{selectedOffer.airline} · {selectedOffer.cabinClass}</span>
          {selectedOffer.refundable && (
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Refundable</span>
          )}
        </div>
        {(selectedOffer.segments || []).map((seg, i) => (
          <div key={i} className="ml-9 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{seg.origin}</span>
            <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
            <span className="font-semibold text-foreground">{seg.destination}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums">{fmtDate(seg.departureAt)} → {fmtDate(seg.arrivalAt)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-xs">{seg.marketingCarrier}{seg.flightNumber?.replace(seg.marketingCarrier ?? '', '')}</span>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Travelers</div>
        {travelers.map((t, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 py-1 text-sm text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{i + 1}</span>
            <span className="font-medium">{t.title} {t.firstName} {t.lastName}</span>
            <span className="text-xs capitalize text-muted-foreground">({t.type})</span>
            {t.mealPreference && t.mealPreference !== 'None' && (
              <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Meal: {t.mealPreference}
              </span>
            )}
            {t.specialAssistance && t.specialAssistance !== 'None' && (
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {t.specialAssistance}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Contact</div>
        <div className="text-sm text-foreground">{contact.name} · {contact.email}{contact.phone ? ` · ${contact.phone}` : ''}</div>
      </div>

      {selectedServicePrices.some((selection) => selection.service) && (
        <div className="mb-4 border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Selected bags and seats</div>
          {selectedServicePrices.map(({ id, quantity, service }) => service && (
            <div key={id} className="mb-1 flex justify-between gap-3 text-sm text-muted-foreground">
              <span>{service.type === 'baggage' ? 'Additional baggage' : 'Seat'}{quantity > 1 ? ` × ${quantity}` : ''}</span>
              <span className="font-mono tabular-nums">{fmtMoney(Number(service.total_amount) * quantity, service.total_currency)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 border-t border-border pt-4">
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Base fare</span>
          <span className="font-mono tabular-nums">{fmtMoney(selectedOffer.baseFare, selectedOffer.currency)}</span>
        </div>
        <div className="mb-1 flex justify-between text-sm text-muted-foreground">
          <span>Taxes &amp; fees</span>
          <span className="font-mono tabular-nums">{fmtMoney(selectedOffer.taxes, selectedOffer.currency)}</span>
        </div>
        {selectedOffer.refundable === false && (
          <div className="mt-2 flex items-center gap-1 text-xs text-warning">
            <AlertCircle className="h-3 w-3" /> This fare is non-refundable
          </div>
        )}
        {selectedOffer.refundable == null && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="h-3 w-3" /> Refund conditions were not provided by the airline
          </div>
        )}
        <div className="mt-3 flex justify-between border-t border-border pt-3 text-lg font-bold text-foreground">
          <span>Total</span>
          <span className="font-mono tabular-nums">{fmtMoney(reviewedTotal, selectedOffer.currency)}</span>
        </div>
      </div>

      {cardCheckoutEnabled ? (
        <section className="mb-6 border-t border-border pt-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><CreditCard className="h-4 w-4" /> Card payment</h3>
          <p className="mb-4 text-xs text-muted-foreground">Enter card details provided by the traveler for this agent-assisted booking. Card data goes directly to Duffel; the traveler may need to complete a bank challenge.</p>
          {pricedCard && (
            <label className="mb-4 flex cursor-pointer items-start gap-3 border border-warning/40 bg-warning/5 p-4 text-sm">
              <input type="checkbox" checked={cardPriceAccepted} onChange={(event) => setCardPriceAccepted(event.target.checked)} className="mt-1" />
              <span>
                Duffel&apos;s card price is {fmtMoney(pricedCard.totalAmount, pricedCard.currency)}. I accept this final amount.
              </span>
            </label>
          )}
          <DuffelCardForm
            ref={ref}
            clientKey={checkoutData.clientKey}
            intent="to-create-card-for-temporary-use"
            onValidateSuccess={() => setCardValid(true)}
            onValidateFailure={() => setCardValid(false)}
            onCreateCardForTemporaryUseSuccess={handleCardCreated}
            onCreateCardForTemporaryUseFailure={(error) => {
              const featureUnavailable = /feature is unavailable/i.test(error.message || '');
              setPaymentError(featureUnavailable
                ? 'Duffel has not enabled customer-card checkout for this account. Contact help@duffel.com or choose Duffel balance.'
                : error.message || 'Duffel could not tokenize this card.');
              setCardBusy(false);
            }}
          />
          {paymentError && <p role="alert" className="mt-3 text-sm text-destructive">{paymentError}</p>}
        </section>
      ) : (
        <p className="mb-5 border-t border-border pt-4 text-sm text-muted-foreground">
          Duffel must enable customer-card checkout for this account before you can take card payments. Contact help@duffel.com. This booking will use the Duffel account balance.
        </p>
      )}
      <label className="mb-5 flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
        <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1" />
        <span>
          I reviewed the fare conditions and have given the traveler the applicable{' '}
          <a href="https://help.duffel.com/hc/en-gb/articles/360021056640" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            booking notices
          </a>.
        </span>
      </label>
      <Button
        variant="default"
        className="bg-success text-success-foreground hover:bg-success/80"
        disabled={booking || cardBusy || !termsAccepted || (cardCheckoutEnabled && !cardValid)}
        onClick={handlePaymentAction}
      >
        {booking || cardBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {booking || cardBusy
          ? 'Authenticating and booking...'
          : !cardCheckoutEnabled
            ? 'Book using Duffel balance'
            : pricedCard
              ? cardPriceAccepted ? 'Authenticate and book' : 'Accept final card price'
              : 'Price card and continue'}
      </Button>
    </div>
  );
}

interface ConfirmationStepProps {
  pnr?: string;
  status?: string;
  selectedOffer: FlightOffer | null;
  travelerCount: number;
  onCopyPNR: () => void;
  onNewSearch: () => void;
  onViewBookings: () => void;
}

export function ConfirmationStep({ pnr, status, selectedOffer, travelerCount, onCopyPNR, onNewSearch, onViewBookings }: ConfirmationStepProps) {
  const isPending = status === 'pending';
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center shadow-card">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="h-9 w-9 text-success" />
      </div>
      <h2 className="mb-1 text-xl font-bold text-foreground">{isPending ? 'Booking request received' : 'Booking Confirmed'}</h2>
      <p className="mb-6 text-muted-foreground">
        {isPending ? 'Duffel is still confirming this booking. Do not submit the booking again.' : 'Your flight has been booked successfully'}
      </p>

      {pnr && (
        <div className="mb-6 inline-flex items-center gap-3 rounded-lg bg-muted/50 px-6 py-4">
          <div>
            <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">PNR / Record Locator</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-primary">{pnr}</div>
          </div>
          <button type="button" onClick={onCopyPNR} className="rounded-lg p-2 text-primary transition-colors hover:bg-primary/10" title="Copy PNR">
            <Copy className="h-4 w-4" />
          </button>
        </div>
      )}

      {selectedOffer && (
        <div className="mx-auto mb-6 max-w-md rounded-lg bg-muted/50 p-4 text-left">
          <div className="space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between"><span>Airline</span><span className="font-medium text-foreground">{selectedOffer.airline}</span></div>
            <div className="flex justify-between"><span>Route</span><span className="font-medium text-foreground">{routeChain(selectedOffer.segments)}</span></div>
            <div className="flex justify-between"><span>Travelers</span><span className="font-mono font-medium tabular-nums text-foreground">{travelerCount}</span></div>
            <div className="flex justify-between"><span>Total</span><span className="font-mono font-medium tabular-nums text-foreground">{fmtMoney(selectedOffer.fareTotal, selectedOffer.currency)}</span></div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <Button onClick={onNewSearch}>New Search</Button>
        <Button variant="outline" onClick={onViewBookings}>
          View Bookings
        </Button>
      </div>
    </div>
  );
}
