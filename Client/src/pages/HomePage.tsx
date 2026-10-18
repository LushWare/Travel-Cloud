import React from 'react';
import HeroSection from '../components/Home/Hero';
import PopularDestinations from '../components/Home/Destinations';
import LuxuryBanner from '../components/Home/Banner';
import Experiences from '../components/Home/Experiences';
import PopularPackages from '../components/Home/Packages';
import Testimonials from '../components/Home/Testimonials';

const HomePage = () => {
  return (
    <div className="min-h-screen bg-[#F8FAF8] font-sans text-slate-800">
      <HeroSection />
      <main className="relative z-10">
        <PopularDestinations />
        <Experiences />
        <PopularPackages />
        <LuxuryBanner />
        <Testimonials />
      </main>
    </div>
  );
};

export default HomePage;
