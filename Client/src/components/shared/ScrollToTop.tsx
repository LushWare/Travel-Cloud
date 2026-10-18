import Lenis from 'lenis';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname, search } = useLocation();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrameId: number | undefined;

    const stopScrolling = () => {
      const lenis = lenisRef.current;
      if (!lenis) return;

      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
      lenis.destroy();
      lenisRef.current = null;
    };

    const startScrolling = () => {
      if (lenisRef.current || motionPreference.matches) return;

      const lenis = new Lenis({ duration: 1.6, smoothWheel: true, wheelMultiplier: 0.6 });
      lenisRef.current = lenis;

      const animate = (time: number) => {
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

  useLayoutEffect(() => {
    if (lenisRef.current) {
      lenisRef.current.scrollTo(0, { immediate: true });
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [pathname, search]);

  return null;
}