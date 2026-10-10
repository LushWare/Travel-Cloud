/**
 * Destination Selector Component
 * User-friendly destination picker with popular and categorized destinations
 * Styled to match the PlanYourTrip form theme (orange/yellow gradient)
 */

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Search, MapPin, Globe, ChevronDown } from 'lucide-react';
import {
  POPULAR_INTERNATIONAL,
  OTHER_INTERNATIONAL,
} from '../../config/domainData/destinations';

interface DestinationOption {
  value: string;
  label: string;
}

interface DestinationSelectorProps {
  /** Currently selected destination — an option object or a bare label string. */
  value?: DestinationOption | string | null;
  /** Called with the selected destination option when the user picks one. */
  onChange: (destination: DestinationOption) => void;
  placeholder?: string;
}

const DestinationSelector = ({ value, onChange, placeholder = 'Select Destination' }: DestinationSelectorProps) => {
  // `value` may be either a {value,label} option object (the shape
  // DestinationSelector emits) or a bare label string; project both
  // interpretations explicitly so the highlight/display logic stays faithful
  // to the original untyped behavior.
  const isOptionValue = typeof value === 'object' && value !== null;
  const selectedOptionValue = isOptionValue ? value.value : undefined;
  const selectedOptionLabel = isOptionValue ? value.label : undefined;

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('popular-international');
  const [customDestination, setCustomDestination] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Filter destinations based on search
  const getFilteredDestinations = (destinations: DestinationOption[]): DestinationOption[] => {
    if (!searchTerm) return destinations;
    return destinations.filter((dest) => dest.label.toLowerCase().includes(searchTerm.toLowerCase()));
  };

  const handleSelect = (destination: DestinationOption) => {
    onChange(destination);
    setIsOpen(false);
    setSearchTerm('');
    setCustomDestination('');
  };

  const handleCustomDestinationSubmit = () => {
    const customValue = customDestination.trim();
    if (customValue) {
      handleSelect({ value: customValue, label: customValue });
      setCustomDestination('');
    }
  };

  const handleCustomDestinationKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCustomDestinationSubmit();
    }
  };

  const renderDestinationGrid = (destinations: DestinationOption[]) => {
    const filtered = getFilteredDestinations(destinations);

    if (filtered.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500 text-sm">
          {searchTerm ? (
            <>
              <p>No destinations match "{searchTerm}".</p>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="mt-2 text-brand-600 hover:text-brand-700 font-semibold underline underline-offset-2"
              >
                Clear search
              </button>
            </>
          ) : (
            'No destinations found'
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-2">
        {filtered.map((dest) => (
          <button
            key={dest.value}
            type="button"
            onClick={() => handleSelect(dest)}
            className={`px-3 py-2 text-sm text-left rounded-xl transition-all ${selectedOptionValue === dest.value || selectedOptionLabel === dest.label
                ? 'bg-brand-600 text-white font-semibold shadow-md'
                : 'bg-gray-50 hover:bg-brand-50 text-gray-700 hover:text-brand-700 border border-gray-200 hover:border-brand-300'
              }`}
          >
            {dest.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected Value Display / Trigger */}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="destination-selector-panel"
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-12 w-full items-center justify-between rounded-xl border border-gray-300 bg-white px-4 py-3 text-left transition-colors hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className="flex flex-1 items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-600 flex-shrink-0" aria-hidden="true" />
          <span className={value ? 'text-gray-900 font-medium' : 'text-gray-400'}>
            {selectedOptionLabel || (typeof value === 'string' ? value : '') || placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'transform rotate-180' : ''
            }`}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div id="destination-selector-panel" className="absolute z-dropdown w-[calc(100vw-1rem)] sm:w-full sm:min-w-[520px] max-w-[600px] mt-2 bg-white border-2 border-brand-200 rounded-2xl shadow-2xl overflow-hidden left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0">
          {/* Search Bar */}
          <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-brand-50 to-brand-accent-50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-brand-600" size={18} />
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search destinations..."
                className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
                autoFocus
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setActiveTab('popular-international')}
              className={`flex-1 px-4 py-3 text-xs font-semibold transition-all flex items-center justify-center gap-2 ${activeTab === 'popular-international'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50'
                  : 'text-gray-600 hover:text-brand-600 hover:bg-gray-50'
                }`}
            >
              <Globe size={14} />
              Popular Destinations
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('other-international')}
              className={`flex-1 px-4 py-3 text-xs font-semibold transition-all flex items-center justify-center gap-2 ${activeTab === 'other-international'
                  ? 'text-brand-600 border-b-2 border-brand-600 bg-brand-50'
                  : 'text-gray-600 hover:text-brand-600 hover:bg-gray-50'
                }`}
            >
              <MapPin size={14} />
              More Destinations
            </button>
          </div>

          {/* Content based on active tab */}
          <div className="p-3 bg-gray-50">
            {activeTab === 'popular-international' && (
              <div>
                <div className="px-2 py-2 text-xs font-semibold text-gray-700 flex items-center gap-2 mb-2">
                  <Globe size={12} className="text-brand-600" />
                  Popular International Destinations
                </div>
                {renderDestinationGrid(POPULAR_INTERNATIONAL)}
              </div>
            )}

            {activeTab === 'other-international' && (
              <div>
                <div className="px-2 py-2 text-xs font-semibold text-gray-700 flex items-center gap-2 bg-white rounded-lg mb-2">
                  <Globe size={12} className="text-brand-600" />
                  More International Destinations
                </div>
                {renderDestinationGrid(OTHER_INTERNATIONAL)}
              </div>
            )}
          </div>

          {/* Custom Input Option */}
          <div className="p-4 border-t border-gray-200 bg-gradient-to-r from-brand-50 to-brand-accent-50">
            <div className="text-sm text-gray-700 font-medium mb-2 flex items-center gap-2">
              <MapPin size={14} className="text-brand-600" />
              Don't see your destination?
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customDestination}
                onChange={(e) => setCustomDestination(e.target.value)}
                onKeyPress={handleCustomDestinationKeyPress}
                placeholder="Type custom destination..."
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm bg-white"
              />
              <button
                type="button"
                onClick={handleCustomDestinationSubmit}
                disabled={!customDestination.trim()}
                className="px-4 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setCustomDestination('');
                }}
                className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300 transition-colors text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DestinationSelector;
