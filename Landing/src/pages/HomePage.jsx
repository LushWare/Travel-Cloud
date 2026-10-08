import React from 'react';
import Hero from '../components/Hero';
import TravelSolutionsSection from '../components/TravelSolutionsSection';
import ManagementPortalSection from '../components/ManagementPortalSection';
import ManagementGallery from '../components/Gallery';
import MarqueeSection from '../components/MarqueeSection';
import CtaBanner from '../components/CtaBanner';

export default function HomePage({ onOpenDemo }) {
  return (
    <div className="bg-white">
      <div className="relative isolate">
        <div className="relative z-0 lg:sticky lg:top-0">
          <Hero onOpenDemo={onOpenDemo} />
        </div>
        <div className="relative z-10">
          <TravelSolutionsSection onOpenDemo={onOpenDemo} />
        </div>
      </div>
      <MarqueeSection />
      <ManagementPortalSection onOpenDemo={onOpenDemo} />
      <ManagementGallery />
      <CtaBanner onOpenDemo={onOpenDemo} />
    </div>
  );
}
