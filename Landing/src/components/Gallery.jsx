import { Link } from 'react-router-dom';

const dashboardImages = [
  {
    src: '/6.png',
    alt: 'Travel agency dashboard on a smartphone',
    title: 'Stay connected on the go',
    to: '/management-portal',
  },
  {
    src: '/4.png',
    alt: 'Travel agency management dashboard on a laptop',
    title: 'At a glance operations',
    to: '/travel-solutions',
  },
  {
    src: '/5.png',
    alt: 'Travel management dashboard displayed on laptop and mobile',
    title: 'Work across devices',
    to: '/travel-solutions',
  },
];

export default function ManagementGallery() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 sm:pb-16 sm:pt-16">
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-forest">
          A closer look
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Your agency, all in one view
        </h2>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Explore the management dashboard across desktop and mobile.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dashboardImages.map((image) => (
          <Link
            key={image.src}
            to={image.to}
            className="block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-forest"
          >
            <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-lg">
              <div className="flex h-64 items-center justify-center bg-slate-50 p-5 sm:h-72">
                <img
                  src={image.src}
                  alt={image.alt}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              </div>
              <figcaption className="border-t border-slate-100 px-5 py-4 text-sm font-semibold text-slate-800">
                {image.title}
              </figcaption>
            </figure>
          </Link>
        ))}
      </div>
    </section>
  );
}
