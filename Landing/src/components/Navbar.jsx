import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';

export default function Navbar({ onOpenDemo }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navLinks = [
    { label: 'Home', path: '/' },
    { label: 'Travel Solutions', path: '/travel-solutions' },
    { label: 'Management Portal', path: '/management-portal' },
    { label: 'Why Us', path: '/why-us' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'Contact', path: '/contact' },
  ];

  const handleNavigationClick = (path) => {
    if (path === '/' && location.pathname === '/') {
      window.scrollTo(0, 0);
    }
    setMobileMenuOpen(false);
  };

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
        scrolled
          ? 'bg-slate-900/95 backdrop-blur-md shadow-sm border-b border-slate-700/50 py-3.5'
          : 'bg-slate-900/95 backdrop-blur-sm py-4 sm:py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 sm:px-8 flex items-center justify-between">
        {/* Brand Logo */}
        <Link
          to="/"
          onClick={() => handleNavigationClick('/')}
          className="inline-flex items-center gap-2.5 group select-none"
        >
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

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-7">
          {navLinks.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => handleNavigationClick(item.path)}
              className={({ isActive }) =>
                `navbar-link group text-[13.5px] font-medium transition-all relative py-1 ${
                  isActive
                    ? 'text-emerald-300 font-semibold after:content-[""] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-emerald-300 after:rounded-full'
                    : 'text-slate-200 hover:text-white'
                }`
              }
            >
              <span className="flex h-[1.25em] flex-col overflow-hidden">
                <span className="block whitespace-nowrap leading-[1.25em] transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                  {item.label}
                </span>
                <span
                  className="block whitespace-nowrap font-semibold leading-[1.25em] text-emerald-300 transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                  aria-hidden="true"
                >
                  {item.label}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>

        {/* Right CTA Button */}
        <div className="hidden sm:flex items-center gap-4">
          <button
            onClick={() => onOpenDemo('both')}
            className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-forest hover:bg-brand-forestDark text-white text-[13.5px] font-medium transition-all duration-200 shadow-sm hover:shadow-glow active:scale-95"
          >
            <span>Get Started</span>
            <ArrowRight
              size={15}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-2 text-slate-200 hover:text-white transition-colors rounded-xl hover:bg-white/10"
          aria-label={mobileMenuOpen ? 'Close Menu' : 'Open Menu'}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden bg-white/98 backdrop-blur-lg border-b border-slate-200 shadow-xl px-6 py-6 animate-fadeIn">
          <div className="flex flex-col space-y-3 mb-6">
            {navLinks.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => handleNavigationClick(item.path)}
                className={({ isActive }) =>
                  `navbar-link text-base py-2 px-3 rounded-xl font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-mint text-brand-forest font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`
                }
              >
                <span className="navbar-link-label inline-block">{item.label}</span>
              </NavLink>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-col gap-3">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenDemo('both');
              }}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-brand-forest text-white text-sm font-semibold shadow-glow"
            >
              <span>Get Started</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
