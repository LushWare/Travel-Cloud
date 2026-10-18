import React, { useState } from 'react';
import { X, CheckCircle2, ArrowRight } from 'lucide-react';
import PORTALS from '../config/portals';

export default function PopupModal({ isOpen, onClose, initialProduct = 'both' }) {
  const [selectedProduct, setSelectedProduct] = useState(initialProduct);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    agency: '',
  });
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const handleReset = () => {
    setSubmitted(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-modal-title"
        className="relative my-auto w-full max-w-lg overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest"
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        <div className="p-6 sm:p-8">
          {submitted ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-brand-forest">
                <CheckCircle2 size={30} />
              </div>
              <h3 className="text-2xl font-bold text-slate-900">Thanks for your interest!</h3>
              <p className="mx-auto mb-6 mt-3 max-w-md text-sm leading-relaxed text-slate-600">
                This demo form is not connected yet. Email{' '}
                <a href="mailto:sales@lushtravelcloud.com" className="font-semibold text-brand-forest hover:underline">
                  sales@lushtravelcloud.com
                </a>{' '}
                and our team can help arrange a walkthrough.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href={PORTALS.client.url}
                  className="w-full rounded-xl bg-brand-forest px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-forestDark sm:w-auto"
                >
                  Traveler demo
                </a>
                <a
                  href={PORTALS.management.url}
                  className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
                >
                  Management portal
                </a>
              </div>
              <button
                onClick={handleReset}
                className="mt-6 text-sm text-slate-500 underline hover:text-slate-700"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="mb-2 text-sm font-semibold text-brand-forest">LushTravelCloud walkthrough</p>
              <h3 id="demo-modal-title" className="pr-8 text-2xl font-bold tracking-tight text-slate-900">
                Find the right fit for your agency
              </h3>
              <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-600">
                Choose what you&apos;re interested in and leave your contact details.
              </p>

              <div className="mb-6 space-y-2">
                <p className="text-sm font-semibold text-slate-800">What would you like to explore?</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  { id: 'client', label: 'Traveler portal' },
                  { id: 'management', label: 'Management CRM' },
                  { id: 'both', label: 'Complete platform' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedProduct(item.id)}
                    aria-pressed={selectedProduct === item.id}
                    className={`rounded-xl border px-3 py-3 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2 ${
                      selectedProduct === item.id
                        ? 'border-brand-forest bg-brand-mint/60 text-brand-forest'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="demo-name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
                    <input
                      id="demo-name"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="demo-email" className="mb-1.5 block text-sm font-medium text-slate-700">Work email</label>
                    <input
                      id="demo-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@agency.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="demo-agency" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Agency or company
                    </label>
                    <input
                      id="demo-agency"
                      type="text"
                      required
                      autoComplete="organization"
                      placeholder="Your agency name"
                      value={formData.agency}
                      onChange={(e) => setFormData({ ...formData, agency: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-forest focus:ring-2 focus:ring-brand-forest/20"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-forest px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-forestDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest focus-visible:ring-offset-2"
                  >
                    <span>Request a walkthrough</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
