import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  CheckCircle2,
  CreditCard,
  Hotel,
  Package,
  Plane,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

const portalFeatures = [
  {
    category: 'TRIP PLANNING',
    title: 'Build trips around every traveler',
    description:
      'Bring package details and day-by-day itinerary planning into one workspace, so your team can shape a trip around what each traveler wants to experience.',
    points: [
      'Organize destinations, trip details, and itinerary days together',
      'Keep package information ready for your team to review and refine',
      'Give agents one place to prepare trip plans for customers',
    ],
    image: '/images/packages.png',
    imageAlt: 'Management portal package list and trip package controls',
    path: '/packages',
    icon: Package,
  },
  {
    category: 'AI-ASSISTED PLANNING',
    title: 'Turn inspiration into a stronger itinerary',
    description:
      'Use the portal’s AI package tools and Copilot workspace to explore ideas and help shape travel plans. Your team stays in control of every recommendation and final detail.',
    points: [
      'Explore AI-assisted package insights from the package workspace',
      'Use Copilot alongside package details while planning',
      'Review and edit suggestions before they become part of a trip',
    ],
    image: '/images/recomendations.png',
    imageAlt: 'Package workspace with AI insights and Copilot panels',
    path: '/packages',
    icon: Sparkles,
  },
  {
    category: 'FLIGHT MANAGEMENT',
    title: 'Search flights and keep bookings in view',
    description:
      'Search flight options for a traveler’s route, then manage flight reservations from the same portal your team uses to coordinate the rest of the trip.',
    points: [
      'Search flights by route, dates, and traveler requirements',
      'Review flight options before moving forward with a booking',
      'Return to flight bookings from the management workspace',
    ],
    image: '/images/flights.png',
    imageAlt: 'Flight search and booking workspace in the management portal',
    path: '/flights',
    icon: Plane,
  },
  {
    category: 'HOTEL MANAGEMENT',
    title: 'Find stays that fit the itinerary',
    description:
      'Search hotel options by destination and dates, and keep accommodation planning connected to the trip your agency is putting together.',
    points: [
      'Search stays using destination, check-in, and check-out dates',
      'Set guest counts to match the traveler’s plans',
      'Access hotel bookings alongside other trip operations',
    ],
    image: '/images/hotels.png',
    imageAlt: 'Hotel search and booking workspace in the management portal',
    path: '/hotels',
    icon: Hotel,
  },
  {
    category: 'QUOTATIONS & BILLING',
    title: 'Keep trip documents and payments organized',
    description:
      'Prepare customer-facing quotations and manage billing documents in one place, helping your team follow a trip from proposal through payment.',
    points: [
      'Manage quotations, invoices, receipts, and vouchers',
      'See document and payment status from the billing workspace',
      'Keep billing activity connected to customer and trip records',
    ],
    image: '/images/billings.png',
    imageAlt: 'Billing workspace with quotations, invoices, receipts, and vouchers',
    path: '/billing',
    icon: CreditCard,
  },
  {
    category: 'AGENCY ANALYTICS',
    title: 'See how your pipeline is moving',
    description:
      'Review lead and billing analytics to understand what is happening across your agency, and give your team a clearer view of the work that needs attention.',
    points: [
      'Review lead stages and conversion performance',
      'Explore billing and other available analytics reports',
      'Use a shared view of activity to guide team follow-up',
    ],
    image: '/images/analytics.png',
    imageAlt: 'Management portal analytics dashboard with lead performance reports',
    path: '/analytics',
    icon: BarChart3,
  },
  {
    category: 'TEAM & ACCESS',
    title: 'Give every role the right workspace',
    description:
      'Manage the people who help run your agency, with portal access organized for administrators, sales representatives, vendors, and customers.',
    points: [
      'Manage administrator and sales-representative accounts',
      'Organize vendor and customer users',
      'Keep team access managed from the user administration area',
    ],
    image: '/images/users.png',
    imageAlt: 'User management workspace with admin, sales, vendor, and customer categories',
    path: '/users',
    icon: ShieldCheck,
  },
  {
    category: 'HIRING',
    title: 'Keep recruitment moving alongside operations',
    description:
      'Manage vacancies and applications from the portal, making it easier to keep hiring activity visible as your travel business grows.',
    points: [
      'Review incoming candidate applications',
      'Track application progress through hiring stages',
      'Manage vacancies from the career workspace',
    ],
    image: '/images/career.png',
    imageAlt: 'Career management workspace showing candidate applications and statuses',
    path: '/career',
    icon: Briefcase,
  },
  {
    category: 'AGENCY BRANDING',
    title: 'Make customer documents feel like yours',
    description:
      'Set up your organization’s identity and contact details so customer-facing documents can reflect the agency they are booking with.',
    points: [
      'Add your organization name, logo, and contact details',
      'Configure available quotation and invoice PDF themes',
      'Keep business identity settings in one place',
    ],
    image: '/images/settings.png',
    imageAlt: 'Organization settings for company identity and document themes',
    path: '/settings',
    icon: Settings,
  },
];

