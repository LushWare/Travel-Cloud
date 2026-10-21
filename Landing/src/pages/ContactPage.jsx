import React, { useEffect, useRef } from 'react';
import { CalendarDays, Mail, Phone } from 'lucide-react';

export default function ContactPage() {
  const calendlyRef = useRef(null);

  useEffect(() => {
    const initializeCalendly = () => {
      if (!calendlyRef.current || !window.Calendly) return;

      window.Calendly.initInlineWidget({
        url: 'https://calendly.com/lushware-net',
        parentElement: calendlyRef.current,
      });
    };

    if (window.Calendly) {
      initializeCalendly();
      return undefined;
    }

    const scriptId = 'calendly-widget-script';
    let script = document.getElementById(scriptId);
    const addedScript = !script;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://assets.calendly.com/assets/external/widget.js';
      script.async = true;
    }

    script.addEventListener('load', initializeCalendly, { once: true });
    if (addedScript) document.body.appendChild(script);

    return () => script.removeEventListener('load', initializeCalendly);
  }, []);

  return (
    <div className="pb-20 bg-white">
      <section className="relative isolate overflow-hidden bg-slate-900 px-6 pb-10 pt-28 sm:px-8 sm:pb-12 sm:pt-32 lg:pb-14 lg:pt-24">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[34%] bg-slate-800 [clip-path:polygon(28%_0,100%_0,100%_100%,0_100%)] lg:block"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[14%] bg-emerald-900/70 [clip-path:polygon(62%_0,100%_0,100%_100%,26%_100%)] lg:block"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="detail-hero-reveal text-4xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Book a 
              <span className="text-emerald-300"> Free Consultation</span>
            </h1>
            <p className="detail-hero-reveal detail-hero-reveal-delay-1 mx-auto mt-5 max-w-3xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Choose a time that works for you. We&apos;ll talk through your agency&apos;s needs and show you how LushTravelCloud can help.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-8 sm:py-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 lg:col-span-7">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-brand-forest">
                  <CalendarDays size={16} aria-hidden="true" />
                  Book online
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Choose a Date and Time
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
                  Select any available slot to book your free consultation.
                </p>
              </div>
              <a
                href="https://calendly.com/lushware-net"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-semibold text-brand-forest underline decoration-brand-forest/30 underline-offset-4 hover:decoration-brand-forest"
              >
                Open calendar in new tab
              </a>
            </div>

            <div
              ref={calendlyRef}
              className="calendly-inline-widget min-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.45)]"
              data-url="https://calendly.com/lushware-net"
              style={{ height: 700 }}
              aria-label="Book a free consultation with LushTravelCloud"
            />
          </div>

          <aside className="self-start lg:col-span-5 lg:mt-32">
            <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/70 p-6 shadow-sm sm:p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">Prefer to talk?</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Get in touch with our team directly.
              </p>

              <div className="mt-6 divide-y divide-emerald-200/70">
                <a
                  href="mailto:info@lushware.net"
                  aria-label="Email info@lushware.net"
                  className="group flex min-w-0 items-center gap-4 py-4 focus-visible:rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-forest"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-brand-forest transition-colors group-hover:bg-emerald-200">
                    <Mail size={19} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold uppercase tracking-wide text-slate-500">Email</span>
                    <span className="mt-1 block break-all text-md font-semibold text-slate-800 transition-colors group-hover:text-brand-forest">
                      info@lushware.net
                    </span>
                  </span>
                </a>

                <a
                  href="tel:+94716430053"
                  aria-label="Call +94 71 643 0053"
                  className="group flex min-w-0 items-center gap-4 py-4 focus-visible:rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-forest"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-brand-forest transition-colors group-hover:bg-emerald-200">
                    <Phone size={19} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold uppercase tracking-wide text-slate-500">Phone</span>
                    <span className="mt-1 block text-md font-semibold text-slate-800 transition-colors group-hover:text-brand-forest">
                      +94 71 643 0053
                    </span>
                  </span>
                </a>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
