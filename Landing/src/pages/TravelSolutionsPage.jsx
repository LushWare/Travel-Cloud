import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPinned,
  Send,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import PORTALS from '../config/portals';
import ProductPageHero from '../components/ProductPageHero';

const websiteFeatures = [
  {
    icon: SlidersHorizontal,
    title: 'Showcase trips under your brand',
    description: 'Give your agency a polished online storefront for destinations and packages.',
  },
  {
    icon: MapPinned,
    title: 'Make comparing trips easy',
    description: 'Customers can filter packages and review itineraries, inclusions, prices, and reviews.',
  },
  {
    icon: Send,
    title: 'Turn visits into qualified inquiries',
    description: 'Travelers can send booking or customization requests directly through your website.',
  },
  {
    icon: CalendarDays,
    title: 'Keep clients connected',
    description: 'Signed-in customers can revisit their bookings and trip plans in one place.',
  },
  {
    icon: ClipboardList,
    title: 'Make every inquiry count',
    description: 'Customers arrive informed, so your team can focus on personal travel advice.',
  },
];

const mobileBenefits = [
  'Make it easy to browse destinations and packages on a phone.',
  'Let travelers check trip details wherever they are.',
  'Keep your agency brand with clients on the go.',
];

export default function TravelSolutionsPage({ onOpenDemo }) {
  const websiteVisualRef = useRef(null);
  const mobileVisualRef = useRef(null);
  const [websiteVisualVisible, setWebsiteVisualVisible] = useState(false);
  const [mobileVisualVisible, setMobileVisualVisible] = useState(false);

  useEffect(() => {
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const isVisible = entry.isIntersecting;
          if (entry.target === websiteVisualRef.current) {
            setWebsiteVisualVisible(isVisible);
          } else if (entry.target === mobileVisualRef.current) {
            setMobileVisualVisible(isVisible);
          }
        });
      },
      { threshold: 0.2 },
    );

    if (websiteVisualRef.current) visibilityObserver.observe(websiteVisualRef.current);
    if (mobileVisualRef.current) visibilityObserver.observe(mobileVisualRef.current);

    return () => visibilityObserver.disconnect();
  }, []);

  return (
    <div className="bg-white pb-20">
      <ProductPageHero
        title="A World-Class Digital Experience for"
        highlight="Your Travelers"
        description="Give your clients an inspiring, beautifully branded portal and mobile companion. From initial proposal to the final flight home, elevate every moment of their journey."
        demoLabel="Request Traveler Portal Demo"
        demoProduct="client"
        sandboxLabel="Live Traveler Sandbox"
        sandboxUrl={PORTALS.client.url}
        imageSrc="/1.png"
        imageAlt="LushTravelCloud traveler portal and booking experience"
        curveStyle="wave"
        animateImage
        onOpenDemo={onOpenDemo}
      />

      <section className="relative overflow-hidden py-20 sm:py-24 lg:py-28">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 sm:px-8 lg:grid-cols-12 lg:gap-10">
          <div className="space-y-6 lg:col-span-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-forest">
              Why a website for your travel agency?
            </p>
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              Showcase trips. Build trust. Get better inquiries.
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-slate-600">
               Turn your website into your best travel storefront. 
               Showcase your travel business online, help customers choose with confidence, and bring
              your team better-informed booking inquiries all under your brand.
            </p>

            <div className="space-y-5 pt-2">
              {websiteFeatures.map((feature) => {
                const IconComponent = feature.icon;
                return (
                  <div key={feature.title} className="flex items-start gap-3.5">
                    <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-brand-forest">
                      <IconComponent size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{feature.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            ref={websiteVisualRef}
            className={`relative flex justify-center transition-all duration-700 ease-out motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none lg:col-span-6 lg:justify-end ${
              websiteVisualVisible ? 'translate-x-0 opacity-100' : 'translate-x-12 opacity-0'
            }`}
          >
            <div
              className="pointer-events-none absolute inset-10 rounded-full bg-emerald-100/70 blur-3xl"
              aria-hidden="true"
            />
            <img
              src="/1.png"
              alt="LushTravelCloud branded travel website displayed on a laptop"
              className="relative z-10 h-auto w-full max-w-[680px] object-contain"
              loading="lazy"
            />
            <img
              src="/5.png"
              alt="Responsive LushTravelCloud travel website displayed on laptop and phone"
              className="absolute -bottom-5 right-0 z-20 h-auto w-[44%] object-contain drop-shadow-xl sm:right-2"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-emerald-100/80 py-20 sm:py-24 lg:py-28">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-6 sm:px-8 lg:grid-cols-12 lg:gap-10">
          <div
            ref={mobileVisualRef}
            className={`relative flex justify-center transition-all duration-700 ease-out motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none lg:col-span-6 lg:justify-start ${
              mobileVisualVisible ? 'translate-x-0 opacity-100' : '-translate-x-12 opacity-0'
            }`}
          >
            <div
              className="pointer-events-none absolute inset-10 rounded-full bg-teal-100/75 blur-3xl"
              aria-hidden="true"
            />
            <img
              src="/2.png"
              alt="LushTravelCloud travel experience on a mobile phone"
              className="relative z-10 h-auto w-full max-w-[320px] object-contain sm:max-w-[400px]"
              loading="lazy"
            />
          </div>

          <div className="space-y-6 lg:col-span-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-forest">
              Why a mobile travel experience for your clients?
            </p>
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              Keep your agency in reach, wherever they go.
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-slate-600">
              A mobile-friendly experience makes trip discovery and planning more convenient for
              customers—and keeps your brand with them on the go.
            </p>

            <ul className="space-y-4 pt-1">
              {mobileBenefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700">
                  <CheckCircle2
                    size={18}
                    className="mt-0.5 flex-shrink-0 text-brand-forest"
                    aria-hidden="true"
                  />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-3 pt-2">
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white/80 px-3.5 py-2 text-xs font-semibold text-slate-700">
                <Smartphone size={15} className="text-brand-forest" aria-hidden="true" />
                Your brand, designed for mobile
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
