import { useEffect, useRef } from 'react';

export default function ContainerScroll({ children, className = '' }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;

    if (!container || !content) return undefined;

    let animationFrameId;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const updateTransform = () => {
      if (animationFrameId) return;

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = undefined;

        if (reducedMotion.matches) {
          content.style.transform = 'none';
          return;
        }

        const { top } = container.getBoundingClientRect();
        const start = window.innerHeight * 0.9;
        const end = -window.innerHeight * 0.45;
        const rawProgress = Math.min(1, Math.max(0, (start - top) / (start - end)));
        const rotation = 22 * (1 - rawProgress);
        const scale = 0.86 + 0.14 * rawProgress;
        const translateY = 48 * (1 - rawProgress);

        container.style.height = `${content.scrollHeight + window.innerHeight * 0.7}px`;
        content.style.transform = `perspective(1400px) rotateX(${rotation}deg) scale(${scale}) translateY(${translateY}px)`;
      });
    };

    updateTransform();
    window.addEventListener('scroll', updateTransform, { passive: true });
    window.addEventListener('resize', updateTransform);
    reducedMotion.addEventListener('change', updateTransform);

    return () => {
      window.removeEventListener('scroll', updateTransform);
      window.removeEventListener('resize', updateTransform);
      reducedMotion.removeEventListener('change', updateTransform);

      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ perspective: '1400px' }}
    >
      <div
        ref={contentRef}
        className="will-change-transform motion-reduce:transform-none"
        style={{
          position: 'sticky',
          top: '6rem',
          transformOrigin: 'center top',
        }}
      >
        {children}
      </div>
    </div>
  );
}
