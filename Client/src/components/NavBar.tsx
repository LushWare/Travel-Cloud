import React, { useEffect, useState } from 'react';
import { ArrowRight, LogOut, Menu, X } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navLinks = [
  { label: 'Home', path: '/' },
  { label: 'Destinations', path: '/destinations' },
  { label: 'Packages', path: '/packages' },
  { label: 'About Us', path: '/about' },
  { label: 'Contact', path: '/contact' },
];

const NavBar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { isAuthenticated, loading, logout } = useAuth();
  const visibleNavLinks = isAuthenticated
    ? [...navLinks, { label: 'Account', path: '/my-account' }]
    : navLinks;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleNavigationClick = (path: string) => {
    setMobileMenuOpen(false);
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
        scrolled
          ? 'border-b border-[#1b3d34]/60 bg-[#0b251f]/95 py-3.5 shadow-md backdrop-blur-md'
          : 'bg-[#0b251f]/90 py-3 backdrop-blur-sm sm:py-4'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-8">
        <Link
          to="/"
          onClick={() => handleNavigationClick('/')}
          className="group inline-flex select-none items-center gap-2.5"
        >
          <img
            src="/logo.jpeg"
            alt="LushTravelCloud logo"
            className="h-10 w-10 flex-shrink-0 rounded-lg object-contain transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11"
          />
          <span className="flex flex-col leading-none">
            <span className="font-sans text-[17px] font-bold tracking-tight text-white sm:text-xl">
              LushTravelCloud
            </span>
            <span className="mt-0.5 text-[9.5px] font-medium tracking-normal text-emerald-100/80">
              Smarter Travel. Stronger Partners.
            </span>
          </span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-7 lg:flex">
          {visibleNavLinks.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              onClick={() => handleNavigationClick(item.path)}
              className={({ isActive }) =>
                `group relative py-1 text-sm font-medium transition-all ${
                  isActive
                    ? 'font-semibold text-emerald-300 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-emerald-300 after:content-[""]'
                    : 'text-slate-200 hover:text-white'
                }`
              }
            >
              <span className="flex h-[1.25em] flex-col overflow-hidden">
                <span className="block whitespace-nowrap leading-[1.25em] transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                  {item.label}
                </span>
                <span
                  aria-hidden="true"
                  className="block whitespace-nowrap font-semibold leading-[1.25em] text-emerald-300 transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
                >
                  {item.label}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-3 sm:flex">
          <Link
            to="/planner"
            onClick={() => handleNavigationClick('/planner')}
            className="group inline-flex items-center gap-2 rounded-full bg-[#16a34a] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-[#15803d] hover:shadow-lg active:scale-95"
          >
            <span>Plan Your Trip</span>
            <ArrowRight
              size={15}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </Link>
          {!loading && !isAuthenticated && (
            <Link
              to="/login"
              onClick={() => handleNavigationClick('/login')}
              className="rounded-full border border-emerald-200/50 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-200 hover:bg-white/10"
            >
              Sign In
            </Link>
          )}
          {!loading && isAuthenticated && (
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200/50 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-emerald-200 hover:bg-white/10"
            >
              <LogOut size={15} aria-hidden="true" />
              Log Out
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="rounded-xl p-2 text-slate-200 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div
          id="mobile-navigation"
          className="border-t border-emerald-100/10 bg-[#0b251f] px-4 pb-5 pt-3 shadow-xl sm:px-8 lg:hidden"
        >
          <nav aria-label="Mobile navigation" className="mb-4 flex flex-col gap-1">
            {visibleNavLinks.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => handleNavigationClick(item.path)}
                className={({ isActive }) =>
                  `min-h-11 rounded-lg border border-transparent px-4 py-3 text-[15px] font-medium transition-colors ${
                    isActive
                      ? 'border-emerald-300/15 bg-emerald-300/10 font-semibold text-emerald-200'
                      : 'text-slate-100 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <span className="inline-block transition-transform duration-200 hover:translate-x-1">
                  {item.label}
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="grid grid-cols-2 gap-2.5 border-t border-white/10 pt-4">
            <Link
              to="/planner"
              onClick={() => handleNavigationClick('/planner')}
              className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#16a34a] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#15803d] ${loading ? 'col-span-2' : ''}`}
            >
              <span>Plan Your Trip</span>
              <ArrowRight size={16} />
            </Link>
            {!loading && !isAuthenticated && (
              <Link
                to="/login"
                onClick={() => handleNavigationClick('/login')}
                className="flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-100/25 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5"
              >
                Sign In
              </Link>
            )}
            {!loading && isAuthenticated && (
              <button
                type="button"
                onClick={() => {
                  handleNavigationClick('/');
                  logout();
                }}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-100/25 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5"
              >
                <LogOut size={16} aria-hidden="true" />
                Log Out
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default NavBar;
