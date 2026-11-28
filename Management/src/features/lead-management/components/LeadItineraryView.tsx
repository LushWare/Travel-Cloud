import { useState, type ReactNode } from 'react';
import {
  BedDouble,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Coffee,
  MapPin,
  Moon,
  Plane,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { TRANSPORT_OPTIONS } from '@/features/itinerary/types';
import { toEditorDays } from '../utils/toEditorDays';

interface LeadItineraryViewProps {
  /** Package selections as returned by GET /leads/:id/packages. */
  selections: any[];
  /** Lead travel start date; when present each day shows its calendar date. */
  travelDate?: string | null;
}

const TRANSPORT_LABEL: Record<string, string> = Object.fromEntries(
  TRANSPORT_OPTIONS.map((o: any) => [o.value, `${o.icon ?? ''} ${o.label}`.trim()])
);

function selectionLabel(selection: any): string {
  return selection?.isManual ? 'Manual Itinerary' : (selection?.packageName || 'Package');
}

function dayDate(travelDate: string | null | undefined, dayNumber: number): string | null {
  if (!travelDate) return null;
  const start = new Date(travelDate);
  if (Number.isNaN(start.getTime())) return null;
  start.setDate(start.getDate() + (dayNumber - 1));
  return start.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

function flightLabel(flight: any): string {
  const carrier = [flight?.airline || flight?.carrier || flight?.airlineName, flight?.flightNumber]
    .filter(Boolean)
    .join(' ');
  const route = [flight?.origin || flight?.from, flight?.destination || flight?.to].filter(Boolean).join(' → ');
  return [carrier, route].filter(Boolean).join(' · ') || 'Flight';
}

/** Read-model of one day, so tabs, summary and panel agree on the same facts. */
function describeDay(day: any) {
  const places: string[] = (day.locations || []).map(String).filter(Boolean);
  const activities: string[] = (day.activities || []).map(String).filter(Boolean);
  const meals = [
    day.meals?.breakfast && { icon: Coffee, label: 'Breakfast' },
    day.meals?.lunch && { icon: Sun, label: 'Lunch' },
    day.meals?.dinner && { icon: Moon, label: 'Dinner' },
  ].filter(Boolean) as { icon: LucideIcon; label: string }[];
  const hotel = day.accommodation?.name ? day.accommodation : null;
  const transports: string[] = (day.transports || [])
    .map((t: any) => (t?.transportMode ? TRANSPORT_LABEL[t.transportMode] || t.transportMode : null))
    .filter(Boolean);
  const flights: any[] = Array.isArray(day.flights) ? day.flights : [];
  return { places, activities, meals, hotel, transports, flights };
}

function Chip({ icon: Icon, children, tone }: { icon: LucideIcon; children: ReactNode; tone?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground',
        tone
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Same label treatment as the editor's FieldGroup, with read-only content. */
function Block({ icon: Icon, label, children, className }: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {label}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function DayPanel({ day, date }: { day: any; date: string | null }) {
  const { places, activities, meals, hotel, transports, flights } = describeDay(day);
  const summary = [
    places.length ? `${places.length} place${places.length === 1 ? '' : 's'}` : null,
    activities.length ? `${activities.length} activit${activities.length === 1 ? 'y' : 'ies'}` : null,
    hotel ? hotel.name : null,
  ].filter(Boolean) as string[];

  return (
    <div
      id={`view-day-${day.dayNumber}-content`}
      role="tabpanel"
      aria-labelledby={`view-day-${day.dayNumber}-tab`}
      className="bg-card rounded-xl border border-border shadow-card overflow-hidden"
    >
      {/* Day header — mirrors the editor's compact day header */}
      <div className="flex items-center gap-4 border-b border-border px-6 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold font-mono text-primary dark:bg-primary/20">
          {String(day.dayNumber).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase text-muted-foreground">
            Day {day.dayNumber}{date && <span className="normal-case"> · {date}</span>}
          </span>
          <h4 className="truncate font-heading text-base font-semibold text-foreground">
            {day.title || `Day ${day.dayNumber}`}
          </h4>
          {summary.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {summary.map((item) => (
                <span key={item} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground dark:bg-secondary dark:text-foreground/90">
                  {item}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-5 p-6">
        {day.description && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
            {day.description}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Block icon={MapPin} label="Places">
            {places.length ? (
              <div className="flex flex-wrap gap-1.5">
                {places.map((p, i) => <Chip key={`${p}-${i}`} icon={MapPin}>{p}</Chip>)}
              </div>
            ) : <Empty>No places added</Empty>}
          </Block>

          <Block icon={Sparkles} label="Activities">
            {activities.length ? (
              <div className="flex flex-wrap gap-1.5">
                {activities.map((a, i) => <Chip key={`${a}-${i}`} icon={Sparkles}>{a}</Chip>)}
              </div>
            ) : <Empty>No activities added</Empty>}
          </Block>

          <Block icon={Coffee} label="Meals">
            {meals.length ? (
              <div className="flex flex-wrap gap-1.5">
                {meals.map((m) => (
                  <Chip key={m.label} icon={m.icon} tone="border-success/30 bg-success/5">{m.label}</Chip>
                ))}
              </div>
            ) : <Empty>No meals included</Empty>}
          </Block>

          <Block icon={Car} label="Transport">
            {transports.length ? (
              <div className="flex flex-wrap gap-1.5">
                {transports.map((t, i) => <Chip key={`${t}-${i}`} icon={Car}>{t}</Chip>)}
              </div>
            ) : <Empty>No transport added</Empty>}
          </Block>

          <Block icon={BedDouble} label="Stay">
            {hotel ? (
              <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                {hotel.hotelImage && (
                  <img src={hotel.hotelImage} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {hotel.name}
                    {hotel.rating > 0 && (
                      <span className="ml-1.5 text-xs text-warning">{'★'.repeat(Math.min(5, Math.round(hotel.rating)))}</span>
                    )}
                  </p>
                  {(hotel.roomType || hotel.boardType) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[hotel.roomType, hotel.boardType].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ) : <Empty>No stay booked</Empty>}
          </Block>

          <Block icon={Plane} label="Flights">
            {flights.length ? (
              <div className="flex flex-wrap gap-1.5">
                {flights.map((f, i) => <Chip key={f?.id || i} icon={Plane}>{flightLabel(f)}</Chip>)}
              </div>
            ) : <Empty>No flights</Empty>}
          </Block>
        </div>
      </div>
    </div>
  );
}

export default function LeadItineraryView({ selections, travelDate }: LeadItineraryViewProps) {
  const [activeId, setActiveId] = useState<string | null>(selections[0]?.id ?? null);
  const [activeDay, setActiveDay] = useState(0);
  const active = selections.find((s) => s.id === activeId) ?? selections[0];
  const days = toEditorDays(active?.itineraryDays || [])
    .filter(Boolean)
    .sort((a: any, b: any) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));
  const dayIndex = Math.min(activeDay, Math.max(days.length - 1, 0));
  const day: any = days[dayIndex];

  if (selections.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
        <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No package attached, so there is no itinerary yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selections.length > 1 && (
        <div role="tablist" aria-label="Itinerary package" className="flex flex-wrap gap-2">
          {selections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === active?.id}
              onClick={() => { setActiveId(s.id); setActiveDay(0); }}
              className={cn(
                'shrink-0 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-colors',
                s.id === active?.id
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-foreground hover:border-primary/40'
              )}
            >
              {selectionLabel(s)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{selectionLabel(active)}</p>
        <p className="text-xs text-muted-foreground">
          {days.length} day{days.length === 1 ? '' : 's'}
          {days.length > 1 && ` · ${days.length - 1} night${days.length - 1 === 1 ? '' : 's'}`}
        </p>
      </div>

      {active?.derivationError ? (
        <p className="text-sm text-destructive">Couldn't load this package's itinerary right now.</p>
      ) : days.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground bg-card rounded-xl border-2 border-dashed border-border">
          <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No itinerary days planned yet</p>
        </div>
      ) : (
        <>
          {/* Day tabs — same cards as the Edit Lead itinerary editor */}
          <div role="tablist" aria-label="Itinerary days" className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d: any, index: number) => {
              const isActive = index === dayIndex;
              return (
                <button
                  key={d.dayNumber ?? index}
                  type="button"
                  role="tab"
                  id={`view-day-${d.dayNumber}-tab`}
                  aria-label={`Day ${d.dayNumber}${d.title ? `: ${d.title}` : ''}`}
                  aria-selected={isActive}
                  aria-controls={`view-day-${d.dayNumber}-content`}
                  onClick={() => setActiveDay(index)}
                  className={cn(
                    'flex min-h-14 w-40 shrink-0 flex-col items-start justify-center gap-1 rounded-xl border-2 px-3 py-2 text-left transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'border-border bg-card text-foreground hover:border-primary/40'
                  )}
                >
                  <span className={cn('text-xs font-semibold uppercase', isActive ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                    Day {d.dayNumber}
                  </span>
                  <span className="w-full truncate text-sm font-semibold">{d.title || `Day ${d.dayNumber}`}</span>
                </button>
              );
            })}
          </div>

          <DayPanel day={day} date={dayDate(travelDate, day.dayNumber)} />

          {days.length > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dayIndex === 0}
                onClick={() => setActiveDay(dayIndex - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous day
              </Button>
              <span className="text-xs text-muted-foreground">Day {dayIndex + 1} of {days.length}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dayIndex === days.length - 1}
                onClick={() => setActiveDay(dayIndex + 1)}
              >
                Next day
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
