import { Link, useNavigate } from 'react-router-dom';
import { Clock, ArrowRight } from 'lucide-react';
import { formatCurrency } from '../../../lib/currency';
import type { EnrichedPackage } from '../PackagesContainer';
import { categoryImage } from '../../../config/media';
import { PRICE_BASIS_SHORT } from '../../../utils/priceBasis';

interface PackageListItemProps {
  pkg: EnrichedPackage;
}

export default function PackageListItem({ pkg }: PackageListItemProps) {
  const navigate = useNavigate();
  const imageSrc = pkg.images?.[0] || pkg.image_url || categoryImage(pkg.category);

  return (
    <div
      onClick={() => navigate(`/package/${pkg.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/package/${pkg.id}`); }}
      role="button"
      tabIndex={0}
      className="group bg-white rounded-2xl overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors duration-300 cursor-pointer"
    >
      <div className="flex flex-col lg:flex-row">
        <div className="relative lg:w-80 h-64 lg:h-80 overflow-hidden flex-shrink-0">
          <picture>
            <source srcSet={imageSrc.replace(/\.(jpg|jpeg|png)$/i, '.webp')} type="image/webp" />
            <img
              src={imageSrc}
              alt={pkg.title}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.src = categoryImage(pkg.category);
              }}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </picture>
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
        </div>
        <div className="flex-1 p-4 lg:p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2 group-hover:text-brand-600 transition-colors">
                {pkg.title}
              </h3>
            </div>
          </div>
          <p className="text-gray-600 mb-5 line-clamp-2">{pkg.description}</p>
          <div className="flex flex-wrap gap-6 text-sm text-gray-600 mb-6">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4" />
              <span>{pkg.durationLabel}</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              <p className="text-xs text-gray-500 mb-1">Starting Price</p>
              <p className="text-3xl font-bold text-brand-600">{formatCurrency(pkg.price_from)}</p>
              <p className="text-xs text-gray-500">{PRICE_BASIS_SHORT}</p>
            </div>
            <Link
              to={`/package/${pkg.id}`}
              onClick={(e) => e.stopPropagation()}
              className="px-8 py-3 bg-brand-800 text-white rounded-xl font-semibold hover:bg-brand-900 transition-colors flex items-center space-x-2"
            >
              <span>View Package</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
