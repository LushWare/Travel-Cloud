import React from 'react';
import { MapPin, Plane, Hotel, Car, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../lib/currency';
import { fetchPackageById } from '../services/api/packages';

interface PackageCardProps {
  id: string;
  image: string;
  days: number;
  title: string;
  location: string;
  price: number;
}

const PackageCard: React.FC<PackageCardProps> = ({
  id,
  image,
  days,
  title,
  location,
  price,
}) => {
  const availableServices = [
    { label: 'Flights', icon: Plane },
    { label: 'Hotel', icon: Hotel },
    { label: 'Transfers', icon: Car },
  ];
  const prefetchDetails = () => {
    void fetchPackageById(id).catch(() => undefined);
  };

  return (
    <Link
      to={`/packages/${encodeURIComponent(id)}`}
      onMouseEnter={prefetchDetails}
      onFocus={prefetchDetails}
      className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow group flex flex-col cursor-pointer"
    >
      {/* Image Container */}
      <div className="relative h-48 sm:h-56 overflow-hidden">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {/* Days Badge */}
        <div className="absolute top-4 left-4 bg-[#164E3F]/80 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-full">
          {days > 0 ? `${days} Days` : 'Flexible'}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        <h3 className="text-lg font-serif text-slate-800 mb-1">{title}</h3>
        <div className="flex items-center gap-1 text-gray-500 mb-4">
          <MapPin className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{location}</span>
        </div>
        
        {/* Inclusions */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          {availableServices.map(({ label, icon: Icon }) => (
            <div key={label} className="flex items-center gap-1.5">
              <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 items-center justify-between border-t border-gray-100 pt-4">
          <div className="text-sm text-gray-500">
            From <span className="text-lg font-bold text-slate-800">{formatCurrency(price)}</span> /person
          </div>
          <button className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-emerald-700 hover:bg-emerald-50 hover:border-emerald-100 transition-colors group/btn">
            <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </Link>
  );
};

export default PackageCard;
