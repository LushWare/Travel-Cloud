import {
  Globe2,
  Compass,
  Users,
  FileText,
  RefreshCw,
  MessageSquare,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';

const pillars = [
  {
    icon: Globe2,
    title: 'Omnichannel Booking Engine',
    description: 'Flights, hotels, tours, and packages.',
  },
  {
    icon: Compass,
    title: 'Interactive Itinerary Builder',
    description: 'Branded day-by-day trip plans.',
  },
  {
    icon: Users,
    title: 'Traveler CRM & Profiles',
    description: 'Keep every client detail organized.',
  },
  {
    icon: FileText,
    title: 'Quotes & Billing',
    description: 'Create quotes and invoices with ease.',
  },
  {
    icon: RefreshCw,
    title: 'Supplier API Integrations',
    description: 'Connect to live travel suppliers.',
  },
  {
    icon: MessageSquare,
    title: 'Smart Alerts & Messaging',
    description: 'Keep travelers updated in real time.',
  },
  {
    icon: BarChart3,
    title: 'Revenue & Analytics',
    description: 'See performance and profitability.',
  },
  {
    icon: ShieldCheck,
    title: 'Security & Team Roles',
    description: 'Protect data with controlled access.',
  },
];

export default function MarqueeSection() {
  return (
    <section
      id="value-pillars"
      data-testid="value-pillars-section"
      className="relative z-10 overflow-visible border-t border-emerald-500/20 py-16 pb-24 md:py-30 md:pb-28"
      style={{
        backgroundColor: '#014d36',
        backgroundImage: `
          radial-gradient(ellipse at 50% 0%, rgba(11, 167, 99, 0.22) 0%, transparent 60%),
          radial-gradient(ellipse at 50% 100%, rgba(1, 28, 20, 0.85) 0%, transparent 70%),
          url('/images/canvas-pattern.png')
        `,
        backgroundRepeat: 'repeat',
        backgroundSize: 'auto, auto, 420px auto',
      }}
    >
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <h2 className="mb-10 text-center text-xl font-bold tracking-tight text-white sm:text-4xl">
          One platform for every journey
        </h2>
      </div>

      <div className="relative w-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-[#014d36] to-transparent sm:w-24"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-[#014d36] to-transparent sm:w-24"
          aria-hidden="true"
        />
        <div className="flex overflow-hidden">
          <div className="animate-marquee-left flex">
            {[0, 1].map((sequence) => (
              <div
                key={sequence}
                className="flex flex-shrink-0"
                aria-hidden={sequence === 1 ? 'true' : undefined}
              >
                {pillars.map(({ icon: Icon, title, description }) => (
                  <div
                    key={title}
                    className="flex min-h-44 w-[280px] flex-shrink-0 flex-col items-center justify-center border-r border-emerald-100/15 px-6 text-center sm:w-[320px]"
                  >
                    <Icon
                      size={27}
                      strokeWidth={1.8}
                      className="mb-4 text-emerald-300"
                      aria-hidden="true"
                    />
                    <h3 className="text-base font-semibold text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-emerald-100/75">
                      {description}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <svg
        data-testid="value-pillars-bottom-curve"
        className="pointer-events-none absolute -bottom-8 left-0 z-20 h-16 w-full"
        viewBox="0 0 1440 64"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="value-pillar-curve-pattern"
            patternUnits="userSpaceOnUse"
            width="420"
            height="144"
          >
            <image
              href="/images/canvas-pattern.png"
              width="420"
              height="144"
              preserveAspectRatio="none"
            />
          </pattern>
        </defs>
        <path
          d="M0 0H1440V32C1180 32 1050 48 720 48S260 32 0 32Z"
          fill="url(#value-pillar-curve-pattern)"
        />
        <path
          d="M0 25C260 25 390 41 720 41S1180 25 1440 25"
          fill="none"
          stroke="#164E3F"
          strokeWidth="4"
        />
        <path
          d="M0 19C260 19 390 35 720 35S1180 19 1440 19"
          fill="none"
          stroke="#10B981"
          strokeOpacity="0.75"
          strokeWidth="2"
        />
        <path
          d="M0 32C260 32 390 48 720 48S1180 32 1440 32V64H0Z"
          fill="#ffffff"
        />
      </svg>
    </section>
  );
}
