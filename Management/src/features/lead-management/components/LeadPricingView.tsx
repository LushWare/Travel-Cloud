/**
 * Read-only pricing receipt for a lead's packages, priced for the lead's own
 * party. Each line says how the party is charged for it — meals per
 * traveller, a car shared by the party, rooms counted for the party — and a
 * "price by group size" table shows what the trip would cost for other party
 * sizes, with rooms and vehicles recounted for each.
 *
 * The receipt's lines come from the same engine the server prices with
 * (`computeQuote`), fed the selection's cost lines and margin settings — the
 * stored per-line totals are not kept up to date, so they are never read.
 * Discount, tax, service charge, deposit/advance and payments come from the
 * selection's server-computed pricing.
 */

import { useState } from 'react';
import { BedDouble, Calculator, Car, Package, User, Users, Wallet } from 'lucide-react';
import { computeQuote } from '@travel-crm/lead-pricing-engine';
import { TRANSPORT_MODE_LABELS, vehiclesNeeded } from '@travel-crm/constants';
import { cn } from '@/lib/utils';
import { usePricingDefaults, type PricingDefaults } from '@/features/itinerary/hooks/usePricingDefaults';

interface LeadPricingViewProps {
  /** Package selections as returned by GET /leads/:id/packages. */
  selections: any[];
  /** The lead's party size — what every package is priced for. */
  travelers: number;
  /** The lead's primary selection, shown first. */
  primarySelectionId?: string | null;
}

