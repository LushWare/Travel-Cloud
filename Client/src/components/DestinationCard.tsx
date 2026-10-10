import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { formatCurrency } from '../lib/currency';

const formatDuration = (duration: string): string => {
  const dayNightRange = /^(\d+)D\/(\d+)N$/i.exec(duration);
  if (dayNightRange) return `${dayNightRange[1]} days · ${dayNightRange[2]} nights`;

  const dayRange = /^(\d+)-(\d+)D$/i.exec(duration);
  if (dayRange) return `${dayRange[1]}–${dayRange[2]} days`;

  const singleDays = /^(\d+)D$/i.exec(duration);
  if (singleDays) return `${singleDays[1]} ${Number(singleDays[1]) === 1 ? 'day' : 'days'}`;

  return duration || 'Flexible';
};

interface DestinationCardProps {
  image: string;
  slug: string;
  location: string;
  title: string;
  description: string;
  duration: string;
  packagesCount: number;
  startingPrice: number;
}

const DestinationCard: React.FC<DestinationCardProps> = ({
  image,
  slug,
  location,
  title,
  description,
  duration,
  packagesCount,
  startingPrice,
}) => {
  return (
    <Link
      to={`/packages?destination=${encodeURIComponent(slug)}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg hover:shadow-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
    >
      {/* Image Container */}
      <div className="relative h-40 shrink-0 overflow-hidden sm:h-44">
        <img
          src={image}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-gradient-to-t from-slate-950/75 via-slate-950/35 to-transparent px-4 pb-3 pt-8 text-white">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-sm font-medium drop-shadow-sm">{location}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="mb-1.5 line-clamp-1 font-serif text-lg font-semibold text-slate-900 sm:text-xl">{title}</h3>
        <p className="mb-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">
          {description}
        </p>
        <div className="mb-3 grid min-h-[4.25rem] grid-cols-2 items-center rounded-xl bg-slate-50/80 px-2 py-2">
          <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-center">
            <span className="text-sm font-semibold leading-5 text-slate-800 sm:text-base">
              {formatDuration(duration)}
            </span>
            <span className="text-xs leading-4 text-slate-500">Duration</span>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 border-l border-slate-200 px-1 text-center">
            {packagesCount > 0 ? (
              <>
                <span className="text-sm font-semibold leading-5 text-slate-800 sm:text-base">
                  {packagesCount}
                </span>
                <span className="text-xs leading-4 text-slate-500">
                  {packagesCount === 1 ? 'Package' : 'Packages'}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold leading-5 text-slate-500">—</span>
                <span className="text-xs leading-4 text-slate-500">No packages yet</span>
              </>
            )}
          </div>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-0.5">
          {packagesCount > 0 && startingPrice > 0 && (
            <div className="min-w-0">
              <p className="text-xs leading-4 text-slate-500">Starting from</p>
              <p className="truncate text-xl font-bold leading-7 text-emerald-800">{formatCurrency(startingPrice)}</p>
            </div>
          )}
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 py-2 text-base font-semibold text-emerald-800 transition-colors group-hover:text-emerald-600">
            View Details
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
};

export default DestinationCard;
