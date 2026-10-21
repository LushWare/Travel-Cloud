import React from 'react';
import Hero from '../components/Hero';
import TravelSolutionsSection from '../components/TravelSolutionsSection';
import ManagementPortalSection from '../components/ManagementPortalSection';
import ManagementGallery from '../components/Gallery';
import MarqueeSection from '../components/MarqueeSection';
import CtaBanner from '../components/CtaBanner';

export default function HomePage({ onBookConsultation }) {
  return (
    <div className="bg-white">
      <div className="relative isolate">
        <div className="relative z-0 lg:sticky lg:top-0">
          <Hero />
        </div>
        <div className="relative z-10">
          <TravelSolutionsSection />
        </div>
      </div>
      <MarqueeSection />
      <ManagementPortalSection />
      <ManagementGallery />
      <CtaBanner onBookConsultation={onBookConsultation} />
    </div>
  );
}
