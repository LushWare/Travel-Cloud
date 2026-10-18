import { ArrowUpRight, Compass, Heart, Leaf, ShieldCheck } from 'lucide-react';
import { motion, MotionConfig } from 'framer-motion';
import { Link } from 'react-router-dom';
import BRANDING from '../config/branding';

const principles = [
  {
    icon: Compass,
    title: 'Local perspective',
    description: 'We look beyond the obvious stops to help each place feel personal and lived in.',
  },
  {
    icon: Heart,
    title: 'Made around you',
    description: 'Your pace, interests, and idea of a good trip shape the journey from the start.',
  },
  {
    icon: Leaf,
    title: 'Travel thoughtfully',
    description: 'We believe the best journeys respect the places and people that make them special.',
  },
  {
    icon: ShieldCheck,
    title: 'Support that stays',
    description: 'Our team is here to help before you go and while you are on the move.',
  },
];

const AboutPage = () => (
  <MotionConfig reducedMotion="user">
  <main className="bg-gray-50 font-sans text-gray-900">
    <section className="relative isolate flex min-h-[390px] items-end overflow-hidden bg-brand-950 pb-14 pt-10 text-white sm:min-h-[380px] sm:pb-16">
      <img
        src="/3.png"
        alt="A quiet tropical shoreline with long-tail boats"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-brand-950/90 via-brand-950/60 to-transparent" aria-hidden="true" />
      <div className="relative w-full max-w-4xl px-6 sm:px-12 md:px-24">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent-200">A little about us</p>
        <h1 className="mb-4 max-w-3xl font-serif text-4xl font-medium leading-[1.1] text-white drop-shadow-sm sm:text-6xl">
          Travel that stays <span className="text-brand-accent-200">with you.</span>
        </h1>
        <p className="max-w-xl text-base font-light leading-6 text-white/90 sm:text-lg">
          {BRANDING.company.name} brings thoughtful planning and a sense of discovery to every journey.
        </p>
      </div>
    </section>

    <motion.section
      className="bg-white"
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.65, ease: 'easeOut' }}
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-20 lg:px-12">
      <div className="relative mx-auto h-[380px] w-full max-w-[520px] sm:h-[450px]">
        <motion.div whileHover={{ scale: 1.05, zIndex: 40 }} transition={{ duration: 0.3, ease: 'easeOut' }} className="absolute left-0 top-[9%] z-10 h-[58%] w-[72%] -rotate-1 bg-white p-[6px] shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
          <img src="/12.png" alt="Sunset dinner overlooking the ocean" className="h-full w-full object-cover" loading="lazy" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05, zIndex: 40 }} transition={{ duration: 0.3, ease: 'easeOut' }} className="absolute right-0 top-0 z-20 h-[36%] w-[44%] rotate-[6deg] bg-white p-[6px] shadow-[0_8px_25px_rgba(0,0,0,0.15)]">
          <img src="/10.png" alt="Colorful coastal village above the sea" className="h-full w-full object-cover" loading="lazy" />
        </motion.div>
        <motion.div whileHover={{ scale: 1.05, zIndex: 40 }} transition={{ duration: 0.3, ease: 'easeOut' }} className="absolute bottom-[8%] right-[4%] z-30 h-[36%] w-[43%] rotate-[-8deg] bg-white p-[6px] shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
          <img src="/11.png" alt="Snorkeler swimming above a sea turtle" className="h-full w-full object-cover" loading="lazy" />
        </motion.div>
      </div>
      <div className="max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Our point of view</p>
        <h2 className="mt-4 font-serif text-3xl font-semibold leading-tight text-gray-900 sm:text-4xl">
          The best trips feel like they could only belong to you.
        </h2>
        <p className="mt-6 text-base leading-7 text-gray-600">
          A great journey is more than a list of places. It is the rhythm of the days, the people you meet, and the moments you did not know to look for. We bring the details together so you can be present for all of it.
        </p>
        <p className="mt-4 text-base leading-7 text-gray-600">
          From the first idea to the journey home, our travel team helps turn what you have in mind into a trip that feels considered, unhurried, and unmistakably yours.
        </p>
        <Link
          to="/destinations"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Explore destinations <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
      </div>
    </motion.section>

    <section className="overflow-hidden bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_88%),linear-gradient(180deg,#102923_0%,#164E3F_100%)] py-16 text-white sm:py-20">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent-200">What guides us</p>
          <h2 className="mt-4 font-serif text-3xl font-semibold leading-tight text-white sm:text-4xl">Good journeys are built on good care.</h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/70">The details matter: the people who know a place, the pace that feels right, and the support that stays with you.</p>
        </div>
        <div className="mt-10 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map(({ icon: Icon, title, description }, index) => (
            <motion.article
              key={title}
              className="border-t border-white/20 py-6 sm:py-7"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.5, delay: index * 0.09, ease: 'easeOut' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-serif text-4xl leading-none text-brand-accent-200/80">0{index + 1}</span>
                <Icon aria-hidden="true" className="h-5 w-5 text-brand-accent-200" strokeWidth={1.5} />
              </div>
              <h3 className="mt-6 font-serif text-xl font-semibold text-white">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/70">{description}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  </main>
  </MotionConfig>
);

export default AboutPage;
