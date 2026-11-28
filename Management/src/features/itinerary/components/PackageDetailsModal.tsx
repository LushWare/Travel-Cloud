/**
 * Package Details Modal Component
 * Displays comprehensive information about a package
 */

import { useEffect, useState } from 'react';
import {
  Star, MapPin, Calendar, Briefcase, Eye, Pencil, Package, DollarSign,
  Tag, Banknote, Check, XCircle,
  Image as ImageIcon, CalendarDays, BookOpen, TrendingUp, Loader2, FileText,
  type LucideIcon,
} from 'lucide-react';
import ItineraryDisplay from './ItineraryDisplay';
import { formatPriceINR } from '../utils/helpers';
import { formatRating, formatNumber } from '@/utils/number';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormDialogHeader, FormDialogBody, FormDialogSection, FormDialogFooter } from '@/components/shared/FormDialogSections';

interface PackageDetailsModalProps {
  pkg: any;
  onClose: () => void;
  onEdit?: (pkg: any) => void;
  /** True while the full package (itinerary days) is still being fetched. */
  isLoadingDetails?: boolean;
}

// min-w-0 on the card and on the text column is what lets a long value shrink to
// its grid track instead of forcing the row wider; break-words then wraps it onto
// further lines. Wrapping rather than truncating is deliberate — the value is what
// the user opened the modal to read, and the grid's rows already size to the tallest
// tile.
const InfoCard = ({ label, value, icon: Icon }: { label: string; value?: string | null; icon: LucideIcon }) => (
  <div className="bg-card rounded-lg border border-border p-4 hover:shadow-card transition-shadow min-w-0">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-semibold text-foreground mt-0.5 break-words">{value || 'N/A'}</p>
      </div>
    </div>
  </div>
);