const CATEGORY_ORDER = ['package', 'food', 'activity', 'transportation', 'accommodation', 'guide', 'insurance', 'visa', 'other'];
const CATEGORY_TITLES: Record<string, string> = {
  package: 'Package',
  food: 'Meals · each traveller has their own',
  activity: 'Activities · each traveller has their own',
  transportation: 'Transport · a vehicle is shared by the party, a ticket is per traveller',
  accommodation: 'Accommodation · rooms are shared by the party',
  guide: 'Guide',
  insurance: 'Insurance',
  visa: 'Visa',
  other: 'Other',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const modeLabel = (mode: string) => (TRANSPORT_MODE_LABELS as Record<string, string>)[mode] || mode || 'Vehicle';

function selectionLabel(selection: any): string {
  return selection?.isManual ? 'Manual Itinerary' : (selection?.packageName || 'Package');
}

function toDescriptor(row: any) {
  return {
    category: row.category,
    description: row.description,
    basis: row.basis,
    quantity: row.quantity,
    estimatedUnit: Number(row.estimatedUnitPrice ?? row.estimatedUnit) || 0,
    actualUnit: row.actualUnitPrice != null ? Number(row.actualUnitPrice) : null,
    marginType: row.marginType || null,
    marginValue: row.marginValue != null ? Number(row.marginValue) : null,
    source: row.source,
  };
}

/** The itinerary transport an AUTO "Transport N" line was built from (numbered across days). */
function transportOf(line: any, days: any[]): any | null {
  const match = String(line.description || '').match(/^Transport (\d+)/);
  if (line.category !== 'transportation' || !match) return null;
  const flat = (days || []).flatMap((d: any) =>
    (d?.transports || []).map((t: any) => ({ ...t, dayNumber: d.dayNumber })),
  );
  return flat[Number(match[1]) - 1] || null;
}

/** Vehicles a "Transport N (3 vehicles)" line was priced with. */
function vehiclesIn(line: any): number {
  if (line.basis === 'PER_VEHICLE') return Math.max(1, Number(line.quantity) || 1);
  const match = String(line.description || '').match(/\((\d+) vehicles\)/);
  return match ? Number(match[1]) : 1;
}

/**
 * The engine names lines "Transport 2" / "Accommodation day 3"; name them from
 * the itinerary instead.
 */
export function lineName(line: any, days: any[]): string {
  const transport = transportOf(line, days);
  if (transport) return `${modeLabel(transport.transportMode)} · Day ${transport.dayNumber}`;
  const stay = String(line.description || '').match(/^Accommodation day (\d+)/);
  if (line.category === 'accommodation' && stay) {
    const day = (days || [])[Number(stay[1]) - 1];
    return `${day?.accommodation?.name || 'Hotel'} · Day ${day?.dayNumber ?? stay[1]}`;
  }
  return String(line.description || '') || 'Item';
}

interface ChargeContext {
  travelers: number;
  days: any[];
  defaults: Pick<PricingDefaults, 'transportRates' | 'peoplePerRoom'>;
  money: (n: number) => string;
}

/** How the party is charged for a line, e.g. "1 car for 2 travellers (3 seats) × USD 65.00". */
export function chargeText(line: any, { travelers, days, defaults, money }: ChargeContext): string {
  const unit = money(Number(line.estimatedUnitPrice) || 0);
  const qty = Number(line.quantity) || 0;
  const party = plural(travelers, 'traveller');
  const transport = transportOf(line, days);
  const mode = transport ? modeLabel(transport.transportMode).toLowerCase() : 'vehicle';
  const seats = transport ? Number(defaults.transportRates?.[transport.transportMode]?.seats) : 0;
  const seatNote = seats > 0 ? ` (${seats} seats each)` : '';
  switch (line.basis) {
    case 'PER_PERSON':
      return `${unit} each × ${party}`;
    case 'PER_VEHICLE':
      return `${qty} ${mode}${qty === 1 ? '' : 's'} for ${party}${seatNote} × ${unit}`;
    case 'PER_KM': {
      const vehicles = vehiclesIn(line);
      const perVehicle = money((Number(line.estimatedUnitPrice) || 0) / vehicles);
      return `${qty} km × ${perVehicle} per km × ${vehicles} ${mode}${vehicles === 1 ? '' : 's'} for ${party}${seatNote}`;
    }
    case 'PER_ROOM': {
      const perRoom = line.source === 'AUTO' ? ` (${defaults.peoplePerRoom} per room)` : '';
      return `${plural(qty, 'room')} for ${party}${perRoom} × ${unit} a night`;
    }
    default:
      return qty > 1 ? `${unit} × ${qty}` : `${unit} for the whole party`;
  }
}

/**
 * The cost lines re-counted for a party of `size`: per-traveller lines scale on
 * their own; rooms and vehicles on AUTO lines are recounted with Settings'
 * people-per-room and seats. Manual lines keep their own quantities.
 */
export function linesForParty(lines: any[], size: number, days: any[], defaults: Pick<PricingDefaults, 'transportRates' | 'peoplePerRoom'>) {
  const seats = Object.fromEntries(
    Object.entries(defaults.transportRates || {}).map(([mode, rates]) => [mode, Number(rates?.seats) || 0]),
  );
  const perRoom = Math.max(1, Number(defaults.peoplePerRoom) || 2);
  return lines.map((line) => {
    if (line.source !== 'AUTO') return line;
    if (line.basis === 'PER_ROOM') return { ...line, quantity: Math.ceil(size / perRoom) };
    const transport = transportOf(line, days);
    if (!transport) return line;
    const vehicles = vehiclesNeeded(transport.transportMode, size, seats);
    if (line.basis === 'PER_VEHICLE') return { ...line, quantity: vehicles, vehicles };
    if (line.basis === 'PER_KM') return { ...line, estimatedUnit: (line.estimatedUnit / vehiclesIn(line)) * vehicles, vehicles };
    return line;
  });
}

function Row({ label, hint, amount, muted = false, strong = false }: {
  label: string;
  hint?: string;
  amount: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1 text-sm', strong && 'font-bold')}>
      <div className="min-w-0">
        <span className={cn(strong ? 'text-foreground' : muted ? 'text-muted-foreground/80' : 'text-foreground')}>{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </div>
      <span className={cn('shrink-0 text-right font-mono tabular-nums', muted ? 'text-muted-foreground/80' : 'text-foreground')}>{amount}</span>
    </div>
  );
}

function Tile({ icon: Icon, label, hint, value, highlight = false }: {
  icon: typeof User;
  label: string;
  hint: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border px-4 py-3', highlight ? 'border-success/40 bg-success/5' : 'border-border bg-card')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className={cn('mt-1 text-lg font-bold font-mono tabular-nums', highlight ? 'text-success' : 'text-foreground')}>{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function SelectionReceipt({ selection, travelers, defaults }: { selection: any; travelers: number; defaults: PricingDefaults }) {
  const pricing = selection.pricing || {};
  const currency = pricing.currency || 'USD';
  const money = (n: number) => `${currency} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const costLines: any[] = Array.isArray(selection.costLines) ? selection.costLines : [];

  if (selection.derivationError) {
    return <p className="text-sm text-destructive">This package's prices couldn't be loaded. Try again in a moment.</p>;
  }
  if (costLines.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border py-6 text-center text-muted-foreground">
        <Calculator className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">No prices on this package yet</p>
      </div>
    );
  }

  const marginType = pricing.marginType || null;
  const marginValue = Number(pricing.marginValue) || 0;
  const days: any[] = Array.isArray(selection.itineraryDays) ? selection.itineraryDays : [];
  const descriptors = costLines.map(toDescriptor);
  // The rates the server applied, so other party sizes are priced the same way.
  const taxableSubtotal = Number(pricing.taxableSubtotal) || 0;
  // The package's own rate when set, else the rate the server priced it at.
  const taxRate = pricing.taxRate != null && pricing.taxRate !== ''
    ? Number(pricing.taxRate) || 0
    : (taxableSubtotal > 0 ? ((Number(pricing.taxAmount) || 0) / taxableSubtotal) * 100 : 0);
  const quoteFor = (lines: any[], size: number) => computeQuote({
    lines,
    travelers: size,
    currency,
    marginType,
    marginValue,
    taxRate,
    discountType: pricing.discountType || 'none',
    discountValue: Number(pricing.discountValue) || 0,
    serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
  });

  const quote = quoteFor(descriptors, travelers);
  const groups = CATEGORY_ORDER
    .map((category) => ({ category, lines: quote.lines.filter((l: any) => (CATEGORY_ORDER.includes(l.category) ? l.category : 'other') === category) }))
    .filter((g) => g.lines.length > 0);

  const cost = quote.estimatedTotal;
  const margin = Math.round((quote.sellSubtotal - cost) * 100) / 100;
  const discount = Number(pricing.discountAmount) || 0;
  const tax = Number(pricing.taxAmount) || 0;
  const service = Number(pricing.serviceChargeAmount) || 0;
  const total = Number(pricing.totalAmount) || quote.totalAmount;
  const perTraveller = Math.round((total / travelers) * 100) / 100;
  const deposit = Number(pricing.depositAmount) || 0;
  const paid = Number(pricing.paidAmount) || 0;
  const balance = pricing.balanceDue != null ? Number(pricing.balanceDue) : Math.max(0, total - paid);
  const marginLabel = !marginType
    ? 'Margin'
    : marginType === 'FIXED'
      ? `Margin (fixed ${money(marginValue)} per traveller)`
      : `Margin (${marginValue}% of cost)`;

  // What the party gets: rooms a night and vehicles per transfer, as priced.
  const roomLines = quote.lines.filter((l: any) => l.basis === 'PER_ROOM');
  const rooms = roomLines.length ? Math.max(...roomLines.map((l: any) => Number(l.quantity) || 0)) : 0;
  const vehicleByMode = new Map<string, number>();
  quote.lines.forEach((l: any) => {
    const t = transportOf(l, days);
    if (!t || (l.basis !== 'PER_VEHICLE' && l.basis !== 'PER_KM')) return;
    vehicleByMode.set(t.transportMode, Math.max(vehicleByMode.get(t.transportMode) || 0, vehiclesIn(l)));
  });

  // Same trip for other party sizes — rooms and vehicles recounted for each.
  const sizes = [...new Set([1, 2, 3, 4, 5, 6, travelers])].sort((a, b) => a - b);
  const mostVehicles = vehicleByMode.size ? Math.max(...vehicleByMode.values()) : 0;
  const bySize = sizes.map((size) => {
    // This lead's own row is exactly what the receipt above shows.
    if (size === travelers) return { size, rooms, vehicles: mostVehicles, total, each: perTraveller };
    const lines = linesForParty(descriptors, size, days, defaults);
    const q = quoteFor(lines, size);
    const sizedRooms = lines.reduce((m: number, l: any) => (l.basis === 'PER_ROOM' ? Math.max(m, Number(l.quantity) || 0) : m), 0);
    const sizedVehicles = lines.reduce((m: number, l: any) => (l.vehicles ? Math.max(m, l.vehicles) : m), 0);
    return { size, rooms: sizedRooms, vehicles: sizedVehicles, total: q.totalAmount, each: Math.round((q.totalAmount / size) * 100) / 100 };
  });

  const status = selection.currentQuoteId
    ? { text: 'Quote sent — these are the quoted prices', cls: 'bg-success/10 text-success' }
    : selection.isMaterialized
      ? { text: 'Customised for this lead', cls: 'bg-primary/10 text-primary' }
      : { text: 'Current package prices', cls: 'bg-muted text-muted-foreground' };

  return (
    <div className="space-y-4">
      <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', status.cls)}>{status.text}</span>

      {/* Who the trip is priced for */}
      <div aria-label="Party" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" /> Priced for {plural(travelers, 'traveller')}
        </span>
        {rooms > 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <BedDouble className="h-4 w-4" /> {plural(rooms, 'room')} a night ({defaults.peoplePerRoom} per room)
          </span>
        )}
        {[...vehicleByMode].map(([mode, count]) => {
          const seats = Number(defaults.transportRates?.[mode]?.seats) || 0;
          return (
            <span key={mode} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Car className="h-4 w-4" /> {modeLabel(mode)}: {count} vehicle{count === 1 ? '' : 's'}{seats > 0 ? ` (${seats} seats)` : ''}
            </span>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center gap-2.5 bg-foreground px-5 py-4">
          <Calculator className="h-5 w-5 text-success" />
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-background">
              Price Breakdown · {plural(travelers, 'Traveller')}
            </p>
            <p className="text-xs text-background/60">{selectionLabel(selection)} · every amount is for the whole party</p>
          </div>
        </div>

        <div className="px-5 py-4">
          {groups.map(({ category, lines }) => {
            const subtotal = lines.reduce((sum: number, l: any) => sum + (Number(l.estimatedTotal) || 0), 0);
            return (
              <div key={category}>
                <p className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-[0.14em] text-success first:mt-0">
                  {CATEGORY_TITLES[category] || category}
                </p>
                {lines.map((line: any, i: number) => (
                  <Row
                    key={`${category}-${i}`}
                    label={lineName(line, days)}
                    hint={chargeText(line, { travelers, days, defaults, money })}
                    amount={money(line.estimatedTotal)}
                  />
                ))}
                {lines.length > 1 && <Row label="Subtotal" amount={money(subtotal)} muted />}
              </div>
            );
          })}

          <div className="my-3 border-t-2 border-dashed border-border" />
          <Row label="COST" amount={money(cost)} strong />
          <Row label={marginLabel} amount={money(margin)} muted />
          <Row label="Selling price" amount={money(quote.sellSubtotal)} />
          {discount > 0 && <Row label="Discount" amount={`− ${money(discount)}`} muted />}
          {tax > 0 && <Row label={`Tax (${Math.round(taxRate * 100) / 100}%)`} amount={money(tax)} muted />}
          {service > 0 && <Row label="Service charge" amount={money(service)} muted />}

          <div className="my-3 border-t-2 border-dashed border-border" />
          <div className="flex items-baseline justify-between gap-4 py-1">
            <span className="text-sm font-bold text-foreground">CUSTOMER PAYS · {plural(travelers, 'traveller')}</span>
            <span className="font-mono text-2xl font-extrabold tabular-nums text-success">{money(total)}</span>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {money(total)} ÷ {plural(travelers, 'traveller')} = {money(perTraveller)} each
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Customer prices">
        <Tile icon={Users} label={`Total for ${plural(travelers, 'traveller')}`} hint="what the customer pays" value={money(total)} highlight />
        <Tile icon={User} label="Each traveller" hint={`total split ${travelers} way${travelers === 1 ? '' : 's'}`} value={money(perTraveller)} />
        {paid > 0 ? (
          <Tile icon={Wallet} label="Balance due" hint={`${money(paid)} paid`} value={money(balance)} />
        ) : (
          <Tile icon={Wallet} label="Deposit/Advance" hint={deposit > 0 ? 'due to confirm the booking' : 'no deposit/advance set'} value={money(deposit)} />
        )}
      </div>

      {/* Same trip, other party sizes */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Price by group size</p>
          <p className="text-xs text-muted-foreground">
            The same trip for a different number of travellers. Rooms and vehicles are recounted with Settings ({defaults.peoplePerRoom} per room, each vehicle's seats).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Price by group size" className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left font-semibold">Travellers</th>
                <th className="px-4 py-2 text-right font-semibold">Rooms a night</th>
                <th className="px-4 py-2 text-right font-semibold">Vehicles</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
                <th className="px-4 py-2 text-right font-semibold">Each traveller</th>
              </tr>
            </thead>
            <tbody>
              {bySize.map((row) => (
                <tr
                  key={row.size}
                  aria-current={row.size === travelers ? 'true' : undefined}
                  className={cn('border-t border-border', row.size === travelers && 'bg-success/5 font-semibold')}
                >
                  <td className="px-4 py-2 text-left">
                    {row.size}
                    {row.size === travelers && <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">this lead</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.rooms || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.vehicles || '—'}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{money(row.total)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{money(row.each)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function LeadPricingView({ selections, travelers, primarySelectionId }: LeadPricingViewProps) {
  const defaults = usePricingDefaults();
  const party = Math.max(1, Math.floor(Number(travelers) || 1));
  const ordered = [...(selections || [])].sort((a, b) =>
    (a.id === primarySelectionId ? -1 : 0) - (b.id === primarySelectionId ? -1 : 0),
  );
  const [activeId, setActiveId] = useState<string | null>(ordered[0]?.id ?? null);
  const active = ordered.find((s) => s.id === activeId) || ordered[0];

  if (!active) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-card py-6 text-center text-muted-foreground">
        <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">No packages attached yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ordered.length > 1 && (
        <div role="tablist" aria-label="Packages" className="flex flex-wrap gap-2">
          {ordered.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === active.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                s.id === active.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {selectionLabel(s)}
            </button>
          ))}
        </div>
      )}
      <SelectionReceipt key={active.id} selection={active} travelers={party} defaults={defaults} />
    </div>
  );
}
