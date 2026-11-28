/**
 * Itinerary Display Component
 * Read-only itinerary view aligned with the backend day-based structure
 */

import {
  MapPin, Activity, Utensils, Car, Building2,
  StickyNote, Image as ImageIcon, Coffee, UtensilsCrossed,
  Moon, Star, Phone, MapPinned, Clock, Calendar, BedDouble
} from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatRating } from '@/utils/number';

interface ItineraryDisplayProps {
  days?: any[];
}

const badgeVariants = {
  default: 'bg-muted text-muted-foreground border-border',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  primary: 'bg-primary/10 text-primary border-primary/20',
};

const InfoBadge = ({ icon: Icon, children, variant = 'default' }: { icon?: any; children: React.ReactNode; variant?: keyof typeof badgeVariants }) => (
  <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium', badgeVariants[variant])}>
    {Icon && <Icon className="w-3.5 h-3.5" />}
    {children}
  </span>
);

const Section = ({ label, icon: Icon, children }: { label: string; icon?: any; children: React.ReactNode }) => (
  <div>
    <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      {label}
    </h4>
    {children}
  </div>
);

const ItineraryDisplay = ({ days = [] }: ItineraryDisplayProps) => {
  const validDays = days.filter(Boolean);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const tabPrefix = useId();

  if (validDays.length === 0) {
    return (
      <div className="bg-muted rounded-xl border-2 border-dashed border-border p-12 text-center">
        <div className="w-16 h-16 bg-secondary rounded-xl flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground font-medium">No itinerary data available</p>
      </div>
    );
  }

  const selectedIndex = Math.min(activeDayIndex, validDays.length - 1);
  const activeDay = validDays[selectedIndex];

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Itinerary days" className="flex gap-2 overflow-x-auto pb-2">
        {validDays.map((day, index) => {
          const isActive = index === selectedIndex;
          return (
            <button
              key={day.dayNumber ?? index}
              type="button"
              role="tab"
              id={`${tabPrefix}-day-${day.dayNumber ?? index}-tab`}
              aria-label={`Day ${day.dayNumber}${day.title ? `: ${day.title}` : ''}`}
              aria-selected={isActive}
              aria-controls={`${tabPrefix}-day-${day.dayNumber ?? index}-panel`}
              onClick={() => setActiveDayIndex(index)}
              className={cn(
                'flex min-h-14 w-40 shrink-0 flex-col items-start justify-center gap-1 rounded-xl border-2 px-3 py-2 text-left transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-foreground hover:border-primary/40'
              )}
            >
              <span className={cn('text-xs font-semibold uppercase', isActive ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                Day {day.dayNumber}
              </span>
              <span className="w-full truncate text-sm font-semibold">{day.title || `Day ${day.dayNumber}`}</span>
            </button>
          );
        })}
      </div>

      {activeDay && (() => {
        const day = activeDay;
        const dayPanelId = `${tabPrefix}-day-${day.dayNumber ?? selectedIndex}-panel`;
        const dayTabId = `${tabPrefix}-day-${day.dayNumber ?? selectedIndex}-tab`;
        const locations = Array.isArray(day.locations) ? day.locations : [];
        const activities = Array.isArray(day.activities) ? day.activities : [];
        return (
        <div key={day.dayNumber ?? selectedIndex} id={dayPanelId} role="tabpanel" aria-labelledby={dayTabId} className="bg-card rounded-xl border border-border overflow-hidden shadow-card">
          {/* Day Header */}
          <div className="bg-primary text-primary-foreground px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary-foreground/20 rounded-lg flex items-center justify-center">
                <span className="text-xl font-bold font-mono">{day.dayNumber}</span>
              </div>
              <div>
                <h3 className="text-lg font-heading font-semibold">
                  Day {day.dayNumber}{day.title ? `: ${day.title}` : ''}
                </h3>
                {locations.length > 0 && (
                  <p className="text-primary-foreground/80 text-sm flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {locations.slice(0, 3).join(' → ')}
                    {locations.length > 3 && ` +${locations.length - 3} more`}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Day Content */}
          <div className="p-6 space-y-5">
            {/* Description */}
            {day.description && (
              <div className="bg-muted rounded-lg p-4 border border-border">
                <p className="text-muted-foreground text-sm whitespace-pre-wrap leading-relaxed">{day.description}</p>
              </div>
            )}

            {/* Locations Covered */}
            {locations.length > 0 && (
              <Section label="Locations Covered" icon={MapPin}>
                <div className="flex flex-wrap gap-2">
                  {locations.map((location: string, idx: number) => (
                    <InfoBadge key={idx} icon={MapPinned} variant="success">
                      {location}
                    </InfoBadge>
                  ))}
                </div>
              </Section>
            )}

            {/* Activities */}
            {activities.length > 0 && (
              <Section label="Activities" icon={Activity}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activities.map((activity: string, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 bg-primary/5 text-primary px-3 py-2 rounded-lg border border-primary/10">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                      <span className="text-sm">{activity}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Meals and Transport Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Meals */}
              {day.meals && (day.meals.breakfast || day.meals.lunch || day.meals.dinner) && (
                <Section label="Meals Included" icon={Utensils}>
                  <div className="flex flex-wrap gap-2">
                    {day.meals.breakfast && (
                      <InfoBadge icon={Coffee} variant="warning">Breakfast</InfoBadge>
                    )}
                    {day.meals.lunch && (
                      <InfoBadge icon={UtensilsCrossed} variant="warning">Lunch</InfoBadge>
                    )}
                    {day.meals.dinner && (
                      <InfoBadge icon={Moon} variant="warning">Dinner</InfoBadge>
                    )}
                  </div>
                </Section>
              )}

              {/* Transport */}
              {day.transport && (
                <Section label="Transport" icon={Car}>
                  <InfoBadge variant="primary">
                    {day.transport === 'flight' && '✈️ '}
                    {day.transport === 'train' && '🚂 '}
                    {day.transport === 'bus' && '🚌 '}
                    {day.transport === 'car' && '🚗 '}
                    {day.transport === 'boat' && '⛵ '}
                    {day.transport === 'walk' && '🚶 '}
                    {day.transport.charAt(0).toUpperCase() + day.transport.slice(1)}
                  </InfoBadge>
                </Section>
              )}
            </div>

            {/* Places */}
            {Array.isArray(day.places) && day.places.length > 0 && (
              <Section label="Places to Visit" icon={MapPin}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {day.places.map((place: any, idx: number) => (
                    <div key={idx} className="bg-success/5 rounded-lg p-4 border border-success/10">
                      <p className="font-medium text-success">{place.name}</p>
                      {place.description && (
                        <p className="text-muted-foreground text-sm mt-1">{place.description}</p>
                      )}
                      {place.duration && (
                        <p className="text-success text-xs mt-2 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {place.duration}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Notes */}
            {day.notes && (
              <Section label="Additional Notes" icon={StickyNote}>
                <div className="bg-warning/5 rounded-lg p-4 border border-warning/10">
                  <p className="text-warning text-sm">{day.notes}</p>
                </div>
              </Section>
            )}

            {/* Day Images */}
            {Array.isArray(day.images) && day.images.length > 0 && (
              <Section label="Day Images" icon={ImageIcon}>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {day.images.map((img: any, idx: number) => {
                    const imageUrl = typeof img === 'string' ? img : img.url;
                    return (
                      <div key={idx} className="aspect-square rounded-lg overflow-hidden border-2 border-border hover:border-primary/40 transition-colors shadow-card group">
                        <img
                          src={imageUrl}
                          alt={`Day ${day.dayNumber} Image ${idx + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50" y="50" text-anchor="middle" dominant-baseline="middle"%3EImage%3C/text%3E%3C/svg%3E';
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Accommodation */}
            {day.accommodation && day.accommodation.name && (
              <Section label="Accommodation" icon={Building2}>
                <div className="bg-muted rounded-lg p-4 border border-border flex flex-col sm:flex-row gap-4">
                  {day.accommodation.hotelImage && (
                    <img
                      src={day.accommodation.hotelImage}
                      alt={day.accommodation.name}
                      className="w-full sm:w-40 h-32 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <h5 className="font-semibold text-foreground text-base">{day.accommodation.name}</h5>
                      {day.accommodation.type && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-md capitalize">
                          {day.accommodation.type === 'hotel' && '🏨 '}
                          {day.accommodation.type === 'resort' && '🌴 '}
                          {day.accommodation.type === 'guesthouse' && '🏡 '}
                          {day.accommodation.type === 'homestay' && '🏠 '}
                          {day.accommodation.type === 'camp' && '⛺ '}
                          {day.accommodation.type}
                        </span>
                      )}
                    </div>
                    {day.accommodation.rating > 0 && (
                      <div className="flex items-center gap-1 bg-warning/10 text-warning px-3 py-1 rounded-lg">
                        <Star className="w-4 h-4 fill-warning text-warning" />
                        <span className="font-semibold">{formatRating(day.accommodation.rating)}</span>
                        <span className="text-xs">/5</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {day.accommodation.address && (
                      <p className="text-muted-foreground text-sm flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5" />
                        {day.accommodation.address}
                      </p>
                    )}
                    {day.accommodation.contactNumber && (
                      <p className="text-muted-foreground text-sm flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5" />
                        {day.accommodation.contactNumber}
                      </p>
                    )}
                  </div>

                  {(day.accommodation.roomType || day.accommodation.boardType || Number(day.accommodation.totalAmount) > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {day.accommodation.roomType && (
                        <InfoBadge icon={BedDouble} variant="primary">{day.accommodation.roomType}</InfoBadge>
                      )}
                      {day.accommodation.boardType && (
                        <InfoBadge icon={Utensils}>{day.accommodation.boardType}</InfoBadge>
                      )}
                      {Number(day.accommodation.totalAmount) > 0 && (
                        <InfoBadge variant="warning">
                          {new Intl.NumberFormat(undefined, { style: 'currency', currency: day.accommodation.currency || 'USD' })
                            .format(Number(day.accommodation.totalAmount))} / room / night
                        </InfoBadge>
                      )}
                    </div>
                  )}
                  </div>
                </div>
              </Section>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default ItineraryDisplay;