const PackageDetailsModal = ({ pkg, onClose, onEdit, isLoadingDetails = false }: PackageDetailsModalProps) => {
  const [activeSection, setActiveSection] = useState<'basic' | 'images' | 'itinerary'>('basic');

  useEffect(() => {
    setActiveSection('basic');
  }, [pkg?._id, pkg?.id]);

  if (!pkg) return null;

  const displayPrice = pkg.sellPrice ?? pkg.basePrice;
  const formattedPrice = displayPrice ? formatPriceINR(displayPrice) : null;
  const rawDays = Array.isArray(pkg.itineraryDays)
    ? pkg.itineraryDays
    : (Array.isArray(pkg.days) ? pkg.days : (Array.isArray(pkg.itinerary?.days) ? pkg.itinerary.days : []));
  // Map relational itineraryDays → display-friendly format
  const days = rawDays.filter(Boolean).map((d: any) => ({
    dayNumber: d.dayNumber,
    title: d.title || '',
    description: d.description || '',
    locations: (Array.isArray(d.places) ? d.places : []).map((p: any) => p.place?.name || p.customName).filter(Boolean),
    activities: (Array.isArray(d.activities) ? d.activities : []).map((a: any) => a.activity?.name || a.name || '').filter(Boolean),
    meals: d.meals || { breakfast: (d.breakfastCount || 0) > 0, lunch: (d.lunchCount || 0) > 0, dinner: (d.dinnerCount || 0) > 0 },
    transport: (Array.isArray(d.transports) && d.transports[0]?.transportMode?.toLowerCase()) || d.transport || 'car',
    places: (Array.isArray(d.places) ? d.places : []).map((p: any) => ({ name: p.place?.name || p.customName || '' })),
    accommodation: d.accommodation?.name ? d.accommodation : null,
    images: Array.isArray(d.images) ? d.images : [],
  }));
  const nights = pkg.durationDays ? pkg.durationDays - 1 : 0;

  return (
    <Dialog open={!!pkg} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="h-dvh w-screen max-w-none max-h-none rounded-none p-0 gap-0 overflow-hidden flex flex-col sm:h-[92vh] sm:w-[96vw] sm:max-w-[1440px] sm:max-h-[1000px] sm:rounded-xl"
        closeClassName="text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground dark:hover:bg-primary-foreground/20 dark:hover:text-primary-foreground"
      >
        <FormDialogHeader
          icon={Eye}
          title="Package Details"
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{pkg.title || 'Untitled package'}</span>
              <Badge className={pkg.isActive ? 'bg-success/20 text-primary-foreground' : 'bg-warning/20 text-primary-foreground'}>
                {pkg.isActive ? 'Published' : 'Draft'}
              </Badge>
            </span>
          }
          actions={onEdit ? (
            <Button
              type="button"
              aria-label="Edit Details"
              onClick={() => onEdit(pkg)}
              className="bg-primary-foreground/15 text-primary-foreground ring-1 ring-primary-foreground/40 hover:bg-primary-foreground/25 sm:min-w-32"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Edit Details</span>
            </Button>
          ) : undefined}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <div
            role="tablist"
            aria-label="Package detail sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r sm:p-3"
          >
            {[
              { id: 'basic' as const, label: 'Basic Information', icon: FileText },
              { id: 'images' as const, label: 'Package Images', icon: ImageIcon },
              { id: 'itinerary' as const, label: 'Day-wise Itinerary', icon: CalendarDays },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                id={`package-${id}-tab`}
                type="button"
                role="tab"
                aria-selected={activeSection === id}
                aria-controls={`package-${id}-panel`}
                onClick={() => setActiveSection(id)}
                className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:w-full sm:justify-start ${
                  activeSection === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div
            id={`package-${activeSection}-panel`}
            role="tabpanel"
            aria-labelledby={`package-${activeSection}-tab`}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <FormDialogBody className="min-h-0 space-y-6 overscroll-y-contain [scrollbar-gutter:stable]">
              {activeSection === 'basic' && (
                <FormDialogSection
                  id="basic"
                  expanded
                  onToggle={() => {}}
                  icon={Package}
                  title="Basic Information"
                  subtitle="Package category, destination, duration, and description"
                >
                  {/* Keep quick facts on the first tab so package identity is immediate. */}
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <InfoCard
                        label="Category"
                        value={pkg.category ? pkg.category.charAt(0).toUpperCase() + pkg.category.slice(1) : 'N/A'}
                        icon={Tag}
                      />
                      <InfoCard label="Destination" value={pkg.destination} icon={MapPin} />
                      <InfoCard label="Duration" value={pkg.durationDays ? `${pkg.durationDays}D / ${nights}N` : 'N/A'} icon={Calendar} />
                      <InfoCard label="Price per person (twin sharing)" value={formattedPrice} icon={Banknote} />
                      <InfoCard
                        label="Margin"
                        value={pkg.defaultMarginType === 'PERCENTAGE' ? `${formatNumber(pkg.defaultMarginInput, 2)}%` : `$${formatNumber(pkg.defaultMarginInput, 2)}`}
                        icon={TrendingUp}
                      />
                      <InfoCard label="Reviews" value={`${formatRating(pkg.rating)} (${pkg.numReviews || 0})`} icon={Star} />
                    </div>
                    {pkg.description && (
                      <div className="rounded-lg border border-border bg-muted/30 p-4">
                        <h4 className="mb-2 text-sm font-semibold text-foreground">Description</h4>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{pkg.description}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {pkg.inclusions && pkg.inclusions.length > 0 && (
                        <div className="rounded-lg border border-success/10 bg-success/5 p-5">
                          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-success"><Check className="h-4 w-4" />Inclusions</h4>
                          <ul className="space-y-2">
                            {pkg.inclusions.map((item: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span>{item}</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {pkg.exclusions && pkg.exclusions.length > 0 && (
                        <div className="rounded-lg border border-destructive/10 bg-destructive/5 p-5">
                          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-destructive"><XCircle className="h-4 w-4" />Exclusions</h4>
                          <ul className="space-y-2">
                            {pkg.exclusions.map((item: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-foreground"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{item}</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div aria-label="Package performance" className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
                      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-black">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                          <Star className="h-5 w-5 fill-black text-black" />
                        </div>
                        <div>
                          <p className="font-mono text-lg font-bold tabular-nums text-black">{formatRating(pkg.rating)}</p>
                          <p className="text-xs text-black">out of 5</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-black">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                          <BookOpen className="h-5 w-5 text-black" />
                        </div>
                        <div>
                          <p className="font-mono text-lg font-bold tabular-nums text-black">{pkg.numReviews || 0}</p>
                          <p className="text-xs text-black">reviews</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-black">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                          <Briefcase className="h-5 w-5 text-black" />
                        </div>
                        <div>
                          <p className="font-mono text-lg font-bold tabular-nums text-black">{pkg.bookings || 0}</p>
                          <p className="text-xs text-black">bookings</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </FormDialogSection>
              )}

              {activeSection === 'images' && (
                <FormDialogSection
                  id="images"
                  expanded
                  onToggle={() => {}}
                  icon={ImageIcon}
                  title="Package Images"
                  subtitle="Photos included with this package"
                >
                  {pkg.images && pkg.images.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {pkg.images.map((image: any, index: number) => {
                        const imageUrl = typeof image === 'string' ? image : image.url;
                        return (
                          <div key={index} className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                            <img src={imageUrl} alt={`Package Image ${index + 1}`} className="h-full w-full object-cover" />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No package images available</p>
                  )}
                </FormDialogSection>
              )}

              {activeSection === 'itinerary' && (
                <FormDialogSection
                  id="itinerary"
                  expanded
                  onToggle={() => {}}
                  icon={CalendarDays}
                  title="Day-wise Itinerary"
                  subtitle="Review each day of the package plan"
                >
            {Array.isArray(days) && days.length > 0 ? (
              <ItineraryDisplay days={days} />
            ) : isLoadingDetails ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-border p-8">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="mt-3 text-muted-foreground">Loading itinerary...</p>
              </div>
            ) : (
              <div className="bg-muted rounded-lg border border-dashed border-border p-8 text-center">
                <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No itinerary specified</p>
              </div>
            )}
                </FormDialogSection>
              )}

            </FormDialogBody>
          </div>
        </div>

        <FormDialogFooter className="mt-auto">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1 sm:flex-none sm:min-w-28">
            Close
          </Button>
        </FormDialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PackageDetailsModal;
