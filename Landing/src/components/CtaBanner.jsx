import React from 'react';
import { ArrowRight } from 'lucide-react';

export default function CtaBanner({ onOpenDemo }) {
  return (
    <section className="relative overflow-hidden bg-brand-forest">
      {/* Background Mountain Panorama with dark green tint matching reference */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2000&q=80"
          alt="Scenic green mountain landscape"
          className="w-full h-full object-cover object-center opacity-30 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-brand-forestDark via-brand-forest/95 to-brand-forest/85" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 sm:px-8 py-14 sm:py-16">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          {/* Left Text */}
          <div className="space-y-2 max-w-2xl">
            <span className="text-[11px] sm:text-xs font-bold tracking-[0.18em] uppercase text-emerald-300">
              READY TO TRANSFORM YOUR TRAVEL BUSINESS?
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Let&apos;s Build Better Travel Experiences Together.
            </h2>
            <p className="text-sm sm:text-base text-emerald-100/90 font-normal">
              Explore our travel solutions and management portal today.
            </p>
          </div>

          {/* Right Action Button */}
          <div className="flex-shrink-0">
            <button
              onClick={() => onOpenDemo('both')}
              className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-brand-forestDark/80 hover:bg-black/40 text-white text-sm font-semibold border border-emerald-400/60 hover:border-emerald-300 transition-all duration-200 shadow-lg active:scale-95"
            >
              <span>Get Started</span>
              <ArrowRight
                size={16}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
