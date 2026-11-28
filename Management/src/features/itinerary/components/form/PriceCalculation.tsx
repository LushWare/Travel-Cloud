/**
 * Price Calculation — live bill/receipt-style pricing breakdown.
 *
 * Prices are PER PERSON, based on two people sharing a room ("twin sharing"),
 * the way the website advertises them. Meals and activities are each person's
 * own; the hotel room and vehicles are shared, so each person pays half.
 *
 * ONE source of numbers: every line, subtotal and total on this panel comes
 * from a single pricing result, so the breakdown always adds up to the total.
 * That result is the server's (package-service prices the exact payload a save
 * sends, with the same catalog activity costs, so it is what gets stored);
 * until it arrives, the same shared function (`packagePriceFromDays`) run on
 * the same payload stands in.
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Calculator,
  TrendingUp,
  Loader,
  User,
  Users,
} from 'lucide-react';
import {
  packagePriceFromDays,
  computeMargin,
  STANDARD_OCCUPANCY,
} from '@travel-crm/pricing-engine';
import ApiService from '../../services/apiService';
import { usePricingDefaults, switchMarginValue, type MarginType } from '../../hooks/usePricingDefaults';
import { marginForPrice } from '../../utils/packagePrice';
import { buildItineraryDaysPayload } from '../../utils/packagePayload';
import { formatCurrency, getCurrencySymbol } from '../../../../utils/currency.js';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TRANSPORT_MODE_LABELS } from '@travel-crm/constants';

interface PriceCalculationProps {
  formData: any;
  onFormChange: (data: any) => void;
  duration: number;
}

/** Shape the panel renders — from the server, or the local stand-in. */
interface PriceResult {
  perPerson: number;
  party: { breakdown: { meals: number; activities: number; transports: number; accommodation: number } };
  single: { perPerson: number };
  rows: {
    meals: any[];
    activities: any[];
    transports: any[];
    hotels: any[];
  };
}

/** Cents always, so the lines visibly add up to the totals. */
const money = (value: number) => formatCurrency(value, { minimumFractionDigits: 2 });

const mealLineText = (day: any) => {
  const priceOf = (meal: string) => (day.mealPrices?.[meal] != null ? ` × ${money(day.mealPrices[meal])}` : '');
  const parts = [];
  if (day.breakfastCount > 0) parts.push(`${day.breakfastCount} breakfast${day.breakfastCount > 1 ? 's' : ''}${priceOf('breakfast')}`);
  if (day.lunchCount > 0) parts.push(`${day.lunchCount} lunch${day.lunchCount > 1 ? 'es' : ''}${priceOf('lunch')}`);
  if (day.dinnerCount > 0) parts.push(`${day.dinnerCount} dinner${day.dinnerCount > 1 ? 's' : ''}${priceOf('dinner')}`);
  return parts.length > 0 ? parts.join(', ') : 'No meals';
};

/** "breakfast, dinner in hotel plan" — meals the hotel's board already covers. */
const includedMealText = (day: any) => {
  const included = day.includedMeals || {};
  const names = ['breakfast', 'lunch', 'dinner'].filter((meal) => included[meal] > 0);
  return names.length ? `${names.join(', ')} in hotel plan` : '';
};

const hasChargedMeals = (day: any) => day.breakfastCount + day.lunchCount + day.dinnerCount > 0;

/** One transport receipt line, per person: how the vehicle or fare is priced and shared. */
export function transportLine(transport: any, sharing: number) {
  const model = transport.pricingModel || 'PER_VEHICLE';
  const unit = Number(transport.unitCost) || 0;
  const mode = (TRANSPORT_MODE_LABELS as Record<string, string>)[transport.transportMode] || transport.transportMode || 'Transport';
  const day = `(Day ${transport.dayNumber})`;
  if (model === 'PER_PERSON') {
    return { label: `${mode} · ${money(unit)} per person ${day}`, cost: unit, single: unit };
  }
  if (model === 'PER_KM') {
    const km = Number(transport.distanceKm) || 0;
    const vehicleCost = unit * km;
    return { label: `${mode} · ${km} km × ${money(unit)} = ${money(vehicleCost)} per vehicle, shared by ${sharing} ${day}`, cost: vehicleCost / sharing, single: vehicleCost };
  }
  return { label: `${mode} · ${money(unit)} per vehicle, shared by ${sharing} ${day}`, cost: unit / sharing, single: unit };
}

