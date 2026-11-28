import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FALLBACK_IMAGE } from '@/config/media';
import { cn } from '@/lib/utils';

export interface PackageCardProps {
  /**
   * Required. Link target for the whole card — every current call site links
   * to `/package/${id}`.
   */
  href: string;
  /**
   * Required. Resolved cover URL (the caller picks its own source order, e.g.
   * `image_url || images[0]`). An empty/missing URL — and any URL that fails
   * to load — renders `fallbackImage` when supplied, otherwise the site-wide
   * `FALLBACK_IMAGE`.
   */
  image?: string;
  /**
   * Optional. Used when `image` is missing or fails to load — package surfaces
   * pass `categoryImage(pkg.category)`. Defaults to the site-wide
   * `FALLBACK_IMAGE`.
   */
  fallbackImage?: string;
  /** Required. Card heading text; also used as the image's alt text. */
  title: string;
  /**
   * Required. Pre-formatted price string. Callers format their own data
   * (`formatCurrency(pkg.price_from)`), so this card stays currency-agnostic
   * and does not import formatting logic.
   */
  price: string;
  priceNote?: string;
  /**
   * Optional top-right floating overlay on the image. Context-specific
   * call-outs that sit in that corner: the gold "Featured" ribbon
   * (FeaturedPackages), the white "X ago" recency pill (RecentlyBookedSlider),
   * a future sold-out badge. Pass a fully styled node — the wrapper only
   * positions it.
   */
  badge?: ReactNode;
  /**
   * Optional bottom-left overlay on the image's gradient scrim (rendered in
   * white by the wrapper so it stays legible over photography). Context
   * content that belongs on the image itself: the duration chip with clock
   * icon (FeaturedPackages), the traveler avatar + name row
   * (RecentlyBookedSlider).
   */
  overlayMeta?: ReactNode;
  /**
   * Optional layer revealed over the image on hover (pointer devices only —
   * opacity transition driven by the card's `group` class, so it never blocks
   * touch). Used for FeaturedPackages' "What's Included" panel. Pass a fully
   * styled, `h-full` node; the wrapper only handles the reveal mechanics and
   * is painted last, so it covers the badge/overlayMeta while revealed.
   */
  hoverReveal?: ReactNode;
  /**
   * Optional secondary paragraph rendered under the title. Plain text with the
   * canonical card-description styling (2-line clamp, body-sm, muted).
   */
  description?: string;
  /**
   * Optional extra content rendered between the description and the footer —
   * the one open body extension point for per-surface rows that are neither
   * title nor footer: RecentlyBookedSlider's duration line, the package
   * listing's duration/rating stat row. The wrapper owns the vertical rhythm
   * (`mb-6`); pass content without outer margins.
   */
  meta?: ReactNode;
  /** Merged onto the root link for layout purposes (e.g. `h-full`, widths). */
  className?: string;
  /**
   * Merged onto the image wrapper. Used to change the image shape per surface
   * — FeaturedPackages and the default are `aspect-[4/5]`;
   * RecentlyBookedSlider passes `aspect-[4/3]`.
   */
  imageClassName?: string;
}

/**
 * Shared package card — the single documented extension point for package
 * surfaces across the Client (Phase 3 of docs/CLIENT-REWAMP-PLAN.md).
 *
 * Canonical composition, converged from the three hand-rolled copies that
 * preceded it (FeaturedPackages, RecentlyBookedSlider, packages listing):
 * a full-card `Link` with a hairline-bordered white card body
 * (border/elevation per DESIGN.md), a 4:5 image with a bottom gradient scrim
 * and hover zoom, the title, then a footer of price + "View Details" CTA
 * (the funnel's narrowing action) pinned to the card bottom. Headings stay
 * Fraunces via the global `h1`-`h6` rule; gold is only ever a highlight
 * (the Featured ribbon), never a CTA.
 *
 * Base contract: `href`, `image`, `title`, `price`. Everything context-
 * specific goes through the documented slots — `badge`, `overlayMeta`,
 * `hoverReveal`, `description`, `meta` — never through new per-surface
 * conditionals inside this file. Slot names describe where they render and
 * what they are for, so a future surface (e.g. the packages listing page's
 * sold-out badge, or its rating row) maps onto existing slots instead of
 * adding props.
 *
 * Call-site map:
 * - FeaturedPackages: badge = gold "Featured" ribbon; overlayMeta = duration
 *   chip; hoverReveal = inclusions panel; description = package description.
 * - RecentlyBookedSlider: badge = "X ago" pill; overlayMeta = traveler row;
 *   meta = formatted-duration line.
 * - Packages listing (next wave): description = description; meta = the
 *   duration/rating stat row; a sold-out state would ride the `badge` slot.
 */
export default function PackageCard({
  href,
  image,
  fallbackImage,
  title,
  price,
  priceNote,
  badge,
  overlayMeta,
  hoverReveal,
  description,
  meta,
  className,
  imageClassName,
}: PackageCardProps) {
  const fallbackSrc = fallbackImage || FALLBACK_IMAGE;
  const imageSrc = image || fallbackSrc;

  return (
    <Link
      to={href}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white transition-colors duration-300 group-hover:border-gray-300',
        className,
      )}
    >
      <div
        className={cn(
          'relative aspect-[4/5] shrink-0 overflow-hidden bg-gray-100',
          imageClassName,
        )}
      >
        <picture>
          <source
            srcSet={imageSrc.replace(/\.(jpg|jpeg|png)$/i, '.webp')}
            type="image/webp"
          />
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = fallbackSrc;
            }}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        </picture>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent"
        />
        {overlayMeta ? (
          <div className="absolute bottom-4 left-5 flex items-center gap-2 text-white">
            {overlayMeta}
          </div>
        ) : null}
        {badge ? <div className="absolute right-4 top-4">{badge}</div> : null}
        {hoverReveal ? (
          <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {hoverReveal}
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <h3 className="mb-3 line-clamp-2 text-xl font-bold text-gray-900 transition-colors duration-300 group-hover:text-brand-600">
          {title}
        </h3>
        {description ? (
          <p className="mb-6 line-clamp-2 text-sm leading-relaxed text-gray-600">{description}</p>
        ) : null}
        {meta ? <div className="mb-6">{meta}</div> : null}
        <div className="mt-auto flex items-center justify-between border-t border-gray-200 pt-4">
          <span className="flex flex-col">
            <span className="font-display text-xl font-bold text-brand-600">{price}</span>
            {priceNote ? <span className="text-xs text-gray-500">{priceNote}</span> : null}
          </span>
          <span className="inline-flex items-center rounded-xl bg-brand-800 px-4 py-2 text-sm font-semibold text-white transition-colors duration-300 group-hover:bg-brand-900">
            View Details
          </span>
        </div>
      </div>
    </Link>
  );
}
