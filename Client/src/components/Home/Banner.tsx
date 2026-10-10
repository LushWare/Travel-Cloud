import React from 'react';
import { ArrowRight } from 'lucide-react';

const LuxuryBanner = () => {
  return (
    <section className="relative flex h-[480px] w-full items-center">
      <div 
        className="absolute inset-0 bg-fixed bg-cover bg-center"
        style={{ backgroundImage: "url('/4.png')" }}
      />
      
      <div className="absolute inset-0 bg-gradient-to-r from-[#0A2D38]/90 via-[#173e4b]/20 to-transparent" />
      <div className="relative z-10 px-6 md:px-12 max-w-7xl mx-auto flex justify-between items-center w-full">
        <div className="max-w-xl text-white">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4 text-white/90">
            Tailor-Made Journeys
          </p>
          <h2 className="mb-4 font-serif text-4xl leading-tight sm:text-5xl lg:text-6xl">
            Luxury Travel Experiences
          </h2>
          <p className="text-white/90 text-lg mb-8 max-w-[400px] font-light">
            From private tours to exclusive stays, we craft journeys that match your dreams.
          </p>
          <button className="bg-[#16a34a] hover:bg-[#15803d] border border-white/10 shadow-lg text-white px-6 py-3 rounded-full font-medium flex items-center gap-2 transition-colors">
            Explore Packages <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default LuxuryBanner;
