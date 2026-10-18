import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers,
  ArrowRight,
  Users,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';

const showcaseImages = [
  { src: '/6.png', alt: 'LushWare management portal displayed on a laptop' },
  { src: '/3.png', alt: 'LushWare management portal displayed on a phone' },
  { src: '/4.png', alt: 'LushWare management portal displayed on a laptop and phone' },
];

const businessFeatures = [
  {
    icon: Layers,
    title: 'Centralized Booking Management',
    desc: 'View, modify and track all bookings in real time.',
  },
  {
    icon: Users,
    title: 'Customer Management',
    desc: 'Keep your client information organized and accessible.',
  },
  {
    icon: BarChart3,
    title: 'Reports & Analytics',
    desc: 'Make smarter decisions with real-time data.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure & Reliable',
    desc: 'Your data is always protected.',
  },
];

export default function ManagementPortalSection() {
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveImage((currentImage) => (currentImage + 1) % showcaseImages.length);
    }, 3500);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section
      id="management-portal"
      className="py-20 md:py-28 relative overflow-hidden border-y border-slate-100/80"
    >
      <div
        className="absolute top-1/3 left-0 w-96 h-96 bg-brand-mint/30 rounded-full blur-3xl pointer-events-none -z-10"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-12 items-center">
          {/* Product image showcase */}
          <div className="lg:col-span-6 xl:col-span-7 order-2 lg:order-1">
            <div className="mx-auto max-w-[840px]">
              <div className="flex aspect-[4/3] items-center justify-center">
                <img
                  key={showcaseImages[activeImage].src}
                  data-testid="management-showcase-image"
                  src={showcaseImages[activeImage].src}
                  alt={showcaseImages[activeImage].alt}
                  className="travel-showcase-image h-full w-full object-contain"
                  loading="eager"
                />
              </div>
              <div
                className="mt-3 flex items-center justify-center gap-2"
                role="group"
                aria-label="Choose management portal image"
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

          {/* Right Column: Text & Features Content */}
          <div className="lg:col-span-6 xl:col-span-5 order-1 lg:order-2 space-y-6">
            <div className="inline-flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-brand-mint text-brand-forest flex items-center justify-center">
                <Layers size={13} />
              </span>
              <span className="text-[12px] font-bold tracking-[0.15em] uppercase text-brand-forest">
                MANAGEMENT PORTAL
              </span>
            </div>

            <div>
              <h2 className="text-3xl sm:text-4xl lg:text-[44px] font-extrabold text-slate-900 tracking-tight leading-tight">
                For Your Business
              </h2>
              <p className="text-xl sm:text-2xl font-bold text-brand-forest mt-1">
                Control. Visibility. Efficiency.
              </p>
            </div>

            <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
              Our powerful management portal gives your team the insights and tools they need
              to operate smoothly, serve clients better and grow your business.
            </p>

            <div className="space-y-4 pt-2">
              {businessFeatures.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div key={item.title} className="flex items-start gap-3.5 group">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand-forest text-white flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-sm">
                      <IconComponent size={17} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4">
              <Link
                to="/management-portal"
                className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-brand-forest hover:bg-brand-forestDark text-white text-sm font-semibold transition-all duration-200 shadow-glow active:scale-95"
              >
                <span>Explore Management Portal</span>
                <ArrowRight
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