export default function ManagementPortalFeatures() {
  const featuresRef = useRef(null);
  const [visibleFeatures, setVisibleFeatures] = useState(() => new Set());

  useEffect(() => {
    const section = featuresRef.current;
    if (!section) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const featureIndex = Number(entry.target.dataset.featureVisual);
          setVisibleFeatures((current) => {
            const next = new Set(current);
            if (entry.isIntersecting) {
              next.add(featureIndex);
            } else {
              next.delete(featureIndex);
            }
            return next;
          });
        });
      },
      { threshold: 0.2 },
    );

    section.querySelectorAll('[data-feature-visual]').forEach((visual) => {
      observer.observe(visual);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={featuresRef}
      className="mx-auto max-w-7xl overflow-x-clip px-6 py-16 sm:px-8 lg:py-24"
      aria-labelledby="management-features-title"
    >
      <header className="mb-10 border-b border-slate-200 pb-10 sm:mb-14 sm:pb-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-forest">
          One workspace · Every journey
        </p>
        <h2
          id="management-features-title"
          className="mt-4 max-w-4xl text-3xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl"
        >
          Everything your agency needs to plan, manage, and grow
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">
          From the first trip idea to the final invoice, give your team a
          connected place to coordinate the details behind every traveler&apos;s
          journey.
        </p>
      </header>

      <div>
        {portalFeatures.map((feature, index) => {
          const Icon = feature.icon;
          const imageFirst = index % 2 === 1;

          return (
            <article
              key={feature.category}
              className="grid items-center gap-8 border-b border-slate-200 py-10 sm:gap-12 sm:py-14 lg:grid-cols-2 lg:gap-16 lg:py-16"
            >
              <div className={imageFirst ? 'lg:order-2' : 'lg:order-1'}>
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center bg-slate-950 text-white">
                    <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-brand-forest">
                    {feature.category}
                  </span>
                </div>
                <h3 className="text-2xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-3xl">
                  {feature.title}
                </h3>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
                  {feature.description}
                </p>
                <ul className="mt-6 space-y-3">
                  {feature.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-3 text-sm leading-relaxed text-slate-700 sm:text-base"
                    >
                      <CheckCircle2
                        size={19}
                        className="mt-0.5 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                data-feature-visual={index}
                className={`transition-all duration-700 ease-out motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none ${
                  visibleFeatures.has(index)
                    ? 'translate-x-0 opacity-100'
                    : imageFirst
                      ? '-translate-x-12 opacity-0'
                      : 'translate-x-12 opacity-0'
                } ${imageFirst ? 'lg:order-1' : 'lg:order-2'}`}
              >
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-xl shadow-slate-900/10">
                  <div className="flex h-14 items-center gap-2.5 border-b border-slate-200 px-4 sm:px-5">
                    <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
                    <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
                    <span className="h-3 w-3 rounded-full bg-slate-300" aria-hidden="true" />
                    <div
                      className="ml-2 min-w-0 truncate rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-500 sm:ml-3 sm:text-sm"
                      aria-label={`app.lushtravelcloud.com${feature.path}`}
                    >
                      app.lushtravelcloud.com{feature.path}
                    </div>
                  </div>
                  <img
                    src={feature.image}
                    alt={feature.imageAlt}
                    width="650"
                    height="400"
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full object-contain"
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
