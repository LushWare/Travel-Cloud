import React, { useState } from 'react';
import { Check, ArrowRight, HelpCircle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

export default function PricingPage({ onOpenDemo }) {
  const [annualBilling, setAnnualBilling] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);

  const toggleFaq = (index) => {
    setOpenFaq((current) => (current === index ? null : index));
  };

  const plans = [
    {
      name: 'Starter',
      desc: 'Ideal for independent travel advisors and boutique agencies looking to deliver premium traveler itineraries.',
      monthlyPrice: 79,
      annualPrice: 63,
      popular: false,
      productScope: 'Travel Solutions + Core CRM',
      features: [
        'Up to 3 Agent seats included',
        'Branded Client Traveler Portal',
        'Visual Itinerary Builder (50 active/mo)',
        'Traveler Mobile Web & App access',
        'Centralized Booking Calendar',
        'Standard Email & Chat Support',
      ],
      cta: 'Start with Starter',
    },
    {
      name: 'Growth',
      badge: 'Most Popular',
      desc: 'The complete two-product platform for growing tour operators and agencies needing deep operational control.',
      monthlyPrice: 189,
      annualPrice: 149,
      popular: true,
      productScope: 'Complete Two-in-One Platform',
      features: [
        'Up to 10 Agent seats included',
        'Both Travel Solutions & Management Portal',
        'Unlimited active itineraries & proposals',
        'Full Client CRM with passport vault',
        'Automated Invoicing & Supplier splits',
        'Custom agency domain (trips.yourbrand.com)',
        'Real-time Analytics & Revenue reports',
        'Priority 24/7 Support with 1-hr SLA',
      ],
      cta: 'Start 14-Day Free Trial',
    },
    {
      name: 'Enterprise',
      desc: 'Tailored for multi-branch agencies, destination management companies (DMCs), and high-volume operators.',
      monthlyPrice: 399,
      annualPrice: 319,
      popular: false,
      productScope: 'Enterprise Platform & GDS APIs',
      features: [
        'Unlimited Agent seats & branch offices',
        'Custom GDS & Supplier API integrations',
        'Multi-currency automated settlement',
        'Dedicated Customer Success Manager',
        'Custom white-label mobile app on App Store',
        'Enterprise SLA with 99.98% uptime',
        'Custom staff onboarding & training',
      ],
      cta: 'Contact Sales for Custom Plan',
    },
  ];

  const faqs = [
    {
      q: 'Do our clients see any LushTravelCloud branding on their itineraries or mobile app?',
      a: 'Not at all. On the Growth and Enterprise tiers, both the traveler portal and mobile app are 100% white-labeled with your agency logo, brand colors, and custom web domain.',
    },
    {
      q: 'How quickly can our agency get set up and start sending proposals?',
      a: 'Most agencies send their first interactive itinerary within 24 hours of signing up. Our pre-built destination templates and intuitive drag-and-drop builder make creation instantaneous.',
    },
    {
      q: 'Can we migrate existing client and booking data from our old CRM or Excel spreadsheets?',
      a: 'Yes! Our Management Portal includes a 1-click CSV/Excel importer for contacts, trip histories, and suppliers. Our migration team is also available to assist with free white-glove onboarding for Growth and Enterprise customers.',
    },
    {
      q: 'How does the traveler mobile app work for our clients?',
      a: 'Whenever you publish a trip, your client receives a secure magic link. They can view it in any web browser or download the companion mobile app. All documents, vouchers, and daily schedules are automatically cached offline.',
    },
    {
      q: 'What payment gateways do you support for client deposits and final payments?',
      a: 'We support Stripe, PayPal, Square, Apple Pay, Google Pay, and direct ACH/SEPA bank wires in over 35 currencies with automated receipt generation.',
    },
  ];

  return (
    <div className="bg-white pb-20">
      <section className="relative isolate overflow-hidden border-b-2 border-emerald-200 bg-gradient-to-br from-[#f3f7f5] via-white to-[#edf4f0] px-6 pb-10 pt-28 shadow-[0_4px_12px_-10px_rgba(16,185,129,0.45)] sm:px-8 sm:pb-12 sm:pt-32 lg:pb-14 lg:pt-36">
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
            Simple, transparent pricing
          </span>
          <h1 className="text-4xl font-extrabold leading-[1.25] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Simple Plans for <span className="text-brand-forest">Every Stage of Growth</span>
          </h1>
          <p className="mx-auto mt-7 max-w-3xl text-base leading-relaxed text-slate-600 sm:mt-8 sm:text-lg">
            Market both exceptional client experiences and manage your operations smoothly with no hidden booking transaction fees.
          </p>

          <div className="mt-6 flex items-center justify-center gap-3 sm:mt-7">
            <span className={`text-xs font-semibold ${!annualBilling ? 'text-slate-900' : 'text-slate-500'}`}>
              Monthly
            </span>
            <button
              type="button"
              onClick={() => setAnnualBilling((current) => !current)}
              className="relative flex h-7 w-14 items-center rounded-full bg-brand-forest p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2"
              aria-label={`Toggle annual billing: ${annualBilling ? 'annual' : 'monthly'} selected`}
              aria-pressed={annualBilling}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                  annualBilling ? 'translate-x-7' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-xs font-semibold ${annualBilling ? 'text-slate-900' : 'text-slate-500'}`}>
              Annual
            </span>
            <span className="ml-1 text-[11px] font-bold bg-emerald-100 text-brand-forest px-2 py-0.5 rounded-full">
              Save 20%
            </span>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-28 max-w-7xl mx-auto px-6 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan, idx) => {
            const price = annualBilling ? plan.annualPrice : plan.monthlyPrice;
            const billingLabel = annualBilling ? 'per month, billed annually' : 'per month';
            const saveText = annualBilling ? `Save $${plan.monthlyPrice - plan.annualPrice}/mo` : 'Pay month to month';

            return (
              <div
                key={idx}
                className={`relative rounded-3xl p-8 flex flex-col justify-between transition-all duration-300 ${
                  plan.popular
                    ? 'bg-slate-900 text-white shadow-2xl border-2 border-brand-vibrant scale-105 z-10'
                    : 'bg-white text-slate-900 border border-slate-200 shadow-md hover:border-slate-300'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-brand-vibrant text-slate-950 text-xs font-extrabold px-4 py-1 rounded-full uppercase tracking-wider shadow">
                    Most Popular Choice
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xl font-bold">{plan.name}</h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                        plan.popular
                          ? 'bg-white/10 text-emerald-300'
                          : 'text-slate-600'
                      }`}
                    >
                      {plan.badge}
                    </span>
                  </div>

                  <p
                    className={`text-xs leading-relaxed mb-6 ${
                      plan.popular ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {plan.desc}
                  </p>

                  <div className="mb-6 pb-6 border-b border-slate-200/20">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight">${price}</span>
                      <span className={`text-xs ${plan.popular ? 'text-slate-400' : 'text-slate-500'}`}>
                        / {billingLabel}
                      </span>
                    </div>
                    <div
                      className={`mt-2 text-[11px] font-semibold ${
                        annualBilling ? 'text-emerald-400' : plan.popular ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {saveText}
                    </div>
                    <div className={`text-[11px] mt-2 ${plan.popular ? 'text-slate-300' : 'text-emerald-500'} font-semibold`}>
                      {plan.productScope}
                    </div>
                  </div>

                  {/* Feature checklist */}
                  <ul className="space-y-3 text-xs mb-8">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <Check
                          size={15}
                          className={`flex-shrink-0 mt-0.5 ${
                            plan.popular ? 'text-emerald-400' : 'text-brand-forest'
                          }`}
                        />
                        <span className={plan.popular ? 'text-slate-200' : 'text-slate-700'}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => onOpenDemo(plan.name.toLowerCase())}
                  className={`w-full py-3.5 px-6 rounded-md font-bold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 ${
                    plan.popular
                      ? 'bg-emerald-200 hover:bg-emerald-300 text-slate-950 shadow-glow'
                      : 'bg-brand-forest hover:bg-brand-forestDark text-white shadow-sm'
                  }`}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="mx-auto max-w-5xl px-6 py-20 sm:px-8 sm:py-24">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            Frequently Asked Questions
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Everything you need to know about implementing LushTravelCloud for your agency.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = openFaq === index;

            return (
              <div
                key={index}
                className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${
                  isOpen
                    ? 'border-slate-800 shadow-md shadow-slate-200/60'
                    : 'border-slate-800 hover:border-slate-300'
                }`}
                onMouseEnter={() => setOpenFaq(index)}
                onMouseLeave={() => setOpenFaq(0)}
              >
                <button
                  onClick={() => toggleFaq(index)}
                  className={`flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors duration-200 sm:px-7 sm:py-6 ${
                    isOpen ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'
                  }`}
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">{faq.q}</span>
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all ${
                      isOpen
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-emerald-200 bg-emerald-50 text-brand-forest group-hover:border-emerald-300'
                    }`}
                  >
                    {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </span>
                </button>

                <div
                  className={`grid transition-all duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-slate-200 bg-white px-6 pb-4 pt-5 text-sm leading-relaxed text-slate-600 sm:px-7 sm:text-base">
                      {faq.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
