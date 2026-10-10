import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowRight, BriefcaseBusiness, CheckCircle2, FileText, LoaderCircle, Mail, MapPin, Phone, Upload, X } from 'lucide-react';
import { Vacancy } from '@travel-crm/contracts';
import { z } from 'zod';
import BRANDING from '../config/branding';
import { fetchActiveVacancies, submitCareerApplication } from '../services/api/career';
import { apiErrorMessage } from '../services/http/apiErrorMessage';

type VacancyItem = z.infer<typeof Vacancy>;
type FieldErrors = Partial<Record<'fullName' | 'email' | 'phone' | 'position' | 'coverLetter' | 'resume' | 'agreeTerms', string>>;

const EMPTY_FORM = {
  fullName: '',
  email: '',
  phone: '',
  position: '',
  coverLetter: '',
  agreeTerms: false,
};

const inputClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';
const perks = [
  'Freshers and experienced applicants are welcome',
  'Salary is negotiable',
  'Excellent communication skills',
  'A passion for travel and tourism',
];

const CareerFormSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  email: z.string().trim().email('Enter a valid email address.'),
  phone: z.string().trim().min(1, 'Phone number is required.'),
  position: z.string().trim().min(1, 'Choose an open position.'),
  coverLetter: z.string().trim().min(1, 'A cover letter or short message is required.'),
  agreeTerms: z.boolean().refine(Boolean, 'Please agree to the application terms.'),
});

