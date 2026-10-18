import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const heroSlides = [
  { src: '/1.png', alt: 'LushWare travel management dashboard on a laptop' },
  { src: '/2.png', alt: 'LushTravelCloud booking website on a laptop' },
  { src: '/3.png', alt: 'LushTravelCloud booking website on a phone' },
  { src: '/4.png', alt: 'LushWare management dashboard on a phone' },
];

export default function Hero({ onOpenDemo }) {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveSlide((currentSlide) => (currentSlide + 1) % heroSlides.length);
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className="relative pt-24 pb-12 md:pt-28 md:pb-16 bg-white">
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-emerald-50/60 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-10 w-[350px] h-[350px] bg-brand-mint/40 rounded-full blur-3xl pointer-events-none -z-10" />

      <div
        data-testid="hero-background"
        className="pointer-events-none absolute top-0 -bottom-4 right-0 z-0 hidden w-[62%] lg:block"
        aria-hidden="true"
      >
        <img src="/25.png" alt="" className="h-full w-full object-cover object-bottom" />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/60 to-transparent" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Text Column */}
          <div className="lg:col-span-6 xl:col-span-7 space-y-6 lg:max-w-[700px]">
            <div className="inline-flex items-center gap-2">
              <span className="text-[12px] md:text-[13px] font-bold tracking-[0.16em] uppercase text-brand-forest">
                FOR TRAVEL &amp; TOURISM COMPANIES
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[58px] leading-[1.12] font-extrabold tracking-tight">
              <span className="block text-slate-900">
                Two Powerful Solutions.
              </span>
              <span className="block text-brand-forest mt-1">
                One Seamless Platform.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-600 max-w-xl leading-relaxed">
              Empower your travelers with unforgettable experiences and give your team
              the tools to manage it all - from one trusted platform.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4">
              <Link
                to="/travel-solutions"
                className="group inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-md bg-brand-forest hover:bg-brand-forestDark text-white text-sm sm:text-[15px] font-semibold transition-all duration-200 shadow-glow active:scale-95"
              >
                <span>Explore Our Travel Solutions</span>
                <ArrowRight
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </Link>

              <Link
                to="/management-portal"
                className="inline-flex items-center justify-center px-7 py-3.5 rounded-md bg-white hover:bg-slate-50 text-slate-800 text-sm sm:text-[15px] font-semibold border border-slate-300 hover:border-slate-400 transition-all duration-200 active:scale-95"
              >
                Discover Management Portal
              </Link>
            </div>

            <div className="pt-6 flex flex-wrap items-center gap-6 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-vibrant" />
                <span>Zero Setup Fees</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-vibrant" />
                <span>Custom Brandable Portals</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-vibrant" />
                <span>Enterprise SLA</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 xl:col-span-5 flex justify-center lg:justify-end">
            <div
              className="relative z-10 flex aspect-square w-full max-w-[760px] items-center justify-center"
              role="group"
              aria-label="Product image slideshow"
            >
              <img
                key={heroSlides[activeSlide].src}
                src={heroSlides[activeSlide].src}
                alt={heroSlides[activeSlide].alt}
                className="hero-slide-image h-full w-full object-contain"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}
