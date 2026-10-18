import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass,
  CalendarDays,
  Sparkles,
  Headphones,
  Smartphone,
  ArrowRight
} from 'lucide-react';

const showcaseImages = [
  { src: '/5.png', alt: 'LushTravelCloud booking website displayed on a laptop' },
  { src: '/1.png', alt: 'LushTravelCloud booking website displayed on a laptop and phone' },
  { src: '/2.png', alt: 'LushTravelCloud booking website displayed on a phone' },
];

export default function TravelSolutionsSection({ onOpenDemo }) {
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveImage((currentImage) => (currentImage + 1) % showcaseImages.length);
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, []);

  const features = [
    {
      icon: CalendarDays,
      title: 'Easy Booking & Itineraries',
      desc: 'Flights, hotels, tours and more - all in one place.',
    },
    {
      icon: Sparkles,
      title: 'Personalized Experiences',
      desc: 'Tailored recommendations for every traveler.',
    },
    {
      icon: Headphones,
      title: 'Real-Time Support',
      desc: 'Travel with confidence, always.',
    },
    {
      icon: Smartphone,
      title: 'Mobile Friendly',
      desc: 'Plan and manage trips on the go.',
    },
  ];

  return (
    <section id="travel-solutions" className="py-20 md:py-28 bg-white relative overflow-hidden">
      <svg
        data-testid="travel-solutions-top-curve"
        className="pointer-events-none absolute top-0 left-0 z-20 h-10 w-full"
        viewBox="0 0 1440 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 34C260 34 390 4 720 4S1180 34 1440 34"
          fill="none"
          stroke="#164E3F"
          strokeWidth="4"
        />
        <path
          d="M0 39C260 39 390 10 720 10S1180 39 1440 39"
          fill="none"
          stroke="#10B981"
          strokeOpacity="0.75"
          strokeWidth="2"
        />
      </svg>
      <div className="max-w-7xl mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
          
          {/* Left Text & Features Column */}
          <div className="lg:col-span-6 xl:col-span-5 space-y-6">
            {/* Section Tag */}
            <div className="inline-flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-brand-mint text-brand-forest flex items-center justify-center">
                <Compass size={13} />
              </span>
              <span className="text-[12px] font-bold tracking-[0.15em] uppercase text-brand-forest">
                TRAVEL SOLUTIONS
              </span>
            </div>

            {/* Title & Subtitle */}
            <div>
              <h2 className="text-3xl sm:text-4xl lg:text-[44px] font-extrabold text-slate-900 tracking-tight leading-tight">
                For Your Travelers
              </h2>
              <p className="text-xl sm:text-2xl font-bold text-brand-forest mt-1">
                Inspire. Plan. Explore.
              </p>
            </div>

            {/* Description */}
            <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
              Our client-facing travel solution helps tourism companies deliver seamless,
              personalized and memorable travel experiences — from discovery to return.
            </p>

            {/* Feature List */}
            <div className="space-y-4 pt-2">
              {features.map((item, index) => {
                const IconComponent = item.icon;
                return (
                  <div key={index} className="flex items-start gap-3.5 group">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-forest/90 text-white flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-sm">
                      <IconComponent size={17} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* CTA Button */}
            <div className="pt-4">
              <Link
                to="/travel-solutions"
                className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-brand-forest hover:bg-brand-forestDark text-white text-sm font-semibold transition-all duration-200 shadow-glow active:scale-95"
              >
                <span>See Travel Solutions in Action</span>
                <ArrowRight
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </Link>
            </div>
          </div>

          {/* Product image showcase */}
          <div className="lg:col-span-6 xl:col-span-7">
            <div className="mx-auto max-w-[840px]">
              <div className="flex aspect-[4/3] items-center justify-center">
                <img
                  key={showcaseImages[activeImage].src}
                  data-testid="travel-showcase-image"
                  src={showcaseImages[activeImage].src}
                  alt={showcaseImages[activeImage].alt}
                  className="travel-showcase-image h-full w-full object-contain"
                  loading="eager"
                />
              </div>
              <div
                className="mt-3 flex items-center justify-center gap-2"
                role="group"
                aria-label="Choose product image"
              >
                {showcaseImages.map((image, index) => (
                  <button
                    key={image.src}
                    type="button"
                    aria-label={`Show image ${index + 1}: ${image.alt}`}
                    aria-current={activeImage === index ? 'true' : undefined}
                    onClick={() => setActiveImage(index)}
                    className={`h-2.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2 ${
                      activeImage === index
                        ? 'w-8 bg-brand-forest shadow-sm shadow-emerald-900/30'
                        : 'w-2.5 bg-emerald-200 hover:bg-emerald-400'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