/** One activity line: notes when this package uses its own price instead of the usual one. */
export function activityLine(activity: any) {
  const usual = Number(activity.defaultCost) || 0;
  const own = activity.costOverride != null && Number(activity.costOverride) !== usual;
  return `${activity.name} (Day ${activity.dayNumber})${own ? ` · package price, usual ${money(usual)}` : ''}`;
}

/** One hotel line: room, meal plan and how the room is shared — or that it has no price yet. */
export function hotelLine(hotel: any, sharing: number) {
  const details = [hotel.roomType, hotel.boardType].filter(Boolean).join(' · ');
  const name = `${hotel.name} (Day ${hotel.dayNumber})${details ? ` · ${details}` : ''}`;
  if (!(Number(hotel.roomPrice) > 0)) return { label: `${name} — no room price saved`, cost: 0, single: 0, missingPrice: true };
  return { label: `${name} — ${money(hotel.roomPrice)} per room night, shared by ${sharing}`, cost: hotel.roomPrice / sharing, single: Number(hotel.roomPrice), missingPrice: false };
}

/** The margin that makes cost + margin = `target`, kept in the package's margin type. */
export function marginForTarget(cost: number, target: number, type: string) {
  if (type === 'FIXED') return Math.round((target - cost) * 100) / 100;
  return marginForPrice(cost, target) ?? 0;
}

/**
 * Extra a traveller alone pays over the 2-sharing price: the other half of every
 * room and vehicle, plus any margin difference (a % margin grows with the cost).
 */
export function singleSupplement({ rooms, vehicles, sellShared, sellSingle }: { rooms: number; vehicles: number; sellShared: number; sellSingle: number }) {
  const round2 = (n: number) => Math.round(n * 100) / 100 + 0;
  const total = round2(sellSingle - sellShared);
  return { rooms: round2(rooms), vehicles: round2(vehicles), margin: round2(total - rooms - vehicles), total };
}

