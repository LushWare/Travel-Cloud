import { TRANSPORT_MODE_LABELS, PRICING_MODEL_LABELS } from '@travel-crm/constants';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizePricingDefaults, seatsFor, PRICING_MODELS, type PricingModel } from '@/features/itinerary/hooks/usePricingDefaults';

export const RATE_MODES = ['CAR', 'VAN', 'BUS', 'TRAIN', 'BOAT'] as const;
const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
] as const;

const RATE_HEADINGS: Record<PricingModel, string> = {
  PER_VEHICLE: 'Per vehicle',
  PER_KM: 'Per km',
  PER_PERSON: 'Per person',
};

const STARTING_MODEL: Record<string, PricingModel> = {
  CAR: 'PER_VEHICLE', VAN: 'PER_VEHICLE', BUS: 'PER_PERSON', TRAIN: 'PER_PERSON', BOAT: 'PER_PERSON',
};

export interface PricingForm {
  meals: Record<'breakfast' | 'lunch' | 'dinner', string>;
  marginType: 'PERCENTAGE' | 'FIXED';
  marginPercentage: string;
  marginFixed: string;
  transport: Record<string, { pricingModel: PricingModel; seats: string } & Record<PricingModel, string>>;
  peoplePerRoom: string;
}

const asText = (value: unknown) => (value == null || value === '' ? '' : String(value));

export function pricingToForm(raw: any): PricingForm {
  const d = normalizePricingDefaults(raw);
  return {
    meals: {
      breakfast: asText(raw?.mealPrices?.breakfast),
      lunch: asText(raw?.mealPrices?.lunch),
      dinner: asText(raw?.mealPrices?.dinner),
    },
    marginType: d.margin.type,
    marginPercentage: asText(raw?.margin?.percentage),
    marginFixed: asText(raw?.margin?.fixed),
    transport: Object.fromEntries(RATE_MODES.map((mode) => {
      const rates: any = d.transportRates[mode] || {};
      return [mode, {
        pricingModel: (PRICING_MODELS.includes(rates.pricingModel) ? rates.pricingModel : STARTING_MODEL[mode]) as PricingModel,
        PER_VEHICLE: asText(rates.PER_VEHICLE),
        PER_KM: asText(rates.PER_KM),
        PER_PERSON: asText(rates.PER_PERSON),
        seats: asText(seatsFor(d, mode)),
      }];
    })),
    peoplePerRoom: asText(raw?.peoplePerRoom),
  };
}

const isPrice = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const isWholeAtLeastOne = (value: string) => /^\d+$/.test(value.trim()) && Number(value) >= 1;

/** Payload for PUT /admin/settings, or an error message for the first invalid field. */
export function pricingFormToPayload(form: PricingForm): { value?: any; error?: string } {
  const value: Record<string, unknown> = {};
  const blank = (text: string) => text.trim() === '';

  if (!MEALS.every((m) => blank(form.meals[m.key]))) {
    const missing = MEALS.find((m) => !isPrice(form.meals[m.key]));
    if (missing) return { error: `Enter a ${missing.label.toLowerCase()} price (0 or more)` };
    value.mealPrices = Object.fromEntries(MEALS.map((m) => [m.key, Number(form.meals[m.key])]));
  }
  if (!blank(form.marginPercentage) || !blank(form.marginFixed)) {
    if (!isPrice(form.marginPercentage)) return { error: 'Enter a default margin percentage (0 or more)' };
    if (Number(form.marginPercentage) > 1000) return { error: 'A percentage margin must be at most 1000%' };
    if (!isPrice(form.marginFixed)) return { error: 'Enter a default fixed margin (0 or more)' };
    value.margin = { type: form.marginType, percentage: Number(form.marginPercentage), fixed: Number(form.marginFixed) };
  }
  if (!blank(form.peoplePerRoom)) {
    if (!isWholeAtLeastOne(form.peoplePerRoom) || Number(form.peoplePerRoom) > 10) return { error: 'People per room must be a whole number from 1 to 10' };
    value.peoplePerRoom = Number(form.peoplePerRoom);
  }

  const transportRates: Record<string, Record<string, unknown>> = {};
  for (const mode of RATE_MODES) {
    const row = form.transport[mode];
    const rates: Record<string, number> = {};
    for (const model of PRICING_MODELS) {
      const value = row[model].trim();
      if (value === '') continue;
      if (!isPrice(value)) return { error: `Enter a valid ${TRANSPORT_MODE_LABELS[mode].toLowerCase()} ${RATE_HEADINGS[model].toLowerCase()} rate` };
      if (Number(value) > 0) rates[model] = Number(value);
    }
    const seats = row.seats.trim();
    if (seats !== '' && (!isWholeAtLeastOne(seats) || Number(seats) > 500)) return { error: `${TRANSPORT_MODE_LABELS[mode]} seats must be a whole number from 1 to 500` };
    if (Object.keys(rates).length === 0 && seats === '') continue;
    transportRates[mode] = { pricingModel: row.pricingModel, ...rates, ...(seats !== '' ? { seats: Number(seats) } : {}) };
  }

  value.transportRates = transportRates;
  return { value };
}

