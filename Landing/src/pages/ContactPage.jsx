import React, { useState } from 'react';
import {
  Mail,
  Phone,
  Clock,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    agency: '',
    product: 'both',
    message: '',
  });

  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="pb-20 bg-white">
      <section className="relative isolate overflow-hidden border-b-2 border-emerald-200 bg-gradient-to-br from-[#f3f7f5] via-white to-[#edf4f0] px-6 pb-14 pt-28 shadow-[0_4px_12px_-10px_rgba(16,185,129,0.45)] sm:px-8 sm:pb-16 sm:pt-32">
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
            Let&apos;s talk about your agency
          </span>
          <h1 className="mb-6 text-4xl font-extrabold leading-[1.25] tracking-tight text-slate-900 sm:mb-7 sm:text-5xl lg:text-6xl">
            Schedule a Personalized <span className="text-brand-forest">LushTravelCloud Walkthrough</span>
          </h1>
          <p className="mx-auto max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg">
            See how our travel solutions portal and management platform will streamline your team&apos;s daily operations and delight your travelers.
          </p>
        </div>
      </section>

      {/* Main Form & Contact Info Container */}
      <section className="py-8 max-w-7xl mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Form */}
          <div className="lg:col-span-7 bg-white p-7 sm:p-10 rounded-3xl border border-slate-200 shadow-xl">
            {submitted ? (
              <div className="text-center py-12 space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-brand-forest rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 size={36} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900">Thanks for reaching out!</h3>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-600">
                  This demo form does not send requests yet. Please email{' '}
                  <a href="mailto:sales@lushtravelcloud.com" className="font-semibold text-brand-forest hover:underline">
                    sales@lushtravelcloud.com
                  </a>{' '}
                  to arrange your personalized walkthrough.
                </p>
                <div className="pt-4">
                  <button
                    onClick={() => setSubmitted(false)}
                    className="px-6 py-2.5 rounded-full bg-brand-forest text-white text-xs font-bold hover:bg-brand-forestDark transition-all"
                  >
                    Submit Another Request
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-7">
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold tracking-tight text-slate-900">
                    Let&apos;s plan your walkthrough
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Share a few details and we&apos;ll tailor the conversation to your agency.
                  </p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-slate-800">Your details</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Full name <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        required
                        autoComplete="name"
                        placeholder="Your name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                      />
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Work email <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="you@agency.com"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="contact-agency" className="mb-1.5 block text-sm font-medium text-slate-700">
                        Agency or company <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="contact-agency"
                        type="text"
                        required
                        autoComplete="organization"
                        placeholder="Your agency name"
                        value={formData.agency}
                        onChange={(e) => setFormData({ ...formData, agency: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                      />
                    </div>
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold text-slate-800">
                    What would you like to explore?
                  </legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      { id: 'client', label: 'Travel Website' },
                      { id: 'management', label: 'Management Portal' },
                      { id: 'both', label: 'Both Platforms' },
                    ].map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => setFormData({ ...formData, product: product.id })}
                        aria-pressed={formData.product === product.id}
                        className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2 ${
                          formData.product === product.id
                            ? 'border-brand-forest bg-brand-mint/60 text-brand-forest'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        {product.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor="contact-message" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Anything you&apos;d like us to know?{' '}
                    <span className="font-normal text-slate-500">(optional)</span>
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    placeholder="Tell us about your goals or questions."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                  />
                </div>

                <div className="border-t border-slate-100 pt-5">
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-forest px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-forestDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2 active:scale-[0.99]"
                  >
                    <span>Request a walkthrough</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right Column: Office & Direct Contacts */}
          <div className="lg:col-span-5">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
              <h3 className="text-xl font-bold tracking-tight text-slate-900">Prefer to talk?</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Get in touch with our team directly.
              </p>

              <div className="mt-7 space-y-6">
                <div className="flex items-start gap-4">
                  <Mail className="mt-0.5 shrink-0 text-brand-forest" size={19} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">Email</p>
                    <a
                      href="mailto:sales@lushtravelcloud.com"
                      className="mt-1 inline-block break-all text-sm text-brand-forest hover:underline"
                    >
                      sales@lushtravelcloud.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <Phone className="mt-0.5 shrink-0 text-brand-forest" size={19} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Phone</p>
                    <a href="tel:+18004892041" className="mt-1 block text-sm text-slate-600 hover:text-brand-forest">
                      +1 (800) 489-2041
                    </a>
                    <a href="tel:+442079460912" className="mt-1 block text-sm text-slate-600 hover:text-brand-forest">
                      +44 20 7946 0912
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
