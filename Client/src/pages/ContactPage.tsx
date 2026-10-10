import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Clock3, Mail, MapPin, Phone, Send } from 'lucide-react';
import { motion, MotionConfig } from 'framer-motion';
import BRANDING from '../config/branding';
import { submitContactForm } from '@/services/api/contact';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';

const inputClass = 'mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10';
const hasRealEmail = (email: string) => Boolean(email && !email.endsWith('@example.com'));
const hasRealPhone = (phone: string) => Boolean(phone && !phone.includes('0000'));

const ContactPage = () => {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitted(false);
    setError('');

    try {
      await submitContactForm({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        subject: form.subject,
        message: form.message.trim(),
      });
      setSubmitted(true);
      setForm({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  const contactMethods = [
    ...(hasRealEmail(BRANDING.contact.email)
      ? [{ icon: Mail, label: 'Email', value: BRANDING.contact.email, href: `mailto:${BRANDING.contact.email}` }]
      : []),
    ...(hasRealPhone(BRANDING.contact.phone)
      ? [{ icon: Phone, label: 'Call', value: BRANDING.contact.phone, href: `tel:${BRANDING.contact.phone}` }]
      : []),
  ];

  return (
    <MotionConfig reducedMotion="user">
      <main className="bg-white font-sans text-gray-900">
        <section className="relative isolate flex min-h-[390px] items-end overflow-hidden bg-brand-950 pb-14 pt-10 text-white sm:min-h-[360px] sm:pb-16">
          <img src="/6.png" alt="A bright shoreline framed by tropical greenery" className="absolute inset-0 h-full w-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-950/90 via-brand-950/60 to-transparent" aria-hidden="true" />
          <motion.div
            className="relative w-full max-w-7xl px-6 sm:px-12 md:px-24"
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent-200">We’re here to help</p>
            <h1 className="mb-4 max-w-none font-serif text-4xl font-medium leading-[1.1] text-white drop-shadow-sm sm:text-6xl xl:whitespace-nowrap">Let’s talk about where you want to go.</h1>
            <p className="max-w-4xl text-base font-light leading-6 text-white/90 sm:text-lg xl:whitespace-nowrap">
              Tell us what you’re planning, and our team will help with the details.
            </p>
          </motion.div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[0.65fr_1.35fr] lg:gap-20 lg:px-12 xl:grid-cols-[0.5fr_0.8fr]">
          <motion.aside
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Get in touch</p>
              <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-gray-900">A good journey starts with a conversation.</h2>
            <p className="mt-4 text-sm leading-6 text-gray-600">Ask us about a package, share a trip idea, or get help with a booking. We’ll point you in the right direction.</p>

            <div className="mt-8 divide-y divide-gray-200 border-y border-gray-200">
              {contactMethods.map(({ icon: Icon, label, value, href }, index) => (
                <motion.a
                  key={label}
                  href={href}
                  className="group flex items-center gap-4 py-5"
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: index * 0.08, ease: 'easeOut' }}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-gray-600">{label}</span>
                    <span className="mt-1 block break-words text-sm font-medium text-gray-900">{value}</span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500 transition-colors group-hover:text-brand-700" />
                </motion.a>
              ))}
              {BRANDING.contact.address && (
                <div className="flex items-center gap-4 py-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                    <MapPin aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-gray-600">Office</span>
                    <span className="mt-1 block text-sm font-medium text-gray-900">{BRANDING.contact.address}</span>
                  </span>
                </div>
              )}
              <div className="flex items-center gap-4 py-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-accent-100 text-brand-accent-700">
                  <Clock3 aria-hidden="true" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-gray-600">Office hours</span>
                  <span className="mt-1 block text-sm font-medium text-gray-900">{BRANDING.contact.officeHours}</span>
                </span>
              </div>
            </div>
          </motion.aside>

          <motion.section
            className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-8 lg:p-10"
            aria-labelledby="contact-form-title"
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.65, delay: 0.1, ease: 'easeOut' }}
          >
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Send a message</p>
              <h2 id="contact-form-title" className="mt-3 font-serif text-2xl font-semibold text-gray-900 sm:text-3xl">What can we help you plan?</h2>
              <p className="mt-3 text-sm leading-6 text-gray-600">Share a few details and our team will get back to you.</p>
            </div>
            {submitted && <p role="status" className="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">Thanks for reaching out. Your message has been sent.</p>}
            {error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            <form onSubmit={handleSubmit} className="mt-7 grid gap-x-5 gap-y-5 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">
                Name
                <input className={inputClass} autoComplete="name" name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Email
                <input className={inputClass} autoComplete="email" name="email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Phone <span className="font-normal text-gray-500">(optional)</span>
                <input className={inputClass} autoComplete="tel" name="phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </label>
              <label className="text-sm font-medium text-gray-700">
                I’m getting in touch about
                <select className={inputClass} name="subject" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required>
                  <option value="">Choose a topic</option>
                  <option value="Package inquiry">A travel package</option>
                  <option value="Custom itinerary">A custom itinerary</option>
                  <option value="Booking support">Help with a booking</option>
                  <option value="Other">Something else</option>
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                Message
                <textarea className={`${inputClass} resize-y`} name="message" rows={5} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Tell us a little about your plans…" required />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
                  {submitting ? 'Sending…' : 'Send message'}
                  <Send aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </form>
          </motion.section>
        </section>
      </main>
    </MotionConfig>
  );
};

export default ContactPage;
