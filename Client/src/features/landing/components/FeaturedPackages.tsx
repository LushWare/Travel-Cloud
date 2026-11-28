import { Link, useNavigate } from 'react-router-dom';
import { Clock, ArrowRight, Compass } from 'lucide-react';
import { formatCurrency } from '../../../lib/currency';
import { pluralize } from '../../../lib/pluralize';
import { categoryImage } from '../../../config/media';
import type { NormalizedPackage } from '../../../services/api/packages.transform';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import PackageCard from '../../../components/shared/PackageCard';
import { PRICE_BASIS_SHORT } from '../../../utils/priceBasis';

interface FeaturedPackagesProps {
  packages: NormalizedPackage[];
}

export default function FeaturedPackages({ packages }: FeaturedPackagesProps) {
  const navigate = useNavigate();
    const latestPackages = packages
    .slice()
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .slice(0, 3);

  const featuredPackages = latestPackages.length > 0 ? latestPackages : packages.slice(0, 3);

  return (
    <section className="bg-gray-50 py-section-md font-body">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="mb-4 font-display text-3xl font-bold text-gray-900 md:text-4xl">
           Featured Packages You’ll Love
          </h2>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-gray-600">
            Unique itineraries, top deals, and traveller favourite getaways - all in one place.
          </p>
        </div>
        {featuredPackages.length === 0 ? (
          <div className="mx-auto max-w-2xl rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-14 text-center sm:px-12">
            <Compass className="mx-auto mb-5 size-10 text-gray-300" />
            <h3 className="font-display text-2xl font-semibold text-gray-900">
              New getaways are on the way
            </h3>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-gray-600">
              No packages available yet. Please check back soon — or head to the
              full catalogue and plan your own journey.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/packages"
                className={cn(
                  buttonVariants({ variant: 'default', size: 'lg' }),
                  'h-12 w-full rounded-xl bg-brand-600 px-8 font-semibold text-white transition-colors duration-300 hover:bg-brand-700 sm:w-auto'
                )}
              >
                Browse All Packages
              </Link>
              <Link
                to="/planner"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'h-12 w-full rounded-xl border-2 border-gray-900 bg-transparent px-8 font-semibold text-gray-900 transition-colors duration-300 hover:border-brand-600 hover:bg-white hover:text-brand-700 sm:w-auto'
                )}
              >
                Plan Your Own Trip
              </Link>
            </div>
          </div>
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-6 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
            {featuredPackages.map((pkg) => (
              <div
                key={pkg.id}
                className="w-[80%] shrink-0 snap-start sm:w-[55%] md:w-auto"
              >
                <PackageCard
                  href={`/package/${pkg.id}`}
                  image={pkg.image_url || pkg.images?.[0]}
                  fallbackImage={categoryImage(pkg.category)}
                  title={pkg.name}
                  price={formatCurrency(pkg.price_from)}
                  priceNote={PRICE_BASIS_SHORT}
                  description={pkg.description}
                  badge={
                    <Badge className="h-auto rounded-full border-0 bg-brand-accent-500/95 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-accent-950">
                      Featured
                    </Badge>
                  }
                  overlayMeta={
                    <>
                      <Clock className="size-4 text-brand-accent-300" />
                      <span className="text-sm font-medium">{pluralize(pkg.duration_days, 'Day')}</span>
                    </>
                  }
                  hoverReveal={
                    <div className="flex h-full flex-col justify-end bg-brand-dark-950/85 p-6">
                      <h4 className="mb-3 text-base font-bold text-brand-accent-300">
                        What's Included:
                      </h4>
                      <ul className="space-y-2 text-sm text-white">
                        {pkg.inclusions && pkg.inclusions.slice(0, 5).map((inclusion, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-brand-accent-300">✓</span>
                            <span className="line-clamp-1">{inclusion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-12 text-center">
        <Button
          variant="outline"
          size="lg"
          onClick={() => navigate('/packages')}
          className="h-12 w-full rounded-xl border-2 border-gray-900 bg-transparent px-10 font-semibold text-gray-900 transition-colors duration-300 hover:border-brand-600 hover:bg-white hover:text-brand-700 focus-visible:border-brand-600 focus-visible:ring-brand-600/40 sm:w-auto"
        >
          Explore All Packages
          <ArrowRight className="size-5" />
        </Button>
      </div>
    </section>
  );
}
