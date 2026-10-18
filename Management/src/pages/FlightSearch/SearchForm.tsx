import { ArrowRightLeft, Loader2, Search } from 'lucide-react';
import AirportAutocomplete from '../../components/AirportAutocomplete';
import PassengerSelector from '../../components/PassengerSelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { CABIN_CLASSES, TRIP_TYPES, todayStr } from './helpers';
import type { SearchFormState, TripType } from './types';

interface SearchFormProps {
  tripType: TripType;
  setTripType: (value: TripType) => void;
  form: SearchFormState;
  setForm: (updater: (form: SearchFormState) => SearchFormState) => void;
  nonstopOnly: boolean;
  setNonstopOnly: (value: boolean) => void;
  searching: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onSwap: () => void;
}

export default function SearchForm({
  tripType,
  setTripType,
  form,
  setForm,
  nonstopOnly,
  setNonstopOnly,
  searching,
  onSubmit,
  onSwap,
}: SearchFormProps) {
  return (
    <form onSubmit={onSubmit} className="mb-6 rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Tabs value={tripType} onValueChange={(value) => value && setTripType(value as TripType)}>
          <TabsList>
            {TRIP_TYPES.map((tt) => (
              <TabsTrigger key={tt.id} value={tt.id}>
                {tt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Class:</label>
          <Select value={form.cabinClass} onValueChange={(value) => value && setForm((f) => ({ ...f, cabinClass: value }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CABIN_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={nonstopOnly}
            onChange={(e) => setNonstopOnly(e.target.checked)}
            className="rounded accent-primary"
          />
          Nonstop only
        </label>
      </div>

      <div className="mb-4 grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
        <AirportAutocomplete
          label="From"
          value={form.origin}
          onChange={(code: string) => setForm((f) => ({ ...f, origin: code }))}
          placeholder="City or airport"
          excludeCode={form.destination}
        />
        <button
          type="button"
          onClick={onSwap}
          className="mb-0.5 hidden h-9 w-9 shrink-0 items-center justify-center self-end rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary md:flex"
          title="Swap origin and destination"
        >
          <ArrowRightLeft className="h-4 w-4" />
        </button>
        <AirportAutocomplete
          label="To"
          value={form.destination}
          onChange={(code: string) => setForm((f) => ({ ...f, destination: code }))}
          placeholder="City or airport"
          excludeCode={form.origin}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Departure</label>
          <Input
            type="date"
            value={form.departureDate}
            min={todayStr()}
            onChange={(e) => setForm((f) => ({ ...f, departureDate: e.target.value }))}
          />
        </div>
        {tripType === 'roundTrip' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Return</label>
            <Input
              type="date"
              value={form.returnDate}
              min={form.departureDate || todayStr()}
              onChange={(e) => setForm((f) => ({ ...f, returnDate: e.target.value }))}
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Passengers</label>
          <PassengerSelector
            adults={form.adults}
            children={form.children}
            infants={form.infants}
            onChange={(c: { adults: number; children: number; infants: number }) => setForm((f) => ({
              ...f,
              ...c,
              childAges: Array.from({ length: c.children }, (_, index) => f.childAges[index] ?? ''),
              infantAges: Array.from({ length: c.infants }, (_, index) => f.infantAges[index] ?? ''),
            }))}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={searching} className="w-full">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? 'Searching...' : 'Search Flights'}
          </Button>
        </div>
      </div>

      {(form.children > 0 || form.infants > 0) && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {form.childAges.map((age, index) => (
            <div key={`child-${index}`}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Child {index + 1} age</label>
              <Input
                type="number"
                min={2}
                max={17}
                value={age}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  childAges: current.childAges.map((value, ageIndex) => ageIndex === index ? event.target.value : value),
                }))}
              />
            </div>
          ))}
          {form.infantAges.map((age, index) => (
            <div key={`infant-${index}`}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Infant {index + 1} age</label>
              <Input
                type="number"
                min={0}
                max={1}
                value={age}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  infantAges: current.infantAges.map((value, ageIndex) => ageIndex === index ? event.target.value : value),
                }))}
              />
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
