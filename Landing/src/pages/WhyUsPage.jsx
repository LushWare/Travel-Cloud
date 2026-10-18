import {
  Check,
  Award,
} from 'lucide-react';

export default function WhyUsPage() {
  const comparisonRows = [
    {
      feature: 'Travel packages, itineraries, and bookings in one workflow',
      lushTravelCloud: 'Connected travel workflows',
      legacy: 'Often spread across tools',
      generic: 'Needs travel-specific setup',
    },
    {
      feature: 'Customer and lead context for your team',
      lushTravelCloud: 'Centralized client records',
      legacy: 'Separate records and inboxes',
      generic: 'General-purpose CRM',
    },
    {
      feature: 'Quotes, invoices, and travel documents',
      lushTravelCloud: 'Travel-focused tools',
      legacy: 'Manual document handling',
      generic: 'Often requires add-ons',
    },
    {
      feature: 'Business reporting and performance visibility',
      lushTravelCloud: 'Built-in dashboards',
      legacy: 'Manual reporting',
      generic: 'Configure reports',
    },
    {
      feature: 'Branded traveler website and mobile experience',
      lushTravelCloud: 'Part of the platform',
      legacy: 'Separate customer tools',
      generic: 'Separate customer tools',
    },
    {
      feature: 'Team roles and access controls',
      lushTravelCloud: 'Designed for agency teams',
      legacy: 'Varies by system',
      generic: 'Configure for your workflow',
    },
  ];

  return (
    <div className="bg-white pb-20">
      <section className="relative isolate overflow-hidden border-b-2 border-emerald-200 bg-gradient-to-br from-[#f3f7f5] via-white to-[#edf4f0] px-6 pb-14 pt-28 shadow-[0_4px_12px_-10px_rgba(16,185,129,0.45)] sm:px-8 sm:pb-16 sm:pt-32 lg:pb-20 lg:pt-36">
        <div
          className="pointer-events-none absolute -left-24 -top-24 -z-10 h-80 w-80 rounded-full bg-emerald-200/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-28 bottom-0 -z-10 h-72 w-72 rounded-full bg-teal-100/30 blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto max-w-4xl text-center">
          <span className="mb-5 inline-flex rounded-full border border-emerald-200/80 bg-white/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-forest shadow-sm">
            Built for travel agencies
          </span>
          <h1 className="text-4xl font-extrabold leading-[1.25] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Why Travel Agencies Choose{' '}
            <span className="text-brand-forest">LushTravelCloud</span>
          </h1>
          <p className="mx-auto mt-7 max-w-3xl text-base leading-relaxed text-slate-600 sm:mt-8 sm:text-lg">
            Bring your agency&apos;s daily operations and customer experience together. Manage
            clients, packages, itineraries, and bookings in the Management Portal, while giving
            travelers a branded website and mobile experience.
          </p>
        </div>
      </section>

      <section className="bg-white py-14 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              How LushTravelCloud Compares
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
              See how a travel-focused platform brings together work that otherwise lives across
              separate tools.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
            <div className="hidden grid-cols-[1.35fr_1fr_1fr_1fr] bg-slate-50 text-left md:grid">
              <div className="border-b border-r border-slate-300 p-5 text-xs font-bold uppercase tracking-wider text-slate-500">
                What your agency needs
              </div>
              <div className="border-b border-r border-emerald-200 bg-emerald-50 p-5 text-sm font-extrabold text-brand-forest">
                LushTravelCloud
                <span className="mt-1 block text-xs font-medium text-emerald-800">
                  Connected travel platform
                </span>
              </div>
              <div className="border-b border-r border-slate-300 p-5 text-sm font-bold text-slate-700">
                Separate tools
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Spreadsheets and inboxes
                </span>
              </div>
              <div className="border-b border-slate-300 p-5 text-sm font-bold text-slate-700">
                General CRM
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Adapted for travel
                </span>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {comparisonRows.map((row) => (
                <div
                  key={row.feature}
                  className="grid grid-cols-1 md:grid-cols-[1.35fr_1fr_1fr_1fr] [&:last-child>div]:border-b-0"
                >
                  <div className="border-b border-slate-300 bg-slate-50/70 px-5 pb-3 pt-5 text-sm font-bold text-slate-800 md:border-r md:py-5">
                    {row.feature}
                  </div>
                  <div className="flex items-start gap-2 border-b border-emerald-200 bg-emerald-50/60 px-5 py-3 text-sm font-semibold text-brand-forest md:border-r md:py-5">
                    <Check size={17} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>{row.lushTravelCloud}</span>
                  </div>
                  <div className="border-b border-slate-300 px-5 py-3 text-xs leading-relaxed text-slate-500 md:border-r md:py-5 md:text-sm">
                    <span className="mb-1 block font-semibold text-slate-400 md:hidden">
                      Separate tools
                    </span>
                    {row.legacy}
                  </div>
                  <div className="border-b border-slate-300 px-5 pb-5 pt-3 text-xs leading-relaxed text-slate-500 md:py-5 md:text-sm">
                    <span className="mb-1 block font-semibold text-slate-400 md:hidden">
                      General CRM
                    </span>
                    {row.generic}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