export default function CareerPage() {
  const [vacancies, setVacancies] = useState<VacancyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [resume, setResume] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchActiveVacancies()
      .then((items) => {
        if (mounted) setVacancies(items);
      })
      .catch((error: unknown) => {
        if (mounted) setLoadError(apiErrorMessage(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectPosition = (position: string) => {
    setForm((current) => ({ ...current, position }));
    document.getElementById('career-application')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleResumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    const allowedExtension = /\.(pdf|doc|docx)$/i.test(file.name);
    if (!allowedTypes.has(file.type) || !allowedExtension) {
      setErrors((current) => ({ ...current, resume: 'Please upload a PDF, DOC, or DOCX file.' }));
      event.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((current) => ({ ...current, resume: 'The resume must be smaller than 10 MB.' }));
      event.target.value = '';
      return;
    }
    setResume(file);
    setErrors((current) => ({ ...current, resume: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');
    setSubmitted(false);

    const nextErrors: FieldErrors = {};
    const formValidation = CareerFormSchema.safeParse(form);
    if (!formValidation.success) {
      for (const issue of formValidation.error.issues) {
        const field = issue.path[0];
        if (
          field === 'fullName' || field === 'email' || field === 'phone' ||
          field === 'position' || field === 'coverLetter' || field === 'agreeTerms'
        ) {
          nextErrors[field] = issue.message;
        }
      }
    }
    if (!resume) nextErrors.resume = 'Upload your resume to apply.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const apiKey = BRANDING.integrations.imgbbApiKey;
    if (!apiKey || !resume) {
      setSubmitError('Resume upload is not configured for this site. Please contact us to apply.');
      return;
    }

    setSubmitting(true);
    try {
      const uploadData = new FormData();
      uploadData.append('image', resume);
      const uploadResponse = await fetch(`${BRANDING.integrations.imgbbUploadUrl}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        body: uploadData,
      });
      if (!uploadResponse.ok) throw new Error('Resume upload failed. Please try again.');
      const uploadResult: unknown = await uploadResponse.json();
      const uploaded = z.object({
        success: z.boolean(),
        data: z.object({ url: z.string().url() }).optional(),
        error: z.object({ message: z.string().optional() }).optional(),
      }).parse(uploadResult);
      if (!uploaded.success || !uploaded.data?.url) {
        throw new Error(uploaded.error?.message || 'Resume upload failed. Please try again.');
      }

      const result = await submitCareerApplication({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        position: form.position.trim(),
        coverLetter: form.coverLetter.trim(),
        agreeTerms: form.agreeTerms,
        resumeUrl: uploaded.data.url,
        resumeFileName: resume.name,
      });
      if (result.status !== 'success') throw new Error('We could not submit your application. Please try again.');
      setSubmitted(true);
      setForm(EMPTY_FORM);
      setResume(null);
      const fileInput = document.getElementById('career-resume') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
    } catch (error) {
      setSubmitError(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="bg-slate-50">
        <section className="relative isolate flex min-h-[320px] items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_20%,rgba(255,255,255,0.1),transparent_45%),linear-gradient(135deg,#0D382D_0%,#164E3F_48%,#0B251F_100%)] px-6 py-16 text-white sm:min-h-[320px] sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-serif pt-12 text-4xl font-semibold leading-tight sm:text-5xl">Join With Us</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/80 sm:text-lg">
              Help travelers create unforgettable memories. Be part of a passionate team that loves what they do.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Make an impact</p>
            <h2 className="mt-2 font-serif text-3xl text-slate-900 sm:text-4xl">Open Positions</h2>
          </div>
          {loading ? (
            <p role="status" className="text-sm text-slate-500">Loading open positions…</p>
          ) : loadError ? (
            <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{loadError}</p>
          ) : vacancies.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              {vacancies.map((vacancy) => (
                <article key={vacancy.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{vacancy.position}</h3>
                      <p className="mt-2 text-sm text-slate-500">{vacancy.type}</p>
                    </div>
                    <BriefcaseBusiness className="h-5 w-5 shrink-0 text-emerald-700" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-emerald-700" />{vacancy.location}</span>
                    {vacancy.experienceMin !== undefined && <span>{vacancy.experienceMin}+ years experience</span>}
                  </div>
                  {vacancy.description && <p className="mt-4 text-sm leading-6 text-slate-600">{vacancy.description}</p>}
                  <button
                    type="button"
                    onClick={() => selectPosition(vacancy.position)}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    Apply for this role <ArrowRight className="h-4 w-4" />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              No open positions are available right now. Please check back soon.
            </p>
          )}
        </section>

        <section id="career-application" className="scroll-mt-24 border-t border-slate-200 bg-white py-16">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <aside className="self-start rounded-2xl bg-[#0D382D] p-6 text-white sm:p-7">
              <BriefcaseBusiness className="h-8 w-8 text-emerald-300" />
              <h2 className="mt-4 font-serif text-3xl">We’re Hiring</h2>
              <ul className="mt-5 space-y-3 text-sm leading-6 text-white/80">
                {perks.map((perk) => <li key={perk} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{perk}</li>)}
              </ul>
              <div className="mt-6 space-y-2.5 border-t border-white/15 pt-5 text-sm text-white/75">
                {BRANDING.contact.email && !BRANDING.contact.email.endsWith('@example.com') && (
                  <a className="flex items-center gap-2 hover:text-white" href={`mailto:${BRANDING.contact.email}`}>
                    <Mail className="h-4 w-4" />{BRANDING.contact.email}
                  </a>
                )}
                {BRANDING.contact.phone && !BRANDING.contact.phone.includes('0000') && (
                  <a className="flex items-center gap-2 hover:text-white" href={`tel:${BRANDING.contact.phone}`}>
                    <Phone className="h-4 w-4" />{BRANDING.contact.phone}
                  </a>
                )}
              </div>
            </aside>

            <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="font-serif text-3xl text-slate-900">Apply Now</h2>
              <p className="mt-2 text-sm text-slate-500">Share your details and upload a resume to apply.</p>
              {submitted && <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Application submitted successfully. Thank you for applying!</p>}
              {submitError && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{submitError}</p>}
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Full name
                  <input className={inputClass} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} autoComplete="name" />
                  {errors.fullName && <span className="mt-1 block text-xs text-red-600">{errors.fullName}</span>}
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Email
                  <input className={inputClass} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" />
                  {errors.email && <span className="mt-1 block text-xs text-red-600">{errors.email}</span>}
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Phone
                  <input className={inputClass} type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} autoComplete="tel" />
                  {errors.phone && <span className="mt-1 block text-xs text-red-600">{errors.phone}</span>}
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Position
                  <select className={inputClass} value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })}>
                    <option value="">Select an open position</option>
                    {vacancies.map((vacancy) => <option key={vacancy.id} value={vacancy.position}>{vacancy.position} — {vacancy.location}</option>)}
                  </select>
                  {errors.position && <span className="mt-1 block text-xs text-red-600">{errors.position}</span>}
                </label>
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                  Cover letter / message
                  <textarea className={inputClass} rows={5} value={form.coverLetter} onChange={(event) => setForm({ ...form, coverLetter: event.target.value })} />
                  {errors.coverLetter && <span className="mt-1 block text-xs text-red-600">{errors.coverLetter}</span>}
                </label>
                <div className="sm:col-span-2">
                  <label htmlFor="career-resume" className="text-sm font-medium text-slate-700">Resume / CV (PDF, DOC, DOCX; max 10 MB)</label>
                  {resume ? (
                    <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <span className="flex min-w-0 items-center gap-2 text-sm text-emerald-800"><FileText className="h-5 w-5 shrink-0" /><span className="truncate">{resume.name}</span></span>
                      <button type="button" aria-label="Remove resume" onClick={() => setResume(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-red-600"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <label htmlFor="career-resume" className="mt-2 flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-emerald-500">
                      <Upload className="h-6 w-6 text-emerald-700" />
                      <span className="mt-2 text-sm font-medium text-slate-700">Choose a resume file</span>
                      <input id="career-resume" type="file" accept=".pdf,.doc,.docx" onChange={handleResumeChange} className="sr-only" />
                    </label>
                  )}
                  {errors.resume && <span className="mt-1 block text-xs text-red-600">{errors.resume}</span>}
                </div>
                <label className="flex items-start gap-3 text-sm leading-6 text-slate-600 sm:col-span-2">
                  <input type="checkbox" checked={form.agreeTerms} onChange={(event) => setForm({ ...form, agreeTerms: event.target.checked })} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" />
                  <span>I agree that my information may be used for recruitment purposes.</span>
                </label>
                {errors.agreeTerms && <span className="-mt-4 text-xs text-red-600 sm:col-span-2">{errors.agreeTerms}</span>}
                <div className="sm:col-span-2">
                  <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#16a34a] px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? <><LoaderCircle className="h-5 w-5 animate-spin" />Submitting…</> : <>Submit Application <ArrowRight className="h-4 w-4" /></>}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </main>
    </>
  );
}
