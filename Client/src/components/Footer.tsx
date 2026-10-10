import {
  Facebook,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const SOCIAL_LINKS: Array<{ label: string; href: string; Icon: LucideIcon }> = [
  { label: 'Facebook', href: import.meta.env.VITE_SOCIAL_FACEBOOK || '', Icon: Facebook },
  { label: 'Instagram', href: import.meta.env.VITE_SOCIAL_INSTAGRAM || '', Icon: Instagram },
  { label: 'Twitter', href: import.meta.env.VITE_SOCIAL_TWITTER || '', Icon: Twitter },
  { label: 'YouTube', href: import.meta.env.VITE_SOCIAL_YOUTUBE || '', Icon: Youtube },
];

const EXPLORE_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Destinations', to: '/destinations' },
  { label: 'Travel Packages', to: '/packages' },
  { label: 'Plan Your Trip', to: '/planner' },
];

const MORE_LINKS = [
  { label: 'About Us', to: '/about' },
  { label: 'Careers', to: '/career' },
  { label: 'Sign In', to: '/login' },
  { label: 'Register', to: '/register' },
];

const Footer = ({ theme = 'light' }: { theme?: 'light' | 'dark' }) => {
  const isDark = theme === 'dark';
  const companyName = 'LushTravelCloud';
  const tagline = 'Smarter Travel. Stronger Partners.';
  const email = import.meta.env.VITE_COMPANY_EMAIL || '';
  const phone = import.meta.env.VITE_COMPANY_PHONE || '';
  const address = import.meta.env.VITE_COMPANY_ADDRESS || '';
  const footerClass = isDark
    ? 'border-[#0D382D] bg-[#0D382D] text-white/70'
    : 'border-[#1b3d34]/60 bg-[#0b251f] text-gray-300';
  const headingClass = 'text-white';
  const hoverClass = isDark ? 'hover:text-emerald-200' : 'hover:text-emerald-400';

  return (
    <footer className={`border-t ${footerClass}`}>
      <div className="mx-auto max-w-7xl px-6 pb-9 pt-12 sm:px-8 sm:pt-14">
        <div className="grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-[1.6fr_0.8fr_0.9fr_1fr] lg:gap-10">
          <div>
            <Link to="/" className="group inline-flex items-center gap-3">
              <img
                src="/logo.jpeg"
                alt={`${companyName} logo`}
                className="h-11 w-11 rounded-lg object-contain transition-transform duration-300 group-hover:scale-105"
              />
              <span className="flex flex-col leading-tight">
                <span className={`text-lg font-bold tracking-tight ${headingClass}`}>{companyName}</span>
                <span className={`mt-0.5 text-[12px] ${isDark ? 'text-white/60' : 'text-white/80'}`}>{tagline}</span>
              </span>
            </Link>
            <p className={`mt-4 max-w-sm text-sm leading-6 ${isDark ? 'text-white/65' : 'text-gray-400'}`}>
              Discover thoughtfully planned journeys and unforgettable places with a team that cares about every part of your trip.
            </p>
          </div>

          <nav aria-label="Explore">
            <h2 className={`mb-4 text-xs font-bold uppercase tracking-[0.14em] ${headingClass}`}>Explore</h2>
            <ul className="space-y-3 text-sm">
              {EXPLORE_LINKS.map(({ label, to }) => (
                <li key={to}>
                  <Link to={to} className={`transition-colors ${hoverClass}`}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="More details">
            <h2 className={`mb-4 text-xs font-bold uppercase tracking-[0.14em] ${headingClass}`}>More Details</h2>
            <ul className="space-y-3 text-sm">
              {MORE_LINKS.map(({ label, to }) => (
                <li key={to}>
                  <Link to={to} className={`transition-colors ${hoverClass}`}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className={`mb-4 text-xs font-bold uppercase tracking-[0.14em] ${headingClass}`}>Get in Touch</h2>
            <ul className="space-y-3 text-sm">
              {email && !email.endsWith('@example.com') && (
                <li className="flex items-start gap-2.5">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <a href={`mailto:${email}`} className={`break-all transition-colors ${hoverClass}`}>{email}</a>
                </li>
              )}
              {phone && !phone.includes('0000') && (
                <li className="flex items-start gap-2.5">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <a href={`tel:${phone}`} className={`transition-colors ${hoverClass}`}>{phone}</a>
                </li>
              )}
              {address && !address.includes('Example Street') && (
                <li className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{address}</span>
                </li>
              )}
              {!email && !phone && !address && (
                <li className="text-sm leading-6">Questions about your next trip? We’d love to hear from you.</li>
              )}
              <li>
                <Link to="/contact" className={`inline-flex items-center gap-1 font-medium transition-colors ${isDark ? 'text-emerald-200 hover:text-white' : 'text-emerald-400 hover:text-emerald-300'}`}>
                  Contact our team <span aria-hidden="true">→</span>
                </Link>
              </li>
            </ul>
            <nav aria-label="Social media" className="mt-5 flex items-center gap-2.5">
              {SOCIAL_LINKS.map(({ label, href, Icon }) => {
                const className = `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-800 text-white hover:bg-emerald-600'}`;
                return href ? (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className={className}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </a>
                ) : (
                  <span key={label} aria-label={`${label} link not configured`} className={className}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-[#0b251f]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-5 text-sm text-gray-300 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {companyName}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
