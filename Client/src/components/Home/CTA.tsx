import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const CtaFooter = () => {
  return (
    <section className="relative overflow-hidden bg-[#164E3F] py-20 text-white md:py-20">
       <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/13.png')] bg-cover bg-center" />
       
       <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 px-6 md:flex-row">
          <div>
            <p className="text-[#84b8a9] text-xs font-bold tracking-wider uppercase mb-2">Ready for your next adventure?</p>
            <h2 className="mb-2 font-serif text-4xl leading-tight md:text-5xl">Let's Plan Your Dream Trip</h2>
            <p className="text-white/80 font-light">Get in touch with our travel experts and start your journey today.</p>
          </div>
          <Link
            to="/contact"
            className="inline-flex min-h-14 shrink-0 items-center gap-2 rounded-full bg-[#16a34a] px-9 py-4 text-base font-semibold text-white shadow-lg transition-colors hover:bg-[#15803d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Contact Us <ArrowRight className="w-4 h-4" />
          </Link>
       </div>
    </section>
  );
};

export default CtaFooter;