const ReceiptLine = ({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) => (
  <div className="flex items-center justify-between gap-3 text-sm py-1">
    <span className={muted ? 'text-muted-foreground/70' : 'text-muted-foreground'}>{label}</span>
    <span className={`shrink-0 font-mono font-medium tabular-nums ${muted ? 'text-muted-foreground/70' : 'text-foreground'}`}>{value}</span>
  </div>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold uppercase tracking-[0.14em] text-success mb-1.5 mt-4 first:mt-0">
    {children}
  </p>
);

const PriceTile = ({ icon: Icon, label, hint, value, highlight = false }: {
  icon: typeof User;
  label: string;
  hint: string;
  value: string;
  highlight?: boolean;
}) => (
  <div className={`rounded-lg border px-4 py-3 ${highlight ? 'border-success/40 bg-success/5' : 'border-border bg-card'}`}>
    <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </p>
    <p className={`mt-1 text-lg font-bold font-mono tabular-nums ${highlight ? 'text-success' : 'text-foreground'}`}>{value}</p>
    <p className="text-xs text-muted-foreground">{hint}</p>
  </div>
);

const Divider = () => (
  <div className="my-3 border-t-2 border-dashed border-border" />
);

/** Accepts the server's calculate-price response; null when it isn't usable. */
function fromServer(data: any): PriceResult | null {
  if (!data || !Number.isFinite(Number(data.packageCost)) || !data.rows || !data.party?.breakdown) return null;
  return {
    perPerson: Number(data.packageCost),
    party: data.party,
    single: { perPerson: Number(data.single?.perPerson) || 0 },
    rows: data.rows,
  };
}

const PriceCalculation = ({ formData, onFormChange, duration }: PriceCalculationProps) => {
  const itineraryDays = useMemo(
    () => (Array.isArray(formData.days) ? formData.days.filter(Boolean) : []),
    [formData.days]
  );

  const sharing = STANDARD_OCCUPANCY;
  const marginType = formData.defaultMarginType || 'PERCENTAGE';
  const marginValue = Number(formData.defaultMarginInput) || 0;

  const [serverResult, setServerResult] = useState<PriceResult | null>(null);
  const [updating, setUpdating] = useState(false);
  const requestSeq = useRef(0);
  const [targetPrice, setTargetPrice] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);

  const pricingDefaults = usePricingDefaults();
  const { mealPrices } = pricingDefaults;
  // Each margin type keeps its own number while editing, so 20% never becomes $20.
  const marginByType = useRef<Partial<Record<MarginType, number>>>({});
  const changeMarginType = (value: string) => {
    const nextType: MarginType = value === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    if (nextType === marginType) return;
    onFormChange({
      ...formData,
      defaultMarginType: nextType,
      defaultMarginInput: switchMarginValue({ type: marginType as MarginType, value: marginValue }, nextType, marginByType.current, pricingDefaults),
    });
  };

  // The exact days a save sends — priced locally as a stand-in.
  const localResult: PriceResult = useMemo(
    () => packagePriceFromDays(buildItineraryDaysPayload(itineraryDays), { mealPrices }),
    [itineraryDays, mealPrices]
  );

  // ── Server price (debounced) — what saving will store ────────────────────
  useEffect(() => {
    setServerResult(null);
    if (itineraryDays.length === 0) return undefined;

    setUpdating(true);
    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;
      try {
        const response = await ApiService.calculatePrice({ itineraryDays: formData.days });
        if (seq !== requestSeq.current) return;
        setServerResult(fromServer(response?.data));
      } catch {
        if (seq !== requestSeq.current) return;
        setServerResult(null);
      } finally {
        if (seq === requestSeq.current) setUpdating(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [itineraryDays, formData.days]);

  // Every number below comes from this one result.
  const result = serverResult ?? localResult;
  const share = (amount: number) => Math.round((amount / sharing) * 100) / 100;
  const subtotal = {
    meals: share(result.party.breakdown.meals),
    activities: share(result.party.breakdown.activities),
    transports: share(result.party.breakdown.transports),
    accommodation: share(result.party.breakdown.accommodation),
  };
  const packageCost = result.perPerson;
  const margin = computeMargin(packageCost, marginType, marginValue);
  const sellPerPerson = margin.sellPrice;
  const singleMargin = computeMargin(result.single.perPerson, marginType, marginValue);
  const singleSellPerPerson = singleMargin.sellPrice;
  const hasAnyCosts = packageCost > 0;

  const handleMarginNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onFormChange({
      ...formData,
      defaultMarginInput: value === '' ? 0 : (parseFloat(value) || 0),
    });
  };

  const applyTargetPrice = () => {
    const target = Number(targetPrice);
    if (!(packageCost > 0)) {
      setTargetError('Add costs to the itinerary first — a price needs a cost to build on.');
      return;
    }
    if (!(target >= packageCost)) {
      setTargetError(`That is below the cost of ${money(packageCost)} per person. Lower the costs or choose a higher price.`);
      return;
    }
    onFormChange({ ...formData, defaultMarginInput: marginForTarget(packageCost, target, marginType) });
    setTargetPrice('');
    setTargetError(null);
  };

  // ── Empty state ─────────────────────────────────────────────────────────
  if (itineraryDays.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted p-8 text-center">
          <Calculator className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground font-medium">Add itinerary days to see pricing</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4">
          <span className="text-sm font-semibold text-foreground">Sell price per person</span>
          <span className="text-xl font-bold font-mono tabular-nums text-foreground">{money(0)}</span>
        </div>
      </div>
    );
  }

  const { rows } = result;
  const transportLines = rows.transports.map((transport: any) => transportLine(transport, sharing));
  const hotelLines = rows.hotels.map((hotel: any) => hotelLine(hotel, sharing));
  const supplement = singleSupplement({
    rooms: hotelLines.reduce((sum: number, line: any) => sum + line.single - line.cost, 0),
    vehicles: transportLines.reduce((sum: number, line: any) => sum + line.single - line.cost, 0),
    sellShared: sellPerPerson,
    sellSingle: singleSellPerPerson,
  });
  const mealDays = rows.meals.filter((day: any) => hasChargedMeals(day) || includedMealText(day));

  return (
    <div className="space-y-4">
      {/* Margin controls */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-muted px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUp className="w-4 h-4" />
          Margin
          <Select
            value={marginType}
            onValueChange={(value) => changeMarginType(String(value))}
          >
            <SelectTrigger className="w-16">
              <SelectValue>{(v: string) => (v === 'FIXED' ? getCurrencySymbol() : '%')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PERCENTAGE">%</SelectItem>
              <SelectItem value="FIXED">{getCurrencySymbol()}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number" name="defaultMarginInput" min="0" step="0.01"
            value={formData.defaultMarginInput ?? 0}
            onChange={handleMarginNumberChange}
            onWheel={(e) => e.currentTarget.blur()}
            className="w-20 text-center"
          />
          <span className="text-sm font-semibold font-mono tabular-nums text-success">{money(margin.marginAmount)}</span>
        </div>
        {updating && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader className="w-3.5 h-3.5 animate-spin" />
            Updating price…
          </span>
        )}
      </div>

      {/* Set a selling price → the margin is worked out for it */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="target-sell-price" className="text-sm font-medium text-foreground">
            Set selling price per person
          </label>
          <Input
            id="target-sell-price"
            type="number"
            min="0"
            step="0.01"
            value={targetPrice}
            onChange={(e) => { setTargetPrice(e.target.value); setTargetError(null); }}
            onWheel={(e) => e.currentTarget.blur()}
            placeholder={String(sellPerPerson || '')}
            className="w-32"
          />
          <Button type="button" variant="outline" size="sm" onClick={applyTargetPrice} disabled={!targetPrice}>
            Apply
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The {marginType === 'FIXED' ? 'fixed' : '%'} margin is set so cost + margin = your price. Cost now: {money(packageCost)} per person.
        </p>
        {targetError && <p role="alert" className="text-xs font-medium text-destructive">{targetError}</p>}
      </div>

      {!pricingDefaults.mealPricesSet && (
        <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-xs font-medium text-warning">
          Meal prices are not set in Settings → Pricing Defaults, so meals are priced at 0 unless a day has its own price.
        </p>
      )}

      {/* ── Receipt ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <div className="px-5 py-4 bg-foreground flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Calculator className="w-5 h-5 text-success" />
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-background">Price Breakdown · Per Person, {sharing} Sharing</p>
              <p className="text-xs text-background/60">
                {duration} day{duration === 1 ? '' : 's'} · based on {sharing} travellers sharing one room and one vehicle
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {/* Meals */}
          <SectionTitle>Meals · each person pays their own</SectionTitle>
          {mealDays.map((day: any) => (
            <ReceiptLine
              key={`meal-${day.dayNumber}`}
              label={`Day ${day.dayNumber}  ${[hasChargedMeals(day) ? mealLineText(day) : '', includedMealText(day)].filter(Boolean).join(' · ')}`}
              value={money(day.costPerPerson)}
            />
          ))}
          {mealDays.length === 0 && <ReceiptLine label="No meal counts configured" value={money(0)} muted />}
          <ReceiptLine label="Meals subtotal" value={money(subtotal.meals)} muted />

          {/* Activities */}
          <SectionTitle>Activities · each person pays their own</SectionTitle>
          {rows.activities.map((activity: any, index: number) => (
            <ReceiptLine key={`act-${activity.dayNumber}-${index}`} label={activityLine(activity)} value={money(activity.costPerPerson)} />
          ))}
          {rows.activities.length === 0 && <ReceiptLine label="No activities" value={money(0)} muted />}
          <ReceiptLine label="Activities subtotal" value={money(subtotal.activities)} muted />

          {/* Transport */}
          <SectionTitle>Transport · a vehicle is shared, a ticket is per person</SectionTitle>
          {transportLines.map((line, index) => (
            <ReceiptLine key={`transport-${index}`} label={line.label} value={money(line.cost)} />
          ))}
          {transportLines.length === 0 && <ReceiptLine label="No transport costs" value={money(0)} muted />}
          <ReceiptLine label="Transport subtotal" value={money(subtotal.transports)} muted />

          {/* Accommodation */}
          <SectionTitle>Accommodation · one room shared by {sharing}</SectionTitle>
          {hotelLines.map((line, index) => (
            <ReceiptLine key={`acc-${index}`} label={line.label} value={line.missingPrice ? '—' : money(line.cost)} muted={line.missingPrice} />
          ))}
          {hotelLines.length === 0 && <ReceiptLine label="No hotel selected" value={money(0)} muted />}
          <ReceiptLine label="Accommodation subtotal" value={money(subtotal.accommodation)} muted />

          <Divider />

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-bold text-foreground">COST PER PERSON</span>
            <span className="text-lg font-bold font-mono tabular-nums text-foreground">{money(packageCost)}</span>
          </div>
          <ReceiptLine
            label={marginType === 'FIXED' ? `Margin (fixed ${money(marginValue)} per person)` : `Margin (${marginValue}% of cost)`}
            value={money(margin.marginAmount)}
            muted
          />

          <Divider />

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-bold text-foreground">SELL PRICE PER PERSON</span>
            <span className="text-2xl font-extrabold font-mono tabular-nums text-success">{money(sellPerPerson)}</span>
          </div>
          <p className="text-right text-xs text-muted-foreground">based on {sharing} sharing · shown on the website as "/ person"</p>

          {/* Single supplement */}
          <div className="mt-4 rounded-lg border border-border bg-muted px-4 py-3" aria-label="Single supplement">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground mb-1">Travelling alone · single supplement</p>
            <p className="text-xs text-muted-foreground mb-2">A traveller alone also pays the other half of each room and vehicle.</p>
            <ReceiptLine label="Rooms, other half" value={`+ ${money(supplement.rooms)}`} />
            <ReceiptLine label="Vehicles, other half" value={`+ ${money(supplement.vehicles)}`} />
            {Math.abs(supplement.margin) >= 0.01 && (
              <ReceiptLine label={`Margin on the extra (${marginValue}%)`} value={`+ ${money(supplement.margin)}`} />
            )}
            <div className="flex items-center justify-between py-1 border-t border-border mt-1">
              <span className="text-sm font-semibold text-foreground">Single supplement</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">+ {money(supplement.total)}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-sm font-semibold text-foreground">Single traveller pays (total)</span>
              <span className="font-mono font-bold tabular-nums text-foreground">{money(singleSellPerPerson)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* What customers actually pay */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Customer prices">
        <PriceTile icon={User} label={`Per person (${sharing} sharing)`} hint="the website price" value={money(sellPerPerson)} highlight />
        <PriceTile
          icon={Users}
          label={`Total for ${sharing} people`}
          hint="one shared room and vehicle"
          value={money(Math.round(sellPerPerson * sharing * 100) / 100)}
        />
        <PriceTile icon={User} label="Single traveller (total)" hint={`per person price + ${money(supplement.total)} supplement`} value={money(singleSellPerPerson)} />
      </div>

      {!hasAnyCosts && (
        <p className="text-xs text-muted-foreground text-center">
          Add meal counts, activity costs, and transport details in the itinerary below
        </p>
      )}
    </div>
  );
};

export default PriceCalculation;
