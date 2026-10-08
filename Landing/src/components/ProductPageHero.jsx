import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';

export default function ProductPageHero({
  title,
  highlight,
  description,
  demoLabel,
  demoProduct,
  sandboxLabel,
  sandboxUrl,
  imageSrc,
  imageAlt,
  curveStyle,
  actionsSpacing = 'pt-1',
  animateImage = false,
  onOpenDemo,
}) {
  const heroImageRef = useRef(null);
  const [heroImageVisible, setHeroImageVisible] = useState(false);

  useEffect(() => {
    if (!animateImage || !heroImageRef.current) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => setHeroImageVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(heroImageRef.current);

    return () => observer.disconnect();
  }, [animateImage]);

  return (
    <section className="relative isolate overflow-hidden border-b border-slate-100 bg-gradient-to-br from-[#f3f7f5] via-white to-[#edf4f0] pb-24 pt-32 sm:pb-28 sm:pt-36 lg:pb-32 lg:pt-40">
      <div
        className="pointer-events-none absolute -left-32 -top-24 z-0 h-[28rem] w-[28rem] rounded-full bg-emerald-200/20 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-0 z-0 h-80 w-80 rounded-full bg-teal-100/30 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="space-y-6 lg:col-span-6">
            <h1 className="text-4xl font-extrabold leading-[1.12] tracking-tight text-slate-900 sm:text-5xl lg:text-[58px]">
              {title}{' '}
              <span className="text-brand-forest">{highlight}</span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              {description}
            </p>
            <div className={`flex flex-wrap items-center gap-4 ${actionsSpacing}`}>
              <button
                onClick={() => onOpenDemo(demoProduct)}
                className="group inline-flex items-center gap-2.5 rounded-md bg-brand-forest px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition-all hover:bg-brand-forestDark active:scale-95 sm:text-[15px]"
              >
                <span>{demoLabel}</span>
                <ArrowRight
                  size={16}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>
              <a
                href={sandboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white/90 px-7 py-3.5 text-sm font-semibold text-slate-800 transition-all hover:border-slate-400 hover:bg-white active:scale-95 sm:text-[15px]"
              >
                <span>{sandboxLabel}</span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div
            ref={heroImageRef}
            className={`flex justify-center transition-all duration-700 ease-out motion-reduce:translate-x-0 motion-reduce:opacity-100 motion-reduce:transition-none lg:col-span-6 lg:justify-end ${
              animateImage
                ? heroImageVisible
                  ? 'translate-x-0 opacity-100'
                  : 'translate-x-12 opacity-0'
                : ''
            }`}
          >
            <img
              src={imageSrc}
              alt={imageAlt}
              className="h-full w-full max-w-[650px] object-contain"
              loading="eager"
            />
          </div>
        </div>
      </div>

      <svg
        className="pointer-events-none absolute bottom-0 left-0 z-20 h-16 w-full"
        viewBox="0 0 1440 64"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={
            curveStyle === 'wave'
              ? 'M0 28C180 4 360 4 540 28S900 52 1080 28 1260 4 1440 28'
              : 'M0 42C300 42 360 8 720 8S1140 42 1440 42'
          }
          fill="none"
          stroke="#164E3F"
          strokeOpacity="0.72"
          strokeWidth="3.5"
        />
        <path
          d={
            curveStyle === 'wave'
              ? 'M0 37C180 13 360 13 540 37S900 61 1080 37 1260 13 1440 37'
              : 'M0 52C300 52 380 20 720 20S1140 52 1440 52'
          }
          fill="none"
          stroke="#10B981"
          strokeOpacity="0.7"
          strokeWidth="2.5"
        />
      </svg>
    </section>
  );
}