const numberInput = {
  type: 'number', min: '0', step: '0.01', className: 'h-9',
  onWheel: (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur(),
} as const;

export default function PricingDefaultsSection({ form, onChange, currency }: {
  form: PricingForm;
  onChange: (next: PricingForm) => void;
  currency: string;
}) {
  const unit = currency || 'USD';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Defaults</CardTitle>
        <CardDescription>
          Starting costs for packages and quotes. Every one can still be changed on a day or a package.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-foreground">Meal price per person</p>
          <p className="text-xs text-muted-foreground mb-2">
            Used for every package day without its own price. Changing these updates those package prices.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {MEALS.map((meal) => (
              <div key={meal.key}>
                <label htmlFor={`meal-${meal.key}`} className="block text-sm font-medium text-foreground mb-1.5">{meal.label} ({unit})</label>
                <Input
                  id={`meal-${meal.key}`}
                  {...numberInput}
                  value={form.meals[meal.key]}
                  onChange={(e) => onChange({ ...form, meals: { ...form.meals, [meal.key]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Default profit margin</p>
          <p className="text-xs text-muted-foreground mb-2">
            Both values are kept. New packages start with the selected one; a rep can switch per package. Saved packages keep their own margin.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">New packages use</label>
              <Select value={form.marginType} onValueChange={(value) => onChange({ ...form, marginType: value === 'FIXED' ? 'FIXED' : 'PERCENTAGE' })}>
                <SelectTrigger className="w-full" aria-label="Default margin type">
                  <SelectValue>{(v: string) => (v === 'FIXED' ? 'Fixed amount' : 'Percentage')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="FIXED">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="margin-percentage" className="block text-sm font-medium text-foreground mb-1.5">Percentage (%)</label>
              <Input
                id="margin-percentage"
                {...numberInput}
                value={form.marginPercentage}
                onChange={(e) => onChange({ ...form, marginPercentage: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="margin-fixed" className="block text-sm font-medium text-foreground mb-1.5">Fixed amount per person ({unit})</label>
              <Input
                id="margin-fixed"
                {...numberInput}
                value={form.marginFixed}
                onChange={(e) => onChange({ ...form, marginFixed: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Transport rates ({unit})</p>
          <p className="text-xs text-muted-foreground mb-2">
            Filled in when a rep adds that vehicle or switches how it is charged. Leave a rate blank to start at 0. Flights always use the real fare.
            Seats decide how many vehicles a lead's group needs.
          </p>
          <div className="overflow-x-auto">
            <div className="min-w-[640px] space-y-2">
              <div className="grid grid-cols-[5rem_repeat(3,1fr)_5rem_9rem] gap-3 text-xs font-medium text-muted-foreground">
                <span>Vehicle</span>
                {PRICING_MODELS.map((model) => <span key={model}>{RATE_HEADINGS[model]}</span>)}
                <span>Seats</span>
                <span>Starts as</span>
              </div>
              {RATE_MODES.map((mode) => {
                const row = form.transport[mode];
                const setRow = (patch: Partial<typeof row>) => onChange({ ...form, transport: { ...form.transport, [mode]: { ...row, ...patch } } });
                const label = TRANSPORT_MODE_LABELS[mode];
                return (
                  <div key={mode} className="grid grid-cols-[5rem_repeat(3,1fr)_5rem_9rem] items-center gap-3">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    {PRICING_MODELS.map((model) => (
                      <Input
                        key={model}
                        {...numberInput}
                        aria-label={`${label} ${RATE_HEADINGS[model].toLowerCase()} rate`}
                        placeholder="0"
                        value={row[model]}
                        onChange={(e) => setRow({ [model]: e.target.value })}
                      />
                    ))}
                    <Input
                      type="number" min="1" step="1" className="h-9"
                      aria-label={`${label} seats`}
                      value={row.seats}
                      onChange={(e) => setRow({ seats: e.target.value })}
                      onWheel={(e) => e.currentTarget.blur()}
                    />
                    <Select value={row.pricingModel} onValueChange={(value) => setRow({ pricingModel: String(value) as PricingModel })}>
                      <SelectTrigger aria-label={`${label} starting pricing`}>
                        <SelectValue>{(v: string) => (PRICING_MODEL_LABELS as Record<string, string>)[v] || v}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PRICING_MODELS.map((model) => (
                          <SelectItem key={model} value={model}>{RATE_HEADINGS[model]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Rooms</p>
          <p className="text-xs text-muted-foreground mb-2">
            How many travellers share one room when a lead's rooms are counted. Website package prices are always for 2 sharing.
          </p>
          <div className="w-40">
            <label htmlFor="people-per-room" className="block text-sm font-medium text-foreground mb-1.5">People per room</label>
            <Input
              id="people-per-room"
              type="number" min="1" max="10" step="1" className="h-9"
              value={form.peoplePerRoom}
              onChange={(e) => onChange({ ...form, peoplePerRoom: e.target.value })}
              onWheel={(e) => e.currentTarget.blur()}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
