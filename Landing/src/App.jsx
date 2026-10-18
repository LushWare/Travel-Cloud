import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Lenis from 'lenis';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PopupModal from './components/PopupModal';
import HomePage from './pages/HomePage';
import TravelSolutionsPage from './pages/TravelSolutionsPage';
import ManagementPortalPage from './pages/ManagementPortalPage';
import WhyUsPage from './pages/WhyUsPage';
import PricingPage from './pages/PricingPage';
import ContactPage from './pages/ContactPage';

function SmoothScroll() {
  const { pathname } = useLocation();
  const lenisRef = useRef(null);

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis = null;
    let animationFrameId;

    const stopScrolling = () => {
      if (!lenis) return;
      cancelAnimationFrame(animationFrameId);
      lenis.destroy();
      lenis = null;
      lenisRef.current = null;
    };

    const startScrolling = () => {
      if (lenis || motionPreference.matches) return;

      lenis = new Lenis({ duration: 1.6, smoothWheel: true, wheelMultiplier: 0.6 });
      lenisRef.current = lenis;
      const animate = (time) => {
        lenis.raf(time);
        animationFrameId = requestAnimationFrame(animate);
      };
      animationFrameId = requestAnimationFrame(animate);
    };

    const updateMotionPreference = () => {
      if (motionPreference.matches) {
        stopScrolling();
      } else {
        startScrolling();
      }
    };

    startScrolling();
    motionPreference.addEventListener('change', updateMotionPreference);

    return () => {
      motionPreference.removeEventListener('change', updateMotionPreference);
      stopScrolling();
    };
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(0, { immediate: true });
      } else {
        window.scrollTo(0, 0);
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [pathname]);

  return null;
}

export default function App() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoProduct, setDemoProduct] = useState('both');

  const handleOpenDemo = (product = 'both') => {
    setDemoProduct(product);
    setDemoOpen(true);
  };

  const handleCloseDemo = () => {
    setDemoOpen(false);
  };

  return (
    <BrowserRouter>
      <SmoothScroll />
      <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans selection:bg-brand-mint selection:text-brand-forest">
        <Navbar onOpenDemo={handleOpenDemo} />
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<HomePage onOpenDemo={handleOpenDemo} />} />
            <Route
              path="/travel-solutions"
              element={<TravelSolutionsPage onOpenDemo={handleOpenDemo} />}
            />
            <Route
              path="/management-portal"
              element={<ManagementPortalPage onOpenDemo={handleOpenDemo} />}
            />
            <Route path="/why-us" element={<WhyUsPage onOpenDemo={handleOpenDemo} />} />
            <Route path="/pricing" element={<PricingPage onOpenDemo={handleOpenDemo} />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="*" element={<HomePage onOpenDemo={handleOpenDemo} />} />
          </Routes>
        </main>

        <Footer onOpenDemo={handleOpenDemo} />

        <a
          href="https://wa.me/18004892041?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20LushTravelCloud."
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with us on WhatsApp"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
        >
          <svg
            viewBox="0 0 32 32"
            className="h-8 w-8"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M16.02 3.2A12.72 12.72 0 0 0 5.1 22.45L3.4 28.65l6.35-1.67A12.73 12.73 0 1 0 16.02 3.2Zm0 23.15c-2 0-3.96-.54-5.66-1.56l-.4-.24-3.77.99 1.01-3.67-.26-.42a10.4 10.4 0 1 1 9.08 4.9Zm5.71-7.79c-.31-.16-1.84-.91-2.12-1.02-.29-.1-.49-.16-.7.16-.21.31-.8 1.02-.98 1.23-.18.2-.36.23-.67.08-.31-.16-1.3-.48-2.47-1.52-.91-.81-1.52-1.81-1.7-2.12-.18-.31-.02-.48.14-.64.14-.14.31-.36.47-.54.16-.18.21-.31.31-.52.1-.2.05-.39-.03-.54-.08-.16-.7-1.68-.96-2.3-.25-.6-.51-.52-.7-.53h-.59c-.21 0-.54.08-.83.39-.28.31-1.08 1.05-1.08 2.56s1.1 2.97 1.26 3.18c.16.2 2.16 3.3 5.23 4.62.73.32 1.3.51 1.75.66.74.23 1.41.2 1.94.12.59-.09 1.84-.75 2.1-1.48.26-.73.26-1.36.18-1.49-.08-.13-.29-.2-.6-.36Z" />
          </svg>
        </a>

        <PopupModal
          isOpen={demoOpen}
          onClose={handleCloseDemo}
          initialProduct={demoProduct}
        />
      </div>
    </BrowserRouter>
  );
}
