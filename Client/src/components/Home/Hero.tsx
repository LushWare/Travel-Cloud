import React, { useEffect, useState } from 'react';

const heroSlides = [
  {
    image: '/2.png',
    title: 'Your Next Adventure\nAwaits',
    description:
      'Discover breathtaking destinations, unique experiences and unforgettable journeys with us.',
  },
  {
    image: '/1.png',
    title: 'Find Your Place\nin Paradise',
    description:
      'Sail into turquoise waters, slow down on sunlit shores, and discover a getaway made for you.',
  },
  {
    image: '/4.png',
    title: 'Make Every Moment\nUnforgettable',
    description:
      'Watch the Aegean glow at sunset, wander whitewashed streets, and experience Greece at your own pace.',
  },
  {
    image: '/7.png',
    title: 'Leave Ordinary\nBehind',
    description:
      'Wake up to endless ocean views, unwind in hidden retreats, and make room for a little luxury.',
  },
];

const HeroSection = () => {
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveImage((currentImage) => (currentImage + 1) % heroSlides.length);
    }, 6000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <>
      <section className="sticky top-0 z-0 relative isolate flex h-[700px] w-full items-center overflow-hidden bg-[#092522] pt-16">
        {heroSlides.map(({ image }, index) => (
          <img
            key={image}
            src={image}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 h-full w-full scale-[1.03] object-cover object-[68%_center] transition-opacity duration-1000 motion-reduce:transition-none sm:object-center ${
              index === activeImage ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ))}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(9,37,34,0.88)_0%,rgba(9,37,34,0.72)_30%,rgba(9,37,34,0.35)_55%,rgba(9,37,34,0)_78%)]" />
        <div className="relative z-20 w-full min-w-0 max-w-4xl px-6 pb-8 sm:w-auto sm:min-w-[auto] sm:px-12 md:px-24">
          <div className="mb-8 flex items-center gap-3 text-sm font-medium uppercase tracking-widest text-white/90">
            <span>Explore</span>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            <span>Discover</span>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            <span>Experience</span>
          </div>

          <div className="grid">
            {heroSlides.map(({ title, description }, index) => (
              <div
                key={title}
                aria-hidden={index !== activeImage}
                className={`col-start-1 row-start-1 transition-opacity duration-700 motion-reduce:transition-none ${
                  index === activeImage ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                <h1 className="mb-8 whitespace-pre-line font-serif text-5xl font-medium leading-[1.1] text-white drop-shadow-sm sm:text-6xl lg:text-7xl">
                  {title}
                </h1>

                <p className="max-w-xl text-lg font-light leading-7 text-white/90 sm:text-xl">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
};

export default HeroSection;
