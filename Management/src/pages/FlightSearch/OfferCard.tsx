import { ChevronRight, Luggage, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtTime, fmtDuration, fmtMoney, stopsLabel } from './helpers';
import { splitLegs, journeyStops, legStops, legDurationMinutes } from '@/features/shared/utils/flightSegments';
import type { FlightOffer } from './types';

export function OfferSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-muted" />
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="ml-auto h-4 w-16 rounded bg-muted" />
      </div>
      <div className="mb-2 flex items-center gap-4">
        <div className="h-5 w-16 rounded bg-muted" />
        <div className="h-0.5 flex-1 bg-muted/60" />
        <div className="h-5 w-16 rounded bg-muted" />
      </div>
      <div className="h-3 w-40 rounded bg-muted/60" />
    </div>
  );
}

interface OfferCardProps {
  offer: FlightOffer;
  onSelect: (offer: FlightOffer) => void;
  paxCount: number;
  /** The searched destination for a round trip: where the outbound leg turns around. */
  turnPoint?: string;
}

export default function OfferCard({ offer, onSelect, paxCount, turnPoint }: OfferCardProps) {
  const segs = offer.segments || [];
  const legs = splitLegs(segs, turnPoint);
  const stops = journeyStops(legs);

  const isNextDay = (dep?: string, arr?: string) => {
    if (!dep || !arr) return false;
    const d1 = new Date(dep).toDateString();
    const d2 = new Date(arr).toDateString();
    return d1 !== d2;
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-card transition-all hover:border-primary/40 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        {/* Airline & Conditions Header */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {offer.airlineLogo ? (
            <img
              src={offer.airlineLogo}
              alt={offer.airline || offer.airlineCode}
              className="h-8 w-8 shrink-0 rounded-full object-contain bg-muted/40 p-1 border border-border/60"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {offer.airlineCode}
            </div>
          )}
          <div className="mr-2">
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              {offer.airline}
              {offer.fareBrandName && (
                <span className="text-[11px] font-normal text-muted-foreground">· {offer.fareBrandName}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground capitalize">
              {offer.cabinMarketingName || offer.cabinClass || 'Economy'}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {offer.baggageAllowance && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2.5 py-0.5 text-xs font-medium text-foreground">
                <Luggage className="h-3 w-3 text-muted-foreground" />
                {offer.baggageAllowance.checkedBags > 0
                  ? `${offer.baggageAllowance.checkedBags} bag${offer.baggageAllowance.checkedBags > 1 ? 's' : ''}`
                  : 'Cabin bag only'}
              </span>
            )}
            {offer.refundable === true ? (
              <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success border border-success/20">
                Refundable
              </span>
            ) : offer.refundable === false ? (
              <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Non-refundable
              </span>
            ) : (
              <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                Refund policy unknown
              </span>
            )}
            {stops === 0 && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary border border-primary/20">
                Direct
              </span>
            )}
          </div>
        </div>

        {/* Flight Legs / Slices Timeline */}
        {legs.map((leg, i) => {
          const first = leg[0];
          const last = leg[leg.length - 1];
          const nextDay = isNextDay(first?.departureAt, last?.arrivalAt);

          return (
            <div key={i} className="mb-2 flex items-center gap-3">
              {legs.length > 1 && (
                <div className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {i === 0 ? 'Outbound' : 'Return'}
                </div>
              )}
              <div className="text-right min-w-[70px]">
                <div className="font-mono text-lg font-bold tabular-nums text-foreground">{fmtTime(first?.departureAt)}</div>
                <div className="text-xs font-medium text-muted-foreground">
                  {first?.origin}
                  {first?.originTerminal && <span className="text-[10px] text-muted-foreground/80"> T{first.originTerminal}</span>}
                </div>
              </div>

              <div className="flex flex-1 flex-col items-center px-2">
                <div className="mb-0.5 text-xs text-muted-foreground">{fmtDuration(legDurationMinutes(leg))}</div>
                <div className="relative h-0.5 w-full bg-border">
                  <div className="absolute -top-0.5 left-0 h-1.5 w-2 rounded-full bg-primary" />
                  <div className="absolute -top-0.5 right-0 h-1.5 w-2 rounded-full bg-primary" />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{stopsLabel(legStops(leg))}</div>
              </div>

              <div className="min-w-[70px]">
                <div className="font-mono text-lg font-bold tabular-nums text-foreground flex items-baseline gap-1">
                  {fmtTime(last?.arrivalAt)}
                  {nextDay && <span className="text-[10px] font-bold text-amber-500">+1</span>}
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  {last?.destination}
                  {last?.destinationTerminal && <span className="text-[10px] text-muted-foreground/80"> T{last.destinationTerminal}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {/* Operating Carrier & Aircraft Info */}
        {segs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {segs.map((segment, index) => (
              <span key={`${segment.sequence ?? index}-operator`}>
                {segment.origin}–{segment.destination}: operated by {segment.operatingCarrierName || offer.airline || 'Carrier'}
                {segment.aircraft ? ` · ${segment.aircraft}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Detailed Segments Collapsible */}
        {segs.length > 1 && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer text-primary hover:text-primary/80 select-none">
              {segs.length} flight segments — view flight numbers &amp; connections
            </summary>
            <div className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
              {segs.map((seg, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">{seg.origin} → {seg.destination}</span>
                  <span className="font-mono text-muted-foreground">({seg.marketingCarrier}{seg.flightNumber?.replace(seg.marketingCarrier ?? '', '')})</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{fmtTime(seg.departureAt)} - {fmtTime(seg.arrivalAt)}</span>
                  <span className="text-muted-foreground">· {fmtDuration(seg.durationMinutes)}</span>
                  {seg.aircraft && <span className="text-muted-foreground/80">· {seg.aircraft}</span>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Right Pricing & Select Column — with min-width and no truncation */}
      <div className="min-w-[155px] shrink-0 text-right whitespace-nowrap lg:border-l lg:border-border lg:pl-6">
        <div className="font-mono text-2xl font-bold tabular-nums text-foreground tracking-tight">
          {fmtMoney(offer.fareTotal, offer.currency)}
        </div>
        <div className="mb-3 text-xs text-muted-foreground">
          {paxCount} traveler{paxCount > 1 ? 's' : ''} · total
        </div>
        <Button onClick={() => onSelect(offer)} className="w-full sm:w-auto font-medium">
          Select <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
