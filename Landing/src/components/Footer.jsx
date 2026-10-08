import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin } from 'lucide-react';

const exploreLinks = [
  { label: 'Home', path: '/' },
  { label: 'Travel Solutions', path: '/travel-solutions' },
  { label: 'Management Portal', path: '/management-portal' },
];

const detailLinks = [
  { label: 'Why Us', path: '/why-us' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Contact', path: '/contact' },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-900 text-slate-400 text-sm">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 pt-16 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 lg:grid-cols-[1.8fr_0.72fr_0.72fr_1fr] lg:gap-x-5 lg:gap-y-10">
          <div className="space-y-5">
            <Link to="/" className="inline-flex items-center gap-2.5 group select-none">
              <img
                src="/logo.jpeg"
                alt="LushTravelCloud logo"
                className="w-11 h-11 flex-shrink-0 rounded-lg object-contain transition-transform duration-300 group-hover:scale-105"
              />
              <div className="flex flex-col leading-none">
                <span className="font-sans font-bold text-[19px] sm:text-[20px] tracking-tight text-white">
                  LushTravelCloud
                </span>
                <span className="text-[9.5px] font-medium tracking-normal mt-0.5 text-emerald-100/80">
                  Smarter Travel. Stronger Partners.
                </span>
              </div>
            </Link>
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              One connected platform for travel businesses to inspire travelers and manage
              every journey.
            </p>
          </div>

          <nav aria-label="Explore">
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-5">
              Explore
            </h4>
            <ul className="space-y-4 text-sm">
              {exploreLinks.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className="hover:text-emerald-400 transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="More details">
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-5">
              More Details
            </h4>
            <ul className="space-y-4 text-sm">
              {detailLinks.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className="hover:text-emerald-400 transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-5">
              Get in Touch
            </h4>
            <ul className="space-y-4 text-sm">
              <li className="flex items-center gap-2">
                <Mail size={13} className="text-emerald-400" />
                <a
                  href="mailto:hello@lushtravelcloud.com"
                  className="hover:text-emerald-400 transition-colors"
                >
                  hello@lushtravelcloud.com
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Phone size={13} className="text-emerald-400" />
                <a
                  href="tel:+18004892041"
                  className="hover:text-emerald-400 transition-colors"
                >
                  +1 (800) 489-2041
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-950 py-6">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 flex items-center justify-start text-sm text-slate-500">
          <p>© {currentYear} LushTravelCloud. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
